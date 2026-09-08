import {
  authLogoutResponseSchema,
  authSessionResponseSchema,
  passwordAuthResponseSchema,
  usernameSignInInputSchema,
  usernameSignUpInputSchema,
  safeAuthNextPath,
} from "../../shared/contracts/auth";
import { apiErrorSchema } from "../../shared/contracts/api";

export interface AuthClientUser {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  emailVerified: boolean;
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

export type AuthFlow = "session" | "sign-in" | "sign-up" | "sign-out";

export interface PasswordCredentials {
  username: string;
  password: string;
  next?: string;
}

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
  if (code === "INVALID_CREDENTIALS" || (flow === "sign-in" && status === 401)) {
    return "Je gebruikersnaam of wachtwoord klopt niet. Probeer het opnieuw.";
  }
  if (code === "USERNAME_UNAVAILABLE") return "Deze gebruikersnaam is niet beschikbaar. Kies een andere.";
  if (code === "WEAK_PASSWORD") return "Kies een langer, uniek wachtwoord van minimaal 15 tekens.";
  if (code === "BAD_REQUEST" || code === "VALIDATION_FAILED") return "Controleer je gebruikersnaam en wachtwoord.";
  const fallback: Record<AuthFlow, string> = {
    session: "Je sessie kon niet worden gecontroleerd. Probeer het opnieuw.",
    "sign-in": "Inloggen is niet gelukt. Probeer het opnieuw.",
    "sign-up": "Je account kon niet worden aangemaakt. Probeer het opnieuw.",
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

  async signIn(input: PasswordCredentials): Promise<string> {
    const parsed = usernameSignInInputSchema.parse({ ...input, next: safeNextPath(input.next) });
    const response = await fetch("/api/auth/sign-in", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(parsed),
    });
    return safeNextPath(passwordAuthResponseSchema.parse(await checkedResponse(response)).data.next);
  },

  async signUp(input: PasswordCredentials): Promise<string> {
    const parsed = usernameSignUpInputSchema.parse({ ...input, next: safeNextPath(input.next) });
    const response = await fetch("/api/auth/sign-up", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(parsed),
    });
    return safeNextPath(passwordAuthResponseSchema.parse(await checkedResponse(response)).data.next);
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
