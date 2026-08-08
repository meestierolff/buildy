// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { DBAdapter } from "better-auth";
import {
  createAuthIdentityProvisioner,
  type AuthIdentityPersistence,
  type AuthIdentityUser,
  type AuthNewUserAuthorizer,
  withAuthIdentityProvisioning,
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
  sessions: Array<{ id: string; userId: string }>;
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
    sessions: [],
  };
}

function cloneState(state: TestState): TestState {
  return {
    appUsers: new Map(
      [...state.appUsers].map(([id, user]) => [id, { ...user }]),
    ),
    authUsers: new Map(
      [...state.authUsers].map(([id, user]) => [id, { ...user }]),
    ),
    mappings: new Map(
      [...state.mappings].map(([id, mapping]) => [id, { ...mapping }]),
    ),
    profiles: new Map(
      [...state.profiles].map(([id, profile]) => [id, { ...profile }]),
    ),
    sessions: state.sessions.map((session) => ({ ...session })),
  };
}

function createTestPersistence(shouldFailProfile: () => boolean) {
  const persistence: AuthIdentityPersistence<TestTransaction> = {
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
      const appUser = transaction.state.appUsers.get(appUserId);
      if (!appUser || appUser.status !== "active") return false;
      appUser.lastAuthenticatedAt = now;
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
  return persistence;
}

function fakeBaseAdapter(state: TestState): DBAdapter {
  let nextSession = state.sessions.length;
  const create = (async ({
    data,
    model,
  }: Parameters<DBAdapter["create"]>[0]): Promise<unknown> => {
    const values = data as Record<string, unknown>;
    if (model === "user") {
      const user: AuthIdentityUser = {
        email: String(values.email),
        id: String(values.id ?? "auth-created"),
        name: String(values.name),
      };
      state.authUsers.set(user.id, user);
      return user;
    }
    if (model === "session") {
      const session = {
        id: `session-${++nextSession}`,
        userId: String(values.userId),
      };
      state.sessions.push(session);
      return session;
    }
    return values;
  }) as DBAdapter["create"];

  return {
    create,
    id: "fake",
  } as unknown as DBAdapter;
}

function createHarness(
  initial: TestState,
  shouldFailProfile: () => boolean,
  authorizer?: AuthNewUserAuthorizer<TestTransaction>,
) {
  let committed = initial;
  let nextAppUser = 0;
  const provisioner = createAuthIdentityProvisioner({
    generateId: () => `00000000-0000-4000-8000-${String(++nextAppUser).padStart(12, "0")}`,
    now: () => new Date("2026-08-04T12:00:00.000Z"),
    persistence: createTestPersistence(shouldFailProfile),
  });

  const adapter = withAuthIdentityProvisioning({
    authorizer,
    baseAdapter: fakeBaseAdapter(committed),
    async beginTransaction(callback) {
      const draft = cloneState(committed);
      const result = await callback({ state: draft }, fakeBaseAdapter(draft));
      committed = draft;
      return result;
    },
    provisioner,
  });

  return { adapter, state: () => committed };
}

describe("auth identity transaction boundary", () => {
  it("rolls the auth user back when domain provisioning fails", async () => {
    let failProfile = true;
    const harness = createHarness(emptyState(), () => failProfile);

    await expect(
      harness.adapter.create<AuthIdentityUser>({
        data: { email: "owner@example.test", name: "Eigenaar" },
        model: "user",
      }),
    ).rejects.toThrow("profile_write_failed");

    expect(harness.state().authUsers.size).toBe(0);
    expect(harness.state().appUsers.size).toBe(0);
    expect(harness.state().mappings.size).toBe(0);

    failProfile = false;
    await harness.adapter.create<AuthIdentityUser>({
      data: { email: "owner@example.test", name: "Eigenaar" },
      model: "user",
    });

    expect(harness.state().authUsers.size).toBe(1);
    expect(harness.state().appUsers.size).toBe(1);
    expect(harness.state().mappings.size).toBe(1);
    expect(harness.state().profiles.size).toBe(1);
  });

  it("repairs a pre-existing auth user before sessions and remains idempotent", async () => {
    const initial = emptyState();
    initial.authUsers.set("orphan-auth-user", {
      email: "bewoner@example.test",
      id: "orphan-auth-user",
      name: "  Nieuwe   bewoner  ",
    });
    const harness = createHarness(initial, () => false);

    await harness.adapter.create({
      data: { userId: "orphan-auth-user" },
      model: "session",
    });
    await harness.adapter.create({
      data: { userId: "orphan-auth-user" },
      model: "session",
    });

    expect(harness.state().appUsers.size).toBe(1);
    expect(harness.state().mappings.size).toBe(1);
    expect(harness.state().profiles.size).toBe(1);
    expect(harness.state().sessions).toHaveLength(2);
    expect([...harness.state().profiles.values()][0]?.displayName).toBe("Nieuwe bewoner");
    expect([...harness.state().appUsers.values()][0]?.lastAuthenticatedAt).toEqual(
      new Date("2026-08-04T12:00:00.000Z"),
    );
  });

  it("rolls auth and domain identity back when new-user authorization fails", async () => {
    const authorizeNewUser = vi.fn(async (transaction: TestTransaction) => {
      expect(transaction.state.authUsers.size).toBe(1);
      expect(transaction.state.mappings.size).toBe(1);
      expect(transaction.state.profiles.size).toBe(1);
      throw new Error("beta_invite_required");
    });
    const harness = createHarness(emptyState(), () => false, { authorizeNewUser });

    await expect(harness.adapter.create<AuthIdentityUser>({
      data: { email: "new@example.test", name: "Nieuwe tester" },
      model: "user",
    })).rejects.toThrow("beta_invite_required");

    expect(authorizeNewUser).toHaveBeenCalledOnce();
    expect(harness.state().authUsers.size).toBe(0);
    expect(harness.state().appUsers.size).toBe(0);
    expect(harness.state().mappings.size).toBe(0);
    expect(harness.state().profiles.size).toBe(0);
  });

  it("fails closed before creating a session for an inactive domain user", async () => {
    const initial = emptyState();
    initial.authUsers.set("suspended-auth-user", {
      email: "gepauzeerd@example.test",
      id: "suspended-auth-user",
      name: "Gepauzeerde bewoner",
    });
    initial.appUsers.set("00000000-0000-4000-8000-000000000099", {
      status: "suspended",
    });
    initial.mappings.set("suspended-auth-user", {
      appUserId: "00000000-0000-4000-8000-000000000099",
      migrationStatus: "linked",
    });
    const harness = createHarness(initial, () => false);

    await expect(
      harness.adapter.create({
        data: { userId: "suspended-auth-user" },
        model: "session",
      }),
    ).rejects.toMatchObject({ code: "app_user_inactive" });

    expect(harness.state().sessions).toHaveLength(0);
  });
});
