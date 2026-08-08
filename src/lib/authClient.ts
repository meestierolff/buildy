import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  basePath: "/api/auth",
  fetchOptions: {
    credentials: "include",
    retry: 0,
  },
  plugins: [magicLinkClient()],
  sessionOptions: {
    refetchInterval: 5 * 60,
    refetchOnWindowFocus: true,
    refetchWhenOffline: false,
  },
});

export type AuthSessionData = typeof authClient.$Infer.Session;
export type AuthClientUser = AuthSessionData["user"];
export type AuthClientSession = AuthSessionData["session"];

export type AuthFlow =
  | "session"
  | "sign-in"
  | "sign-up"
  | "magic-link"
  | "google"
  | "forgot-password"
  | "reset-password"
  | "sign-out";

export interface AuthErrorDetails {
  code?: string;
  status?: number;
}

const BLOCKED_NEXT_PATHS = [
  "/api",
  "/auth",
  "/wachtwoord-vergeten",
  "/wachtwoord-resetten",
] as const;
const NEXT_URL_BASE = "https://navigation.buildy.invalid";

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function decodedPathIsSafe(value: string): boolean {
  let candidate = value;

  for (let pass = 0; pass < 2; pass += 1) {
    if (
      !candidate.startsWith("/") ||
      candidate.startsWith("//") ||
      candidate.includes("\\") ||
      hasControlCharacters(candidate)
    ) {
      return false;
    }

    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) return true;
      candidate = decoded;
    } catch {
      return false;
    }
  }

  return !candidate.startsWith("//") && !candidate.includes("\\");
}

/** Returns a same-origin application path, never an absolute or auth/API URL. */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || value.length > 2_048 || !decodedPathIsSafe(value)) return "/";

  try {
    const url = new URL(value, NEXT_URL_BASE);
    if (url.origin !== NEXT_URL_BASE || url.username || url.password) return "/";

    const path = `${url.pathname}${url.search}${url.hash}`;
    const isBlocked = BLOCKED_NEXT_PATHS.some(
      (blocked) => url.pathname === blocked || url.pathname.startsWith(`${blocked}/`),
    );
    return isBlocked ? "/" : path;
  } catch {
    return "/";
  }
}

export function authPagePath(
  next: string | null | undefined,
  state?: "verified" | "password-reset",
): string {
  const url = new URL("/auth", NEXT_URL_BASE);
  const nextPath = safeNextPath(next);
  if (nextPath !== "/") url.searchParams.set("next", nextPath);
  if (state === "verified") url.searchParams.set("verified", "1");
  if (state === "password-reset") url.searchParams.set("reset", "success");
  return `${url.pathname}${url.search}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

export function authErrorDetails(error: unknown): AuthErrorDetails {
  const outer = asRecord(error);
  const inner = asRecord(outer?.error);
  const code = typeof outer?.code === "string"
    ? outer.code
    : typeof inner?.code === "string"
      ? inner.code
      : undefined;
  const status = typeof outer?.status === "number"
    ? outer.status
    : typeof inner?.status === "number"
      ? inner.status
      : undefined;

  return {
    ...(code ? { code } : {}),
    ...(status ? { status } : {}),
  };
}

export function authErrorMessage(error: unknown, flow: AuthFlow): string {
  const { code, status } = authErrorDetails(error);

  if (status === 429) return "Je hebt dit te vaak geprobeerd. Wacht even en probeer opnieuw.";
  if (status === 503 || code === "AUTH_UNAVAILABLE") {
    return "Inloggen is tijdelijk niet beschikbaar. Probeer het later opnieuw.";
  }
  if (code === "EMAIL_NOT_VERIFIED") {
    return "Bevestig eerst je e-mailadres. We kunnen een nieuwe link sturen.";
  }
  if (code === "BETA_INVITE_REQUIRED") {
    return "Voor een nieuw account is een geldige bèta-uitnodiging nodig.";
  }
  if (code === "INVALID_EMAIL_OR_PASSWORD" || code === "INVALID_PASSWORD") {
    return "E-mailadres of wachtwoord klopt niet.";
  }
  if (code === "PASSWORD_TOO_SHORT") return "Gebruik een wachtwoord van minimaal 12 tekens.";
  if (code === "PASSWORD_TOO_LONG") return "Gebruik een wachtwoord van maximaal 128 tekens.";
  if (code === "INVALID_TOKEN" || code === "TOKEN_EXPIRED") {
    return "Deze link is ongeldig of verlopen. Vraag een nieuwe link aan.";
  }

  const fallbacks: Record<AuthFlow, string> = {
    session: "Je sessie kon niet worden gecontroleerd. Probeer het opnieuw.",
    "sign-in": "Inloggen is niet gelukt. Controleer je gegevens en probeer opnieuw.",
    "sign-up": "Je account kon niet worden aangemaakt. Probeer het later opnieuw.",
    "magic-link": "De magic link kon niet worden verstuurd. Probeer het later opnieuw.",
    google: "Google-login is nu niet bereikbaar. Probeer het later opnieuw.",
    "forgot-password": "De reset-link kon niet worden verstuurd. Probeer het later opnieuw.",
    "reset-password": "Je wachtwoord kon niet worden opgeslagen. Vraag zo nodig een nieuwe link aan.",
    "sign-out": "Uitloggen is niet gelukt. Probeer het opnieuw.",
  };
  return fallbacks[flow];
}

export interface PasswordResetLink {
  errorCode?: string;
  token?: string;
}

export function parsePasswordResetLink(search: string): PasswordResetLink {
  const params = new URLSearchParams(search);
  const errorCode = params.get("error")?.trim();
  const token = params.get("token")?.trim();

  if (errorCode) return { errorCode };
  if (!token || token.length > 512 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return { errorCode: "INVALID_TOKEN" };
  }
  return { token };
}
