import { SocialError } from "./errors.js";
import type { SocialActorResolver } from "./http.js";

export interface SocialAuthenticatedSubjectResolver {
  resolveAuthUserId(request: Request): Promise<string | null>;
}

export interface SocialActiveAppUserLookup {
  findActiveAppUserId(authUserId: string): Promise<string | null>;
}

/** Resolves provider identity to one stable, active Buildy app-user ID. */
export class StrictMappedSocialActorResolver implements SocialActorResolver {
  constructor(
    private readonly subjects: SocialAuthenticatedSubjectResolver,
    private readonly appUsers: SocialActiveAppUserLookup,
  ) {}

  async resolveAppUserId(request: Request): Promise<string | null> {
    const authUserId = await this.subjects.resolveAuthUserId(request);
    if (!authUserId) return null;
    const appUserId = await this.appUsers.findActiveAppUserId(authUserId);
    if (!appUserId) throw new SocialError("ACTOR_MAPPING_UNAVAILABLE");
    return appUserId;
  }
}
