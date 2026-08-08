import type {
  ProjectAccessList,
  ProjectSocialState,
  SocialMutationResult,
  SocialProfile,
  SocialProfilePage,
} from "../../shared/contracts/social.js";
import { HttpError } from "../http/errors.js";
import { jsonError, jsonSuccess } from "../http/responses.js";
import { SocialError } from "./errors.js";

export interface SocialActorResolver {
  /** Returns only the stable, active Buildy app-user ID from trusted session state. */
  resolveAppUserId(request: Request): Promise<string | null>;
}

export interface SocialHttpService {
  profile(viewerId: string | null, profileId: string): Promise<SocialProfile>;
  search(viewerId: string | null, query: unknown): Promise<SocialProfilePage>;
  projectState(actorId: string, projectId: string): Promise<ProjectSocialState>;
  projectAccess(actorId: string, projectId: string): Promise<ProjectAccessList>;
  followProfile(actorId: string, profileId: string): Promise<SocialMutationResult>;
  removeProfileFollow(actorId: string, profileId: string): Promise<SocialMutationResult>;
  acceptProfileFollow(actorId: string, requesterId: string): Promise<SocialMutationResult>;
  rejectProfileFollow(actorId: string, requesterId: string): Promise<SocialMutationResult>;
  revokeProfileFollower(actorId: string, followerId: string): Promise<SocialMutationResult>;
  blockProfile(actorId: string, profileId: string): Promise<SocialMutationResult>;
  unblockProfile(actorId: string, profileId: string): Promise<SocialMutationResult>;
  followProject(actorId: string, projectId: string): Promise<SocialMutationResult>;
  unfollowProject(actorId: string, projectId: string): Promise<SocialMutationResult>;
  requestProjectAccess(actorId: string, projectId: string): Promise<SocialMutationResult>;
  cancelProjectAccess(actorId: string, projectId: string): Promise<SocialMutationResult>;
  acceptProjectAccess(
    actorId: string,
    projectId: string,
    requesterId: string,
  ): Promise<SocialMutationResult>;
  rejectProjectAccess(
    actorId: string,
    projectId: string,
    requesterId: string,
  ): Promise<SocialMutationResult>;
  revokeProjectAccess(
    actorId: string,
    projectId: string,
    requesterId: string,
  ): Promise<SocialMutationResult>;
}

export interface SocialHttpDependencies {
  actors: SocialActorResolver;
  service: SocialHttpService;
}

function queryInput(url: URL): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (key in result) {
      throw new HttpError(400, "BAD_REQUEST", "Een queryparameter staat dubbel in de URL.");
    }
    result[key] = value;
  }
  return result;
}

function oneParameter(pathname: string, expression: RegExp): string | undefined {
  return expression.exec(pathname)?.[1];
}

function twoParameters(
  pathname: string,
  expression: RegExp,
): [string, string] | undefined {
  const match = expression.exec(pathname);
  return match?.[1] && match[2] ? [match[1], match[2]] : undefined;
}

function rethrowSocialError(error: unknown): never {
  if (error instanceof SocialError) {
    throw new HttpError(error.status, error.apiCode, error.message);
  }
  throw error;
}

export function createSocialHttpHandler(dependencies: SocialHttpDependencies) {
  return async (request: Request, requestId: string): Promise<Response> => {
    try {
      const viewerId = await dependencies.actors.resolveAppUserId(request);
      const authenticatedActor = (): string => {
        if (!viewerId) throw new SocialError("ACTOR_REQUIRED");
        return viewerId;
      };
      const url = new URL(request.url);
      const pathname = url.pathname.replace(/\/$/, "") || "/";

      if (request.method === "GET" && pathname === "/api/social/profiles") {
        return jsonSuccess(
          await dependencies.service.search(viewerId, queryInput(url)),
          requestId,
        );
      }

      const profileFollowId = oneParameter(
        pathname,
        /^\/api\/social\/profiles\/([^/]+)\/follow$/,
      );
      if (profileFollowId && request.method === "PUT") {
        return jsonSuccess(
          await dependencies.service.followProfile(authenticatedActor(), profileFollowId),
          requestId,
        );
      }
      if (profileFollowId && request.method === "DELETE") {
        return jsonSuccess(
          await dependencies.service.removeProfileFollow(
            authenticatedActor(),
            profileFollowId,
          ),
          requestId,
        );
      }

      const profileBlockId = oneParameter(
        pathname,
        /^\/api\/social\/profiles\/([^/]+)\/block$/,
      );
      if (profileBlockId && request.method === "PUT") {
        return jsonSuccess(
          await dependencies.service.blockProfile(authenticatedActor(), profileBlockId),
          requestId,
        );
      }
      if (profileBlockId && request.method === "DELETE") {
        return jsonSuccess(
          await dependencies.service.unblockProfile(authenticatedActor(), profileBlockId),
          requestId,
        );
      }

      const profileId = oneParameter(pathname, /^\/api\/social\/profiles\/([^/]+)$/);
      if (profileId && request.method === "GET") {
        return jsonSuccess(
          await dependencies.service.profile(viewerId, profileId),
          requestId,
        );
      }

      const acceptedRequesterId = oneParameter(
        pathname,
        /^\/api\/social\/follow-requests\/([^/]+)\/accept$/,
      );
      if (acceptedRequesterId && request.method === "POST") {
        return jsonSuccess(
          await dependencies.service.acceptProfileFollow(
            authenticatedActor(),
            acceptedRequesterId,
          ),
          requestId,
        );
      }

      const rejectedRequesterId = oneParameter(
        pathname,
        /^\/api\/social\/follow-requests\/([^/]+)\/reject$/,
      );
      if (rejectedRequesterId && request.method === "POST") {
        return jsonSuccess(
          await dependencies.service.rejectProfileFollow(
            authenticatedActor(),
            rejectedRequesterId,
          ),
          requestId,
        );
      }

      const followerId = oneParameter(
        pathname,
        /^\/api\/social\/followers\/([^/]+)$/,
      );
      if (followerId && request.method === "DELETE") {
        return jsonSuccess(
          await dependencies.service.revokeProfileFollower(
            authenticatedActor(),
            followerId,
          ),
          requestId,
        );
      }

      const projectFollowId = oneParameter(
        pathname,
        /^\/api\/social\/projects\/([^/]+)\/follow$/,
      );
      if (projectFollowId && request.method === "PUT") {
        return jsonSuccess(
          await dependencies.service.followProject(authenticatedActor(), projectFollowId),
          requestId,
        );
      }
      if (projectFollowId && request.method === "DELETE") {
        return jsonSuccess(
          await dependencies.service.unfollowProject(
            authenticatedActor(),
            projectFollowId,
          ),
          requestId,
        );
      }

      const projectStateId = oneParameter(
        pathname,
        /^\/api\/social\/projects\/([^/]+)\/state$/,
      );
      if (projectStateId && request.method === "GET") {
        return jsonSuccess(
          await dependencies.service.projectState(authenticatedActor(), projectStateId),
          requestId,
        );
      }

      const projectAccessListId = oneParameter(
        pathname,
        /^\/api\/social\/projects\/([^/]+)\/access-requests$/,
      );
      if (projectAccessListId && request.method === "GET") {
        return jsonSuccess(
          await dependencies.service.projectAccess(authenticatedActor(), projectAccessListId),
          requestId,
        );
      }

      const projectAccessDecision = twoParameters(
        pathname,
        /^\/api\/social\/projects\/([^/]+)\/access-requests\/([^/]+)\/(accept|reject)$/,
      );
      const decision = /\/(accept|reject)$/.exec(pathname)?.[1];
      if (projectAccessDecision && decision && request.method === "POST") {
        const [projectId, requesterId] = projectAccessDecision;
        const result =
          decision === "accept"
            ? await dependencies.service.acceptProjectAccess(
                authenticatedActor(),
                projectId,
                requesterId,
              )
            : await dependencies.service.rejectProjectAccess(
                authenticatedActor(),
                projectId,
                requesterId,
              );
        return jsonSuccess(result, requestId);
      }

      const projectAccessRevoke = twoParameters(
        pathname,
        /^\/api\/social\/projects\/([^/]+)\/access-requests\/([^/]+)$/,
      );
      if (projectAccessRevoke && request.method === "DELETE") {
        return jsonSuccess(
          await dependencies.service.revokeProjectAccess(
            authenticatedActor(),
            projectAccessRevoke[0],
            projectAccessRevoke[1],
          ),
          requestId,
        );
      }

      const projectAccessId = oneParameter(
        pathname,
        /^\/api\/social\/projects\/([^/]+)\/access$/,
      );
      if (projectAccessId && request.method === "PUT") {
        return jsonSuccess(
          await dependencies.service.requestProjectAccess(
            authenticatedActor(),
            projectAccessId,
          ),
          requestId,
        );
      }
      if (projectAccessId && request.method === "DELETE") {
        return jsonSuccess(
          await dependencies.service.cancelProjectAccess(
            authenticatedActor(),
            projectAccessId,
          ),
          requestId,
        );
      }

      return jsonError(404, "NOT_FOUND", "Deze API-route bestaat niet.", requestId);
    } catch (error) {
      rethrowSocialError(error);
    }
  };
}
