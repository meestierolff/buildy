import {
  authLogoutResponseSchema,
  authSessionResponseSchema,
  googleAuthStartResponseSchema,
  safeAuthNextPath,
} from "../../shared/contracts/auth";
import { apiErrorSchema } from "../../shared/contracts/api";

export interface AuthClientUser {
  id: string;
  name: string;
  email: string;
  emailVerified: true;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthClientSession {
  id: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export type AuthSessionData =
  | { session: AuthClientSession; user: AuthClientUser }
  | { session: null; user: null };

export type AuthFlow = "session" | "google" | "sign-out";

export interface AuthErrorDetails {
  code?: string;
  status?: number;
}

export class AuthClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AuthClientError";
  }
}

export const safeNextPath = safeAuthNextPath;

export function authPagePath(next: string | null | undefined): string {
  const url = new URL("/auth", "https://navigation.buildy.invalid");
  const nextPath = safeNextPath(next);
  if (nextPath !== "/") url.searchParams.set("next", nextPath);
  return `${url.pathname}${url.search}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

export function authErrorDetails(error: unknown): AuthErrorDetails {
  if (error instanceof AuthClientError) {
    return {
      ...(error.code ? { code: error.code } : {}),
      status: error.status,
    };
  }
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
  if (status === 429 || code === "RATE_LIMITED") {
    return "Je hebt dit te vaak geprobeerd. Wacht even en probeer opnieuw.";
  }
  if (
    flow === "sign-out"
    && (status === 503 || code === "AUTH_UNAVAILABLE" || code === "PROVIDER_UNAVAILABLE")
  ) {
    return "Uitloggen is tijdelijk niet beschikbaar. Probeer het later opnieuw.";
  }
  if (status === 503 || code === "AUTH_UNAVAILABLE" || code === "PROVIDER_UNAVAILABLE") {
    return "Inloggen is tijdelijk niet beschikbaar. Probeer het later opnieuw.";
  }
  if (code === "BETA_INVITE_REQUIRED" || code === "BETA_INVITE_INVALID") {
    return "Voor een nieuw account is een geldige bèta-uitnodiging nodig.";
  }
  if (code === "GOOGLE_CALLBACK_INVALID") {
    return "Deze Google-login is verlopen of al gebruikt. Start opnieuw.";
  }
  if (code === "GOOGLE_EMAIL_NOT_VERIFIED") {
    return "Google heeft geen bevestigd e-mailadres gedeeld. Kies een ander Google-account.";
  }
  if (code === "GOOGLE_LOGIN_FAILED") {
    return "Google-login is niet afgerond. Probeer het opnieuw.";
  }
  const fallback: Record<AuthFlow, string> = {
    session: "Je sessie kon niet worden gecontroleerd. Probeer het opnieuw.",
    google: "Google-login is nu niet bereikbaar. Probeer het later opnieuw.",
    "sign-out": "Uitloggen is niet gelukt. Probeer het opnieuw.",
  };
  return fallback[flow];
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new AuthClientError("De authenticatieserver gaf een ongeldig antwoord.", response.status, undefined, {
      cause: error,
    });
  }
}

async function checkedResponse(response: Response): Promise<unknown> {
  const body = await responseBody(response);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    throw new AuthClientError(
      parsed.success ? parsed.data.error.message : "De authenticatie-aanvraag is mislukt.",
      response.status,
      parsed.success ? parsed.data.error.code : undefined,
    );
  }
  return body;
}

export const authClient = {
  async getSession(): Promise<AuthSessionData> {
    const response = await fetch("/api/auth/session", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    const parsed = authSessionResponseSchema.parse(await checkedResponse(response)).data;
    if (!parsed.session || !parsed.user) return { session: null, user: null };
    return {
      session: {
        ...parsed.session,
        createdAt: new Date(parsed.session.createdAt),
        updatedAt: new Date(parsed.session.updatedAt),
        expiresAt: new Date(parsed.session.expiresAt),
      },
      user: {
        ...parsed.user,
        createdAt: new Date(parsed.user.createdAt),
        updatedAt: new Date(parsed.user.updatedAt),
      },
    } as AuthSessionData;
  },

  async beginGoogleSignIn(next: string): Promise<string> {
    const response = await fetch("/api/auth/sign-in/google", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ next: safeNextPath(next) }),
    });
    return googleAuthStartResponseSchema.parse(await checkedResponse(response)).data.authorizationUrl;
  },

  async signOut(): Promise<void> {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: "{}",
    });
    authLogoutResponseSchema.parse(await checkedResponse(response));
  },
};
