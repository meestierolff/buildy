import type {
  FollowingFeed,
  ProjectOverview,
  ProjectPage,
  ProjectPhase,
  ProjectUpdate,
  ProjectDeletionStatus,
  TimelinePage,
} from "../../shared/contracts/projects.js";
import { HttpError } from "../http/errors.js";
import { jsonError, jsonSuccess } from "../http/responses.js";
import type { ProjectActor, ProjectActorResolver } from "./actor.js";
import { ProjectError } from "./errors.js";

const MAX_JSON_BODY_BYTES = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ProjectRouteParameters = Readonly<Record<string, string>>;

export interface ProjectHttpService {
  createProject(actorId: string, input: unknown): Promise<{ project: ProjectOverview; replayed: boolean }>;
  updateProject(actorId: string, projectId: string, input: unknown): Promise<{
    project: ProjectOverview;
    replayed: false;
  }>;
  requestProjectDeletion(actorId: string, projectId: string, input: unknown): Promise<{
    jobId: string;
    projectId: string;
    status: ProjectDeletionStatus;
    activeOrderCount: number;
    replayed: boolean;
  }>;
  dashboard(actorId: string, query: unknown): Promise<ProjectPage>;
  discovery(viewer: ProjectActor, query: unknown): Promise<ProjectPage>;
  following(actorId: string, query: unknown): Promise<FollowingFeed>;
  overview(viewer: ProjectActor, projectId: string): Promise<ProjectOverview>;
  timeline(viewer: ProjectActor, projectId: string, query: unknown): Promise<TimelinePage>;
  createUpdate(actorId: string, projectId: string, input: unknown): Promise<{
    update: ProjectUpdate;
    replayed: boolean;
  }>;
  editUpdate(actorId: string, projectId: string, updateId: string, input: unknown): Promise<{
    update: ProjectUpdate;
    replayed: boolean;
  }>;
  deleteUpdate(actorId: string, projectId: string, updateId: string, input: unknown): Promise<{
    project: ProjectOverview;
    updateId: string;
    deleted: true;
    replayed: boolean;
  }>;
  createProjectPhase(actorId: string, projectId: string, input: unknown): Promise<{
    project: ProjectOverview;
    phase: ProjectPhase;
    replayed: boolean;
  }>;
}

export type ProjectHttpDependencies = {
  actors: ProjectActorResolver;
  service: ProjectHttpService;
};

function validatedId(value: string | undefined, kind: "project" | "update"): string {
  if (!value || !UUID.test(value)) {
    throw new ProjectError(kind === "project" ? "PROJECT_NOT_FOUND" : "UPDATE_NOT_FOUND");
  }
  return value.toLowerCase();
}

function queryInput(url: URL): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (key in result) throw new HttpError(400, "BAD_REQUEST", "Een queryparameter staat dubbel in de URL.");
    result[key] = value;
  }
  return result;
}

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

function rethrowProjectError(error: unknown): never {
  if (error instanceof ProjectError) {
    throw new HttpError(error.status, error.apiCode, error.message);
  }
  throw error;
}

export function createProjectHttpHandler(dependencies: ProjectHttpDependencies) {
  return async (
    request: Request,
    requestId: string,
    parameters: ProjectRouteParameters = {},
  ): Promise<Response> => {
    try {
      const actor = await dependencies.actors.resolve(request);
      const actorId = actor.kind === "authenticated" ? actor.appUserId.toLowerCase() : undefined;
      if (actorId && !UUID.test(actorId)) throw new ProjectError("ACTOR_MAPPING_UNAVAILABLE");
      const authenticatedActorId = (): string => {
        if (!actorId) throw new ProjectError("ACTOR_REQUIRED");
        return actorId;
      };
      const url = new URL(request.url);
      const pathname = url.pathname.replace(/\/$/, "") || "/";
      const projectId = parameters.projectId
        ? validatedId(parameters.projectId, "project")
        : undefined;
      const updateId = parameters.updateId
        ? validatedId(parameters.updateId, "update")
        : undefined;

      if (request.method === "GET" && pathname === "/api/projects") {
        return jsonSuccess(
          await dependencies.service.dashboard(authenticatedActorId(), queryInput(url)),
          requestId,
        );
      }
      if (request.method === "POST" && pathname === "/api/projects") {
        const result = await dependencies.service.createProject(
          authenticatedActorId(),
          await jsonInput(request),
        );
        return jsonSuccess(result, requestId, { status: result.replayed ? 200 : 201 });
      }
      if (request.method === "GET" && pathname === "/api/discovery") {
        return jsonSuccess(await dependencies.service.discovery(actor, queryInput(url)), requestId);
      }
      if (request.method === "GET" && pathname === "/api/following") {
        return jsonSuccess(
          await dependencies.service.following(authenticatedActorId(), queryInput(url)),
          requestId,
        );
      }
      if (projectId && pathname.endsWith("/phases") && request.method === "POST") {
        const result = await dependencies.service.createProjectPhase(
          authenticatedActorId(),
          projectId,
          await jsonInput(request),
        );
        return jsonSuccess(result, requestId, { status: result.replayed ? 200 : 201 });
      }
      if (
        projectId &&
        !pathname.endsWith("/updates") &&
        !pathname.endsWith("/phases") &&
        !updateId
      ) {
        if (request.method === "GET") {
          return jsonSuccess(await dependencies.service.overview(actor, projectId), requestId);
        }
        if (request.method === "PATCH") {
          return jsonSuccess(
            await dependencies.service.updateProject(
              authenticatedActorId(),
              projectId,
              await jsonInput(request),
            ),
            requestId,
          );
        }
        if (request.method === "DELETE") {
          const result = await dependencies.service.requestProjectDeletion(
            authenticatedActorId(),
            projectId,
            await jsonInput(request),
          );
          return jsonSuccess({
            deletion: {
              id: result.jobId,
              projectId: result.projectId,
              status: result.status,
              activeOrderCount: result.activeOrderCount,
            },
            replayed: result.replayed,
          }, requestId, { status: result.replayed ? 200 : 202 });
        }
      }
      if (projectId && pathname.endsWith("/updates") && !updateId) {
        if (request.method === "GET") {
          return jsonSuccess(
            await dependencies.service.timeline(actor, projectId, queryInput(url)),
            requestId,
          );
        }
        if (request.method === "POST") {
          const result = await dependencies.service.createUpdate(
            authenticatedActorId(),
            projectId,
            await jsonInput(request),
          );
          return jsonSuccess(result, requestId, { status: result.replayed ? 200 : 201 });
        }
      }
      if (projectId && updateId) {
        if (request.method === "PATCH") {
          return jsonSuccess(
            await dependencies.service.editUpdate(
              authenticatedActorId(),
              projectId,
              updateId,
              await jsonInput(request),
            ),
            requestId,
          );
        }
        if (request.method === "DELETE") {
          return jsonSuccess(
            await dependencies.service.deleteUpdate(
              authenticatedActorId(),
              projectId,
              updateId,
              await jsonInput(request),
            ),
            requestId,
          );
        }
      }

      return jsonError(404, "NOT_FOUND", "Deze API-route bestaat niet.", requestId);
    } catch (error) {
      rethrowProjectError(error);
    }
  };
}
