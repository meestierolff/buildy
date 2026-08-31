// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createPostgresAuthIdentityProvisioner } from "../../server/auth/identity";
import type { AuthEngine } from "../../server/auth/factory";
import type { BuildyDatabase } from "../../server/db/client";
import {
  GoogleOidcSubjectResolver,
  PostgresActiveAppUserLookup,
} from "../../server/projects/authActor";

const APP_USER_ID = "11111111-1111-4111-8111-111111111111";
const account = {
  currentSession: async () => null,
  listSessions: async () => [],
  revokeSession: async () => ({ revoked: false, wasCurrent: false }),
};

describe("privileged auth identity database boundary", () => {
  it("delegates provisioning and session repair to the narrow database function", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ app_user_id: APP_USER_ID }] })
      .mockResolvedValueOnce({ rows: [{ app_user_id: APP_USER_ID }] });
    const transaction = { execute } as unknown as Parameters<
      ReturnType<typeof createPostgresAuthIdentityProvisioner>["ensureForSession"]
    >[0];
    const provisioner = createPostgresAuthIdentityProvisioner();

    await provisioner.provisionForAuthUser(transaction, {
      email: "bewoner@example.test",
      id: "google-auth-user",
      name: "Bewoner",
    });
    await provisioner.ensureForSession(transaction, "google-auth-user");

    expect(execute).toHaveBeenCalledTimes(2);
    await expect(provisioner.ensureForSession(transaction, "x".repeat(513))).rejects.toMatchObject({
      code: "invalid_auth_user_id",
    });
  });

  it("maps only the database function's active identity result", async () => {
    const database = {
      execute: vi.fn(async () => ({ rows: [{ app_user_id: APP_USER_ID }] })),
    } as unknown as BuildyDatabase;
    const lookup = new PostgresActiveAppUserLookup(database);

    await expect(lookup.findActiveAppUserId("google-auth-user")).resolves.toBe(APP_USER_ID);
    await expect(lookup.findActiveAppUserId("x".repeat(513))).resolves.toBeNull();
  });

  it("derives the subject from the server-owned OIDC session rather than client headers", async () => {
    const engine = {
      account,
      handler: async () => new Response(),
      resolveAuthUserId: vi.fn(async () => "google-auth-user"),
    } satisfies AuthEngine;
    const resolver = new GoogleOidcSubjectResolver(() => engine);
    const request = new Request("https://app.buildy.test/api/projects", {
      headers: { "x-user-id": "forged-app-user" },
    });

    await expect(resolver.resolveAuthUserId(request)).resolves.toBe("google-auth-user");
    expect(engine.resolveAuthUserId).toHaveBeenCalledWith(request);
  });
});
