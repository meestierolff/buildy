import { ProjectError } from "./errors.js";

export type AuthenticatedProjectActor = {
  kind: "authenticated";
  appUserId: string;
};

export type AnonymousProjectActor = {
  kind: "anonymous";
};

export type ProjectActor = AuthenticatedProjectActor | AnonymousProjectActor;

export const ANONYMOUS_PROJECT_ACTOR: AnonymousProjectActor = Object.freeze({ kind: "anonymous" });

/** Reads the authenticated provider subject from trusted server session state. */
export interface AuthenticatedSubjectResolver {
  resolveAuthUserId(request: Request): Promise<string | null>;
}

/** Maps a provider-owned auth ID to one active, stable Buildy app-user ID. */
export interface ActiveAppUserLookup {
  findActiveAppUserId(authUserId: string): Promise<string | null>;
}

export interface ProjectActorResolver {
  resolve(request: Request): Promise<ProjectActor>;
}

export class StrictMappedProjectActorResolver implements ProjectActorResolver {
  constructor(
    private readonly subjects: AuthenticatedSubjectResolver,
    private readonly appUsers: ActiveAppUserLookup,
  ) {}

  async resolve(request: Request): Promise<ProjectActor> {
    const authUserId = await this.subjects.resolveAuthUserId(request);
    if (!authUserId) return ANONYMOUS_PROJECT_ACTOR;

    const appUserId = await this.appUsers.findActiveAppUserId(authUserId);
    if (!appUserId) throw new ProjectError("ACTOR_MAPPING_UNAVAILABLE");
    return { kind: "authenticated", appUserId };
  }
}

/** Safe default until Better Auth session resolution is composed at runtime. */
export class FailClosedProjectActorResolver implements ProjectActorResolver {
  async resolve(): Promise<AnonymousProjectActor> {
    return ANONYMOUS_PROJECT_ACTOR;
  }
}
