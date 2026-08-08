import type {
  FloorplanBoard,
  PlanningMutationResult,
  ProjectBudget,
} from "../../shared/contracts/planning.js";
import { HttpError } from "../http/errors.js";
import { jsonError, jsonSuccess } from "../http/responses.js";
import type { ProjectActor, ProjectActorResolver } from "../projects/actor.js";
import { ProjectError } from "../projects/errors.js";
import { PlanningError } from "./errors.js";

const MAX_JSON_BODY_BYTES = 64 * 1024;

export interface PlanningHttpService {
  floorplans(viewer: ProjectActor, projectId: string): Promise<FloorplanBoard>;
  createFloorplan(actorId: string, projectId: string, input: unknown): Promise<PlanningMutationResult>;
  updateFloorplan(
    actorId: string,
    projectId: string,
    floorplanId: string,
    input: unknown,
  ): Promise<PlanningMutationResult>;
  deleteFloorplan(
    actorId: string,
    projectId: string,
    floorplanId: string,
    input: unknown,
  ): Promise<PlanningMutationResult>;
  createPin(
    actorId: string,
    projectId: string,
    floorplanId: string,
    input: unknown,
  ): Promise<PlanningMutationResult>;
  updatePin(
    actorId: string,
    projectId: string,
    floorplanId: string,
    pinId: string,
    input: unknown,
  ): Promise<PlanningMutationResult>;
  deletePin(
    actorId: string,
    projectId: string,
    floorplanId: string,
    pinId: string,
    input: unknown,
  ): Promise<PlanningMutationResult>;
  budget(actorId: string, projectId: string): Promise<ProjectBudget>;
  createBudget(actorId: string, projectId: string, input: unknown): Promise<PlanningMutationResult>;
  updateBudget(actorId: string, projectId: string, input: unknown): Promise<PlanningMutationResult>;
  deleteBudget(actorId: string, projectId: string, input: unknown): Promise<PlanningMutationResult>;
  createBudgetItem(actorId: string, projectId: string, input: unknown): Promise<PlanningMutationResult>;
  updateBudgetItem(
    actorId: string,
    projectId: string,
    itemId: string,
    input: unknown,
  ): Promise<PlanningMutationResult>;
  deleteBudgetItem(
    actorId: string,
    projectId: string,
    itemId: string,
    input: unknown,
  ): Promise<PlanningMutationResult>;
}

export type PlanningHttpDependencies = {
  actors: ProjectActorResolver;
  service: PlanningHttpService;
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

function rethrowPlanningError(error: unknown): never {
  if (error instanceof PlanningError || error instanceof ProjectError) {
    throw new HttpError(error.status, error.apiCode, error.message);
  }
  throw error;
}

function created(result: PlanningMutationResult, requestId: string): Response {
  return jsonSuccess(result, requestId, { status: result.replayed ? 200 : 201 });
}

export function createPlanningHttpHandler(dependencies: PlanningHttpDependencies) {
  return async (request: Request, requestId: string): Promise<Response> => {
    try {
      const viewer = await dependencies.actors.resolve(request);
      const authenticatedActor = (): string => {
        if (viewer.kind !== "authenticated") throw new PlanningError("ACTOR_REQUIRED");
        return viewer.appUserId;
      };
      const url = new URL(request.url);
      ensureNoQuery(url);
      const pathname = url.pathname.replace(/\/$/, "") || "/";

      const pinMatch = /^\/api\/projects\/([^/]+)\/floorplans\/([^/]+)\/pins\/([^/]+)$/.exec(pathname);
      if (pinMatch) {
        const [, projectId, floorplanId, pinId] = pinMatch;
        if (request.method === "PATCH") {
          return jsonSuccess(
            await dependencies.service.updatePin(
              authenticatedActor(), projectId, floorplanId, pinId, await jsonInput(request),
            ),
            requestId,
          );
        }
        if (request.method === "DELETE") {
          return jsonSuccess(
            await dependencies.service.deletePin(
              authenticatedActor(), projectId, floorplanId, pinId, await jsonInput(request),
            ),
            requestId,
          );
        }
      }

      const pinsMatch = /^\/api\/projects\/([^/]+)\/floorplans\/([^/]+)\/pins$/.exec(pathname);
      if (pinsMatch && request.method === "POST") {
        const [, projectId, floorplanId] = pinsMatch;
        return created(
          await dependencies.service.createPin(
            authenticatedActor(), projectId, floorplanId, await jsonInput(request),
          ),
          requestId,
        );
      }

      const floorplanMatch = /^\/api\/projects\/([^/]+)\/floorplans\/([^/]+)$/.exec(pathname);
      if (floorplanMatch) {
        const [, projectId, floorplanId] = floorplanMatch;
        if (request.method === "PATCH") {
          return jsonSuccess(
            await dependencies.service.updateFloorplan(
              authenticatedActor(), projectId, floorplanId, await jsonInput(request),
            ),
            requestId,
          );
        }
        if (request.method === "DELETE") {
          return jsonSuccess(
            await dependencies.service.deleteFloorplan(
              authenticatedActor(), projectId, floorplanId, await jsonInput(request),
            ),
            requestId,
          );
        }
      }

      const floorplansMatch = /^\/api\/projects\/([^/]+)\/floorplans$/.exec(pathname);
      if (floorplansMatch) {
        const projectId = floorplansMatch[1];
        if (request.method === "GET") {
          return jsonSuccess(await dependencies.service.floorplans(viewer, projectId), requestId);
        }
        if (request.method === "POST") {
          return created(
            await dependencies.service.createFloorplan(
              authenticatedActor(), projectId, await jsonInput(request),
            ),
            requestId,
          );
        }
      }

      const budgetItemMatch = /^\/api\/projects\/([^/]+)\/budget\/items\/([^/]+)$/.exec(pathname);
      if (budgetItemMatch) {
        const [, projectId, itemId] = budgetItemMatch;
        if (request.method === "PATCH") {
          return jsonSuccess(
            await dependencies.service.updateBudgetItem(
              authenticatedActor(), projectId, itemId, await jsonInput(request),
            ),
            requestId,
          );
        }
        if (request.method === "DELETE") {
          return jsonSuccess(
            await dependencies.service.deleteBudgetItem(
              authenticatedActor(), projectId, itemId, await jsonInput(request),
            ),
            requestId,
          );
        }
      }

      const budgetItemsMatch = /^\/api\/projects\/([^/]+)\/budget\/items$/.exec(pathname);
      if (budgetItemsMatch && request.method === "POST") {
        return created(
          await dependencies.service.createBudgetItem(
            authenticatedActor(), budgetItemsMatch[1], await jsonInput(request),
          ),
          requestId,
        );
      }

      const budgetMatch = /^\/api\/projects\/([^/]+)\/budget$/.exec(pathname);
      if (budgetMatch) {
        const projectId = budgetMatch[1];
        if (request.method === "GET") {
          return jsonSuccess(await dependencies.service.budget(authenticatedActor(), projectId), requestId);
        }
        if (request.method === "POST") {
          return created(
            await dependencies.service.createBudget(
              authenticatedActor(), projectId, await jsonInput(request),
            ),
            requestId,
          );
        }
        if (request.method === "PATCH") {
          return jsonSuccess(
            await dependencies.service.updateBudget(
              authenticatedActor(), projectId, await jsonInput(request),
            ),
            requestId,
          );
        }
        if (request.method === "DELETE") {
          return jsonSuccess(
            await dependencies.service.deleteBudget(
              authenticatedActor(), projectId, await jsonInput(request),
            ),
            requestId,
          );
        }
      }

      return jsonError(404, "NOT_FOUND", "Deze API-route bestaat niet.", requestId);
    } catch (error) {
      rethrowPlanningError(error);
    }
  };
}
