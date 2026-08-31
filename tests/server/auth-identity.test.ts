// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  createAuthIdentityProvisioner,
  type AuthIdentityPersistence,
  type AuthIdentityProvisioner,
  type AuthIdentityUser,
} from "../../server/auth/identity";

interface TestAppUser {
  lastAuthenticatedAt?: Date;
  status: string;
}

interface TestState {
  appUsers: Map<string, TestAppUser>;
  authUsers: Map<string, AuthIdentityUser>;
  mappings: Map<string, { appUserId: string; migrationStatus: "linked" }>;
  profiles: Map<string, { displayName: string; slug: string }>;
}

interface TestTransaction {
  state: TestState;
}

function emptyState(): TestState {
  return {
    appUsers: new Map(),
    authUsers: new Map(),
    mappings: new Map(),
    profiles: new Map(),
  };
}

function cloneState(state: TestState): TestState {
  return {
    appUsers: new Map([...state.appUsers].map(([id, value]) => [id, { ...value }])),
    authUsers: new Map([...state.authUsers].map(([id, value]) => [id, { ...value }])),
    mappings: new Map([...state.mappings].map(([id, value]) => [id, { ...value }])),
    profiles: new Map([...state.profiles].map(([id, value]) => [id, { ...value }])),
  };
}

function persistence(shouldFailProfile: () => boolean): AuthIdentityPersistence<TestTransaction> {
  return {
    async createAppUser(transaction, appUserId) {
      transaction.state.appUsers.set(appUserId, { status: "active" });
    },
    async deleteAppUser(transaction, appUserId) {
      transaction.state.appUsers.delete(appUserId);
    },
    async findAuthUser(transaction, authUserId) {
      return transaction.state.authUsers.get(authUserId) ?? null;
    },
    async findIdentityMapping(transaction, authUserId) {
      return transaction.state.mappings.get(authUserId) ?? null;
    },
    async getAppUserStatus(transaction, appUserId) {
      return transaction.state.appUsers.get(appUserId)?.status ?? null;
    },
    async markAuthenticated(transaction, appUserId, now) {
      const user = transaction.state.appUsers.get(appUserId);
      if (!user || user.status !== "active") return false;
      user.lastAuthenticatedAt = now;
      return true;
    },
    async provisionProfile(transaction, profile) {
      if (shouldFailProfile()) throw new Error("profile_write_failed");
      if (!transaction.state.profiles.has(profile.userId)) {
        transaction.state.profiles.set(profile.userId, {
          displayName: profile.displayName,
          slug: profile.slug,
        });
      }
    },
    async tryCreateIdentityMapping(transaction, input) {
      if (transaction.state.mappings.has(input.authUserId)) return false;
      transaction.state.mappings.set(input.authUserId, {
        appUserId: input.appUserId,
        migrationStatus: "linked",
      });
      return true;
    },
  };
}

function createHarness(initial: TestState, shouldFailProfile: () => boolean) {
  let committed = initial;
  let nextAppUser = 0;
  const provisioner = createAuthIdentityProvisioner({
    generateId: () => `00000000-0000-4000-8000-${String(++nextAppUser).padStart(12, "0")}`,
    now: () => new Date("2026-08-04T12:00:00.000Z"),
    persistence: persistence(shouldFailProfile),
  });

  async function transaction<Result>(
    callback: (
      transaction: TestTransaction,
      identity: AuthIdentityProvisioner<TestTransaction>,
    ) => Promise<Result>,
  ): Promise<Result> {
    const draft = cloneState(committed);
    const result = await callback({ state: draft }, provisioner);
    committed = draft;
    return result;
  }

  return { state: () => committed, transaction };
}

describe("auth identity transaction boundary", () => {
  it("rolls the compatibility auth user and domain identity back together", async () => {
    let failProfile = true;
    const harness = createHarness(emptyState(), () => failProfile);
    const user = { id: "google-user", email: "owner@example.test", name: "Eigenaar" };

    await expect(harness.transaction(async (transaction, identity) => {
      transaction.state.authUsers.set(user.id, user);
      await identity.provisionForAuthUser(transaction, user);
    })).rejects.toThrow("profile_write_failed");
    expect(harness.state().authUsers.size).toBe(0);
    expect(harness.state().appUsers.size).toBe(0);

    failProfile = false;
    await harness.transaction(async (transaction, identity) => {
      transaction.state.authUsers.set(user.id, user);
      await identity.provisionForAuthUser(transaction, user);
    });
    expect(harness.state().authUsers.size).toBe(1);
    expect(harness.state().mappings.size).toBe(1);
    expect(harness.state().profiles.size).toBe(1);
  });

  it("repairs a pre-existing identity before sessions and remains idempotent", async () => {
    const initial = emptyState();
    initial.authUsers.set("google-user", {
      email: "bewoner@example.test",
      id: "google-user",
      name: "  Nieuwe   bewoner  ",
    });
    const harness = createHarness(initial, () => false);

    await harness.transaction((transaction, identity) =>
      identity.ensureForSession(transaction, "google-user"));
    await harness.transaction((transaction, identity) =>
      identity.ensureForSession(transaction, "google-user"));

    expect(harness.state().appUsers.size).toBe(1);
    expect(harness.state().mappings.size).toBe(1);
    expect(harness.state().profiles.size).toBe(1);
    expect([...harness.state().profiles.values()][0]?.displayName).toBe("Nieuwe bewoner");
    expect([...harness.state().appUsers.values()][0]?.lastAuthenticatedAt).toEqual(
      new Date("2026-08-04T12:00:00.000Z"),
    );
  });

  it("fails closed for an inactive mapped domain user", async () => {
    const initial = emptyState();
    initial.authUsers.set("suspended-google-user", {
      email: "gepauzeerd@example.test",
      id: "suspended-google-user",
      name: "Gepauzeerde bewoner",
    });
    initial.appUsers.set("00000000-0000-4000-8000-000000000099", { status: "suspended" });
    initial.mappings.set("suspended-google-user", {
      appUserId: "00000000-0000-4000-8000-000000000099",
      migrationStatus: "linked",
    });
    const harness = createHarness(initial, () => false);

    await expect(harness.transaction((transaction, identity) =>
      identity.ensureForSession(transaction, "suspended-google-user")))
      .rejects.toMatchObject({ code: "app_user_inactive" });
    expect(harness.state().appUsers.get("00000000-0000-4000-8000-000000000099"))
      .not.toHaveProperty("lastAuthenticatedAt");
  });
});
