// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createPostgresAuthIdentityProvisioner } from "../../server/auth/identity";
import type { AuthEngine } from "../../server/auth/factory";
import type { BuildyDatabase } from "../../server/db/client";
import { DataProtectionKeyring, PrivacyBlindIndex } from "../../server/security/dataProtection";
import {
  BetterAuthSubjectResolver,
  PostgresActiveAppUserLookup,
} from "../../server/projects/authActor";

const APP_USER_ID = "11111111-1111-4111-8111-111111111111";
const keyring = new DataProtectionKeyring({
  currentVersion: 1,
  keys: { 1: Buffer.alloc(32, 7).toString("base64") },
});
const blindIndex = new PrivacyBlindIndex(Buffer.alloc(32, 8).toString("base64"));

describe("privileged auth identity database boundary", () => {
  it("delegates provisioning and session repair to the narrow database function", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ app_user_id: APP_USER_ID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ email: "bewoner@example.test" }] })
      .mockResolvedValueOnce({ rows: [{ app_user_id: APP_USER_ID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ app_user_id: APP_USER_ID }] });
    const transaction = { execute } as unknown as Parameters<
      ReturnType<typeof createPostgresAuthIdentityProvisioner>["ensureForSession"]
    >[0];
    const provisioner = createPostgresAuthIdentityProvisioner(keyring, blindIndex);

    await provisioner.provisionForAuthUser(transaction, {
      email: "bewoner@example.test",
      id: "better-auth-user",
      name: "Bewoner",
    });
    await provisioner.ensureForSession(transaction, "better-auth-user");

    expect(execute).toHaveBeenCalledTimes(6);
    await expect(provisioner.ensureForSession(transaction, "x".repeat(513))).rejects.toMatchObject({
      code: "invalid_auth_user_id",
    });
  });

  it("maps only the database function's active identity result", async () => {
    const database = {
      execute: vi.fn(async () => ({ rows: [{ app_user_id: APP_USER_ID }] })),
    } as unknown as BuildyDatabase;
    const lookup = new PostgresActiveAppUserLookup(database);

    await expect(lookup.findActiveAppUserId("better-auth-user")).resolves.toBe(APP_USER_ID);
    await expect(lookup.findActiveAppUserId("x".repeat(513))).resolves.toBeNull();
  });

  it("derives the subject from Better Auth rather than client identity headers", async () => {
    const engine = {
      handler: async () => new Response(),
      resolveAuthUserId: vi.fn(async () => "better-auth-user"),
    } satisfies AuthEngine;
    const resolver = new BetterAuthSubjectResolver(() => engine);
    const request = new Request("https://app.buildy.test/api/projects", {
      headers: { "x-user-id": "forged-app-user" },
    });

    await expect(resolver.resolveAuthUserId(request)).resolves.toBe("better-auth-user");
    expect(engine.resolveAuthUserId).toHaveBeenCalledWith(request);
  });
});
