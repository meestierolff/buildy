// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { BetterAuthOptions } from "better-auth/minimal";
import type { AuthConfiguration } from "../../server/auth/config";
import { createBuildyAuth } from "../../server/auth/factory";
import { createBuildyDatabase } from "../../server/db/client";

const config: AuthConfiguration = {
  appOrigin: "https://app.buildy.test",
  betaMode: false,
  databaseUrl: "postgresql://buildy:buildy@127.0.0.1:5432/buildy",
  secret: "0123456789abcdef".repeat(2),
  secureCookies: true,
  trustedOrigins: ["https://app.buildy.test"],
};

describe("Better Auth factory", () => {
  it("fails closed when beta mode has no transactional registration gate", async () => {
    const resources = createBuildyDatabase(config.databaseUrl);
    try {
      expect(() => createBuildyAuth({
        config: { ...config, betaMode: true },
        database: resources.database,
        identityProvisioner: {
          ensureForSession: async () => undefined,
          provisionForAuthUser: async () => undefined,
        },
        outbox: { enqueue: async () => undefined },
      })).toThrow();
    } finally {
      await resources.pool.end();
    }
  });

  it("maps the four existing Drizzle auth models and locks down sessions", async () => {
    const resources = createBuildyDatabase(config.databaseUrl);

    try {
      const auth = createBuildyAuth({
        config,
        database: resources.database,
        identityProvisioner: {
          ensureForSession: async () => undefined,
          provisionForAuthUser: async () => undefined,
        },
        outbox: { enqueue: async () => undefined },
      });
      const options = auth.options as BetterAuthOptions;

      expect(options.user?.modelName).toBe("authUsers");
      expect(options.session?.modelName).toBe("authSessions");
      expect(options.account?.modelName).toBe("authAccounts");
      expect(options.verification?.modelName).toBe("authVerifications");
      expect(options.verification?.storeIdentifier).toBe("hashed");
      expect(options.account?.encryptOAuthTokens).toBe(true);
      expect(options.account?.accountLinking?.disableImplicitLinking).toBe(true);
      expect(options.emailAndPassword).toMatchObject({
        autoSignIn: false,
        requireEmailVerification: true,
        revokeSessionsOnPasswordReset: true,
      });
      expect(options.advanced).toMatchObject({
        defaultCookieAttributes: {
          httpOnly: true,
          sameSite: "lax",
          secure: true,
        },
        disableCSRFCheck: false,
        disableOriginCheck: false,
        useSecureCookies: true,
      });
      expect(options.socialProviders).toBeUndefined();
      expect(options.trustedOrigins).toEqual(["https://app.buildy.test"]);
    } finally {
      await resources.pool.end();
    }
  });
});
