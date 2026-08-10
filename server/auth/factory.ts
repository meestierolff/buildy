import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { magicLink } from "better-auth/plugins/magic-link";
import type { BuildyDatabase } from "../db/client.js";
import type { AuthConfiguration } from "./config.js";
import {
  createProvisionedDrizzleAuthAdapter,
  type AuthIdentityProvisioner,
  type AuthNewUserAuthorizer,
} from "./identity.js";
import { createAuthEmailCallbacks, type AuthEmailOutbox } from "./outbox.js";
import type { AccountAuthGateway, AccountAuthSession } from "../account/types.js";
import { AuthUnavailableError } from "./errors.js";

type ConfiguredRateLimit = NonNullable<BetterAuthOptions["rateLimit"]>;
export type AuthRateLimitStorage = NonNullable<ConfiguredRateLimit["customStorage"]>;

export interface AuthEngine {
  handler(request: Request): Promise<Response>;
  resolveAuthUserId(request: Request): Promise<string | null>;
  readonly account?: AccountAuthGateway;
  readonly options?: BetterAuthOptions;
}

export interface AuthRegistrationGate extends AuthNewUserAuthorizer {
  withRequest<Result>(request: Request, next: () => Promise<Result>): Promise<Result>;
}

export interface CreateBuildyAuthInput {
  config: AuthConfiguration;
  database: BuildyDatabase;
  identityProvisioner: AuthIdentityProvisioner;
  outbox: AuthEmailOutbox;
  rateLimitStorage?: AuthRateLimitStorage;
  registrationGate?: AuthRegistrationGate;
}

export function createBuildyAuth(input: CreateBuildyAuthInput): AuthEngine {
  if (input.config.betaMode !== false && !input.registrationGate) {
    throw new AuthUnavailableError("configuration_invalid");
  }
  const email = createAuthEmailCallbacks(input.outbox, input.config.trustedOrigins);
  const database = createProvisionedDrizzleAuthAdapter(
    input.database,
    input.identityProvisioner,
    input.registrationGate,
  );

  const auth = betterAuth({
    account: {
      accountLinking: {
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
        disableImplicitLinking: true,
      },
      encryptOAuthTokens: true,
      modelName: "authAccounts",
      skipStateCookieCheck: false,
      storeStateStrategy: "database",
      updateAccountOnSignIn: true,
    },
    advanced: {
      cookiePrefix: "buildy",
      defaultCookieAttributes: {
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: input.config.secureCookies,
      },
      disableCSRFCheck: false,
      disableOriginCheck: false,
      ipAddress: {
        // Vercel overwrites these with the public client IP. Prefer its
        // namespaced header so a proxy in front of Vercel cannot shadow it.
        ipAddressHeaders: ["x-vercel-forwarded-for", "x-forwarded-for"],
        ipv6Subnet: 64,
      },
      skipTrailingSlashes: true,
      trustedProxyHeaders: false,
      useSecureCookies: input.config.secureCookies,
    },
    appName: "Buildy",
    basePath: "/api/auth",
    baseURL: input.config.appOrigin,
    database,
    emailAndPassword: {
      autoSignIn: input.config.simpleAppMode === true,
      enabled: true,
      maxPasswordLength: 128,
      minPasswordLength: 12,
      requireEmailVerification: input.config.simpleAppMode !== true,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: email.sendPasswordReset,
    },
    emailVerification: {
      autoSignInAfterVerification: false,
      expiresIn: 60 * 60,
      sendOnSignIn: false,
      sendOnSignUp: input.config.simpleAppMode !== true,
      sendVerificationEmail: email.sendVerificationEmail,
    },
    plugins: input.config.simpleAppMode === true
      ? []
      : [
          magicLink({
            expiresIn: 15 * 60,
            rateLimit: { max: 3, window: 15 * 60 },
            sendMagicLink: email.sendMagicLink,
            storeToken: "hashed",
          }),
        ],
    rateLimit: {
      customRules: {
        "/request-password-reset": { max: 3, window: 15 * 60 },
        "/send-verification-email": { max: 3, window: 15 * 60 },
        "/sign-in/email": { max: 5, window: 60 },
        "/sign-in/magic-link": { max: 3, window: 15 * 60 },
        "/sign-up/email": { max: 3, window: 5 * 60 },
      },
      enabled: true,
      max: 60,
      window: 60,
      ...(input.rateLimitStorage
        ? { customStorage: input.rateLimitStorage }
        : { storage: "memory" as const }),
    },
    secret: input.config.secret,
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      freshAge: 60 * 60,
      modelName: "authSessions",
      updateAge: 60 * 60 * 24,
    },
    socialProviders: input.config.google
      ? {
          google: {
            accessType: "online",
            clientId: input.config.google.clientId,
            clientSecret: input.config.google.clientSecret,
          },
        }
      : undefined,
    telemetry: { enabled: false },
    trustedOrigins: [...input.config.trustedOrigins],
    user: {
      deleteUser: { enabled: false },
      modelName: "authUsers",
    },
    verification: {
      modelName: "authVerifications",
      storeIdentifier: "hashed",
    },
  });

  const authoritativeSession = async (request: Request) => auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true, disableRefresh: true },
  });

  const account: AccountAuthGateway = {
    async currentSession(request) {
      const current = await authoritativeSession(request);
      if (!current) return null;
      const session = current.session;
      return {
        id: session.id,
        authUserId: current.user.id,
        token: session.token,
        isCurrent: true,
        createdAt: new Date(session.createdAt).toISOString(),
        updatedAt: new Date(session.updatedAt).toISOString(),
        expiresAt: new Date(session.expiresAt).toISOString(),
        ipAddress: session.ipAddress ?? null,
        userAgent: session.userAgent ?? null,
      } satisfies AccountAuthSession;
    },
    async listSessions(request) {
      const current = await authoritativeSession(request);
      if (!current) return [];
      const sessions = await auth.api.listSessions({ headers: request.headers });
      return sessions.map((session): AccountAuthSession => ({
        id: session.id,
        authUserId: session.userId,
        token: session.token,
        isCurrent: session.id === current.session.id,
        createdAt: new Date(session.createdAt).toISOString(),
        updatedAt: new Date(session.updatedAt).toISOString(),
        expiresAt: new Date(session.expiresAt).toISOString(),
        ipAddress: session.ipAddress ?? null,
        userAgent: session.userAgent ?? null,
      }));
    },
    async revokeSession(request, sessionId) {
      const current = await authoritativeSession(request);
      if (!current) return { revoked: false, wasCurrent: false };
      const sessions = await auth.api.listSessions({ headers: request.headers });
      const target = sessions.find((session) => session.id === sessionId);
      if (!target || target.userId !== current.user.id) {
        return { revoked: false, wasCurrent: false };
      }
      const result = await auth.api.revokeSession({
        headers: request.headers,
        body: { token: target.token },
      });
      return { revoked: result.status, wasCurrent: target.id === current.session.id };
    },
    async verifyPassword(request, password) {
      try {
        const result = await auth.api.verifyPassword({
          headers: request.headers,
          body: { password },
        });
        return result.status;
      } catch (error) {
        const bodyCode = error && typeof error === "object" && "body" in error
          ? (error.body as { code?: unknown } | undefined)?.code
          : undefined;
        if ([
          "CREDENTIAL_ACCOUNT_NOT_FOUND",
          "INVALID_PASSWORD",
          "SESSION_EXPIRED",
          "SESSION_NOT_FRESH",
        ].includes(String(bodyCode))) return false;
        throw error;
      }
    },
  };

  return {
    account,
    handler: input.registrationGate
      ? (request) => input.registrationGate!.withRequest(request, () => auth.handler(request))
      : auth.handler,
    options: auth.options,
    async resolveAuthUserId(request) {
      const session = await auth.api.getSession({
        headers: request.headers,
        query: {
          // Project authorization must consult authoritative database state;
          // a revoked session may not survive through a cookie cache window.
          disableCookieCache: true,
          disableRefresh: true,
        },
      });
      return session?.user.id ?? null;
    },
  };
}
