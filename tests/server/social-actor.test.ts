// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { StrictMappedSocialActorResolver } from "../../server/social/actor";

const request = new Request("https://app.buildy.test/api/social/profiles");

describe("StrictMappedSocialActorResolver", () => {
  it("keeps anonymous reads anonymous", async () => {
    const resolver = new StrictMappedSocialActorResolver(
      { resolveAuthUserId: vi.fn().mockResolvedValue(null) },
      { findActiveAppUserId: vi.fn() },
    );
    await expect(resolver.resolveAppUserId(request)).resolves.toBeNull();
  });

  it("returns only the stable mapped app-user ID", async () => {
    const appUserId = "00000000-0000-4000-8000-000000000001";
    const lookup = { findActiveAppUserId: vi.fn().mockResolvedValue(appUserId) };
    const resolver = new StrictMappedSocialActorResolver(
      { resolveAuthUserId: vi.fn().mockResolvedValue("provider-owned-subject") },
      lookup,
    );
    await expect(resolver.resolveAppUserId(request)).resolves.toBe(appUserId);
    expect(lookup.findActiveAppUserId).toHaveBeenCalledWith("provider-owned-subject");
  });

  it("fails closed when an authenticated subject has no active mapping", async () => {
    const resolver = new StrictMappedSocialActorResolver(
      { resolveAuthUserId: vi.fn().mockResolvedValue("orphan-auth-user") },
      { findActiveAppUserId: vi.fn().mockResolvedValue(null) },
    );
    await expect(resolver.resolveAppUserId(request)).rejects.toMatchObject({
      reason: "ACTOR_MAPPING_UNAVAILABLE",
      status: 503,
    });
  });
});
