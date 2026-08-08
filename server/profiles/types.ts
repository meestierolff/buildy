import type {
  OwnProfile,
  ProfileMutationResult,
  PublicProfile,
  UpdateOwnProfileInput,
} from "../../shared/contracts/profiles.js";
import type { ProjectActor } from "../projects/actor.js";

export type UpdateProfileCommand = {
  actorId: string;
  idempotencyKey: string;
  requestHash: string;
  input: UpdateOwnProfileInput;
};

export interface ProfileRepository {
  findOwnProfile(actorId: string): Promise<OwnProfile | null>;
  findPublicProfile(viewer: ProjectActor, slug: string): Promise<PublicProfile | null>;
  updateOwnProfile(command: UpdateProfileCommand): Promise<ProfileMutationResult>;
}
