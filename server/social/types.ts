import type {
  SocialConnection,
  SocialConnectionView,
  SocialMutationResult,
  SocialProfile,
} from "../../shared/contracts/social.js";
import type { ConnectionCursor, ProfileCursor } from "./cursor.js";

export type SocialActorId = string;
export type SocialViewerId = SocialActorId | null;

export type ProfileListRecord = SocialProfile & {
  cursorTimestamp: string;
};

export type ProfileSearch = {
  cursor: ProfileCursor | undefined;
  limit: number;
  normalizedQuery: string;
};

export type ConnectionListRecord = SocialConnection & {
  cursorTimestamp: string;
  totalCount: number;
};

export type ConnectionListSearch = {
  cursor: ConnectionCursor | undefined;
  limit: number;
  view: SocialConnectionView;
};

export interface SocialRepository {
  findProfile(viewerId: SocialViewerId, profileId: string): Promise<SocialProfile | null>;
  searchProfiles(viewerId: SocialViewerId, search: ProfileSearch): Promise<ProfileListRecord[]>;
  listConnections(
    actorId: SocialActorId,
    search: ConnectionListSearch,
  ): Promise<ConnectionListRecord[]>;

  followProfile(actorId: SocialActorId, profileId: string, now: Date): Promise<SocialMutationResult>;
  removeProfileFollow(actorId: SocialActorId, profileId: string, now: Date): Promise<SocialMutationResult>;
  acceptProfileFollow(actorId: SocialActorId, requesterId: string, now: Date): Promise<SocialMutationResult>;
  rejectProfileFollow(actorId: SocialActorId, requesterId: string, now: Date): Promise<SocialMutationResult>;
  revokeProfileFollower(actorId: SocialActorId, followerId: string, now: Date): Promise<SocialMutationResult>;

  blockProfile(actorId: SocialActorId, profileId: string, now: Date): Promise<SocialMutationResult>;
  unblockProfile(actorId: SocialActorId, profileId: string, now: Date): Promise<SocialMutationResult>;

}

export type SocialClock = () => Date;
