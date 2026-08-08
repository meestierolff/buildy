import type {
  OwnProfile,
  ProfileMutationResult,
  PublicProfile,
} from "../../shared/contracts/profiles.js";
import { HttpError } from "../http/errors.js";
import { jsonError, jsonSuccess } from "../http/responses.js";
import type { ProjectActor, ProjectActorResolver } from "../projects/actor.js";
import { ProjectError } from "../projects/errors.js";
import { ProfileError } from "./errors.js";

const MAX_JSON_BODY_BYTES = 64 * 1024;

export interface ProfileHttpService {
  ownProfile(actorId: string): Promise<OwnProfile>;
  publicProfile(viewer: ProjectActor, slug: string): Promise<PublicProfile>;
  updateOwnProfile(actorId: string, input: unknown): Promise<ProfileMutationResult>;
}

export type ProfileHttpDependencies = {
  actors: ProjectActorResolver;
  service: ProfileHttpService;
};

async function jsonInput(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpError(400, "BAD_REQUEST", "Gebruik application/json voor deze aanvraag.");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    throw new HttpError(400, "BAD_REQUEST", "De aanvraag is te groot.");
  }
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_JSON_BODY_BYTES) {
    throw new HttpError(400, "BAD_REQUEST", "De aanvraag is te groot.");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new HttpError(400, "BAD_REQUEST", "De JSON-body is ongeldig.");
  }
}

function ensureNoQuery(url: URL): void {
  if ([...url.searchParams].length > 0) {
    throw new HttpError(400, "BAD_REQUEST", "Deze route ondersteunt geen queryparameters.");
  }
}

function decodedSlug(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ProfileError("PROFILE_NOT_FOUND");
  }
}

function rethrowProfileError(error: unknown): never {
  if (error instanceof ProfileError || error instanceof ProjectError) {
    throw new HttpError(error.status, error.apiCode, error.message);
  }
  throw error;
}

export function createProfileHttpHandler(dependencies: ProfileHttpDependencies) {
  return async (request: Request, requestId: string): Promise<Response> => {
    try {
      const viewer = await dependencies.actors.resolve(request);
      const authenticatedActorId = (): string => {
        if (viewer.kind !== "authenticated") throw new ProfileError("ACTOR_REQUIRED");
        return viewer.appUserId;
      };
      const url = new URL(request.url);
      ensureNoQuery(url);
      const pathname = url.pathname.replace(/\/$/, "") || "/";

      if (pathname === "/api/account/profile") {
        if (request.method === "GET") {
          return jsonSuccess(
            await dependencies.service.ownProfile(authenticatedActorId()),
            requestId,
          );
        }
        if (request.method === "PATCH") {
          return jsonSuccess(
            await dependencies.service.updateOwnProfile(
              authenticatedActorId(),
              await jsonInput(request),
            ),
            requestId,
          );
        }
      }

      const publicMatch = /^\/api\/profiles\/([^/]+)$/.exec(pathname);
      if (publicMatch && request.method === "GET") {
        return jsonSuccess(
          await dependencies.service.publicProfile(viewer, decodedSlug(publicMatch[1])),
          requestId,
        );
      }

      return jsonError(404, "NOT_FOUND", "Deze API-route bestaat niet.", requestId);
    } catch (error) {
      rethrowProfileError(error);
    }
  };
}
