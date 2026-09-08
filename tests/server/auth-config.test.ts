// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { RuntimeConfig } from "../../server/config/runtime";
import { resolveAuthConfiguration } from "../../server/auth/config";
import { AuthUnavailableError } from "../../server/auth/errors";

function runtime(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    APP_ENV: "test",
    APP_ORIGIN: "https://app.buildy.test",
    DATABASE_URL: "postgresql://buildy:buildy@127.0.0.1:5432/buildy",
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
    NODE_ENV: "test",
    ...overrides,
  };
}

describe("auth configuration", () => {
  it("accepts only canonical exact origins and removes duplicates", () => {
    const config = resolveAuthConfiguration(
      runtime({
        TRUSTED_ORIGINS: "https://preview.buildy.test, https://app.buildy.test",
        VERCEL_URL: "buildy-git-main.vercel.app",
      }),
    );

    expect(config.trustedOrigins).toEqual([
      "https://app.buildy.test",
      "https://buildy-git-main.vercel.app",
      "https://preview.buildy.test",
    ]);
    expect(config.secureCookies).toBe(true);
    expect(config).not.toHaveProperty("google");
    expect(config).not.toHaveProperty("callbackUrl");
  });

  it("allows insecure cookies only on a local loopback origin", () => {
    const config = resolveAuthConfiguration(
      runtime({ APP_ENV: "local", APP_ORIGIN: "http://127.0.0.1:8080" }),
    );

    expect(config.appOrigin).toBe("http://127.0.0.1:8080");
    expect(config.secureCookies).toBe(false);
  });

  it("requires one exact PRIMARY_DOMAIN matching APP_ORIGIN in production", () => {
    expect(() => resolveAuthConfiguration(runtime({
      APP_ENV: "production",
      APP_ORIGIN: "https://www.buildy.test",
    }))).toThrow(AuthUnavailableError);

    expect(resolveAuthConfiguration(runtime({
      APP_ENV: "production",
      APP_ORIGIN: "https://www.buildy.test",
      PRIMARY_DOMAIN: "https://www.buildy.test",
    })).appOrigin).toBe("https://www.buildy.test");
  });

  it.each([
    { APP_ENV: "production" as const, APP_ORIGIN: "http://127.0.0.1:8080" },
    { TRUSTED_ORIGINS: "https://*.buildy.test" },
    { TRUSTED_ORIGINS: "https://preview.buildy.test/path" },
    { TRUSTED_ORIGINS: "https://preview.buildy.test/" },
    { APP_ENV: "local" as const, APP_ORIGIN: "http://buildy.test" },
  ])("rejects unsafe origin configuration: %o", (overrides) => {
    expect(() => resolveAuthConfiguration(runtime(overrides))).toThrow(AuthUnavailableError);
  });

  it("fails closed when a required secret or database URL is absent", () => {
    expect(() => resolveAuthConfiguration(runtime({ DATABASE_URL: undefined }))).toThrowError(
      expect.objectContaining({ reason: "configuration_missing" }),
    );
  });

  it("works without a Google client or callback", () => {
    expect(resolveAuthConfiguration(runtime({
      GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined,
    })).databaseUrl).toContain("postgresql:");
  });

  it("requires TLS for a remote PostgreSQL connection", () => {
    expect(() =>
      resolveAuthConfiguration(
        runtime({ DATABASE_URL: "postgresql://buildy:secret@database.example/buildy" }),
      ),
    ).toThrowError(expect.objectContaining({ reason: "configuration_invalid" }));

    expect(
      resolveAuthConfiguration(
        runtime({
          DATABASE_URL:
            "postgresql://buildy:secret@database.example/buildy?sslmode=require&channel_binding=require",
        }),
      ).databaseUrl,
    ).toContain("sslmode=require");
  });
});
