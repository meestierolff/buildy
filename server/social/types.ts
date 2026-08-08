import type {
  ProjectAccessList,
  ProjectSocialState,
  SocialMutationResult,
  SocialProfile,
} from "../../shared/contracts/social.js";
import type { ProfileCursor } from "./cursor.js";

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

export interface SocialRepository {
  findProfile(viewerId: SocialViewerId, profileId: string): Promise<SocialProfile | null>;
  searchProfiles(viewerId: SocialViewerId, search: ProfileSearch): Promise<ProfileListRecord[]>;

  getProjectState(actorId: SocialActorId, projectId: string): Promise<ProjectSocialState | null>;
  listProjectAccess(actorId: SocialActorId, projectId: string): Promise<ProjectAccessList | null>;

  followProfile(actorId: SocialActorId, profileId: string, now: Date): Promise<SocialMutationResult>;
  removeProfileFollow(actorId: SocialActorId, profileId: string, now: Date): Promise<SocialMutationResult>;
  acceptProfileFollow(actorId: SocialActorId, requesterId: string, now: Date): Promise<SocialMutationResult>;
  rejectProfileFollow(actorId: SocialActorId, requesterId: string, now: Date): Promise<SocialMutationResult>;
  revokeProfileFollower(actorId: SocialActorId, followerId: string, now: Date): Promise<SocialMutationResult>;

  blockProfile(actorId: SocialActorId, profileId: string, now: Date): Promise<SocialMutationResult>;
  unblockProfile(actorId: SocialActorId, profileId: string, now: Date): Promise<SocialMutationResult>;

  followProject(actorId: SocialActorId, projectId: string, now: Date): Promise<SocialMutationResult>;
  unfollowProject(actorId: SocialActorId, projectId: string, now: Date): Promise<SocialMutationResult>;
  requestProjectAccess(actorId: SocialActorId, projectId: string, now: Date): Promise<SocialMutationResult>;
  cancelProjectAccess(actorId: SocialActorId, projectId: string, now: Date): Promise<SocialMutationResult>;
  acceptProjectAccess(actorId: SocialActorId, projectId: string, requesterId: string, now: Date): Promise<SocialMutationResult>;
  rejectProjectAccess(actorId: SocialActorId, projectId: string, requesterId: string, now: Date): Promise<SocialMutationResult>;
  revokeProjectAccess(actorId: SocialActorId, projectId: string, requesterId: string, now: Date): Promise<SocialMutationResult>;
}

export type SocialClock = () => Date;
