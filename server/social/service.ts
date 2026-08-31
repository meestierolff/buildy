import {
  profileSearchQuerySchema,
  socialConnectionQuerySchema,
  type SocialConnectionPage,
  type SocialMutationResult,
  type SocialProfile,
  type SocialProfilePage,
} from "../../shared/contracts/social.js";
import {
  decodeConnectionCursor,
  decodeProfileCursor,
  encodeConnectionCursor,
  encodeProfileCursor,
} from "./cursor.js";
import { SocialError } from "./errors.js";
import type { SocialClock, SocialRepository, SocialViewerId } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function targetId(value: string): string {
  if (!UUID.test(value)) throw new SocialError("TARGET_NOT_FOUND");
  return value.toLowerCase();
}

function actorId(value: string): string {
  if (!UUID.test(value)) throw new SocialError("ACTOR_MAPPING_UNAVAILABLE");
  return value.toLowerCase();
}

function differentUsers(actor: string, target: string): void {
  if (actor === target) throw new SocialError("SELF_ACTION");
}

export class SocialService {
  constructor(
    private readonly repository: SocialRepository,
    private readonly clock: SocialClock = () => new Date(),
  ) {}

  async profile(viewerId: SocialViewerId, rawProfileId: string): Promise<SocialProfile> {
    const viewer = viewerId ? actorId(viewerId) : null;
    const profile = await this.repository.findProfile(viewer, targetId(rawProfileId));
    if (!profile) throw new SocialError("TARGET_NOT_FOUND");
    return profile;
  }

  async search(viewerId: SocialViewerId, rawQuery: unknown): Promise<SocialProfilePage> {
    const viewer = viewerId ? actorId(viewerId) : null;
    const query = profileSearchQuerySchema.parse(rawQuery);
    const normalizedQuery = query.q?.toLocaleLowerCase("nl-NL") ?? "";
    const cursor = decodeProfileCursor(query.cursor, normalizedQuery);
    const rows = await this.repository.searchProfiles(viewer, {
      cursor,
      limit: query.limit + 1,
      normalizedQuery,
    });
    const selected = rows.slice(0, query.limit);
    const last = selected.at(-1);
    return {
      items: selected.map(({ cursorTimestamp: _cursorTimestamp, ...profile }) => profile),
      nextCursor:
        rows.length > query.limit && last
          ? encodeProfileCursor({
              id: last.id,
              kind: "profiles",
              query: normalizedQuery,
              timestamp: last.cursorTimestamp,
              version: 1,
            })
          : null,
    };
  }

  async connections(actor: string, rawQuery: unknown): Promise<SocialConnectionPage> {
    const source = actorId(actor);
    const query = socialConnectionQuerySchema.parse(rawQuery);
    const cursor = decodeConnectionCursor(query.cursor, query.view);
    const rows = await this.repository.listConnections(source, {
      cursor,
      limit: query.limit + 1,
      view: query.view,
    });
    const selected = rows.slice(0, query.limit);
    const last = selected.at(-1);
    return {
      items: selected.map(({
        cursorTimestamp: _cursorTimestamp,
        totalCount: _totalCount,
        ...connection
      }) => connection),
      nextCursor:
        rows.length > query.limit && last
          ? encodeConnectionCursor({
              id: last.id,
              kind: "connections",
              timestamp: last.cursorTimestamp,
              version: 1,
              view: query.view,
            })
          : null,
      total: rows[0]?.totalCount ?? 0,
      view: query.view,
    };
  }

  async followProfile(actor: string, profile: string): Promise<SocialMutationResult> {
    const source = actorId(actor);
    const target = targetId(profile);
    differentUsers(source, target);
    return this.repository.followProfile(source, target, this.clock());
  }

  async removeProfileFollow(actor: string, profile: string): Promise<SocialMutationResult> {
    const source = actorId(actor);
    const target = targetId(profile);
    differentUsers(source, target);
    return this.repository.removeProfileFollow(source, target, this.clock());
  }

  async acceptProfileFollow(actor: string, requester: string): Promise<SocialMutationResult> {
    const target = actorId(actor);
    const source = targetId(requester);
    differentUsers(target, source);
    return this.repository.acceptProfileFollow(target, source, this.clock());
  }

  async rejectProfileFollow(actor: string, requester: string): Promise<SocialMutationResult> {
    const target = actorId(actor);
    const source = targetId(requester);
    differentUsers(target, source);
    return this.repository.rejectProfileFollow(target, source, this.clock());
  }

  async revokeProfileFollower(actor: string, follower: string): Promise<SocialMutationResult> {
    const target = actorId(actor);
    const source = targetId(follower);
    differentUsers(target, source);
    return this.repository.revokeProfileFollower(target, source, this.clock());
  }

  async blockProfile(actor: string, profile: string): Promise<SocialMutationResult> {
    const source = actorId(actor);
    const target = targetId(profile);
    differentUsers(source, target);
    return this.repository.blockProfile(source, target, this.clock());
  }

  async unblockProfile(actor: string, profile: string): Promise<SocialMutationResult> {
    const source = actorId(actor);
    const target = targetId(profile);
    differentUsers(source, target);
    return this.repository.unblockProfile(source, target, this.clock());
  }

}
