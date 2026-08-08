import type {
  CommentMutationResult,
  CommentPage,
  NotificationMutationResult,
  NotificationPage,
  ReactionMutationResult,
  ReactionSummary,
} from "../../shared/contracts/engagement.js";
import { HttpError } from "../http/errors.js";
import { jsonError, jsonSuccess } from "../http/responses.js";
import type { ProjectActor, ProjectActorResolver } from "../projects/actor.js";
import { ProjectError } from "../projects/errors.js";
import { EngagementError } from "./errors.js";

const MAX_JSON_BODY_BYTES = 32 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EngagementRouteParameters = Readonly<Record<string, string>>;

export interface EngagementHttpService {
  comments(
    viewer: ProjectActor,
    projectId: string,
    updateId: string,
    query: unknown,
  ): Promise<CommentPage>;
  createComment(
    actorId: string,
    projectId: string,
    updateId: string,
    input: unknown,
  ): Promise<CommentMutationResult>;
  deleteComment(
    actorId: string,
    projectId: string,
    updateId: string,
    commentId: string,
    input: unknown,
  ): Promise<CommentMutationResult>;
  reactions(
    viewer: ProjectActor,
    projectId: string,
    updateId: string,
    query: unknown,
  ): Promise<ReactionSummary>;
  addReaction(
    actorId: string,
    projectId: string,
    updateId: string,
    input: unknown,
  ): Promise<ReactionMutationResult>;
  removeReaction(
    actorId: string,
    projectId: string,
    updateId: string,
    input: unknown,
  ): Promise<ReactionMutationResult>;
  notifications(actorId: string, query: unknown): Promise<NotificationPage>;
  updateNotification(
    actorId: string,
    notificationId: string,
    input: unknown,
  ): Promise<NotificationMutationResult>;
}

export type EngagementHttpDependencies = {
  actors: ProjectActorResolver;
  service: EngagementHttpService;
};

function validatedId(value: string | undefined, notification = false): string {
  if (!value || !UUID.test(value)) {
    throw new EngagementError(
      notification ? "NOTIFICATION_NOT_FOUND" : "CONTENT_NOT_FOUND",
    );
  }
  return value.toLowerCase();
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

async function jsonInput(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
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

function rethrowEngagementError(error: unknown): never {
  if (error instanceof EngagementError || error instanceof ProjectError) {
    throw new HttpError(error.status, error.apiCode, error.message);
  }
  throw error;
}

function commentPath(pathname: string): {
  projectId: string;
  updateId: string;
  commentId: string | null;
} | null {
  const match = /^\/api\/projects\/([^/]+)\/updates\/([^/]+)\/comments(?:\/([^/]+))?$/
    .exec(pathname);
  if (!match?.[1] || !match[2]) return null;
  return {
    projectId: validatedId(match[1]),
    updateId: validatedId(match[2]),
    commentId: match[3] ? validatedId(match[3]) : null,
  };
}

function reactionPath(pathname: string): { projectId: string; updateId: string } | null {
  const match = /^\/api\/projects\/([^/]+)\/updates\/([^/]+)\/reactions$/
    .exec(pathname);
  if (!match?.[1] || !match[2]) return null;
  return { projectId: validatedId(match[1]), updateId: validatedId(match[2]) };
}

export function createEngagementHttpHandler(dependencies: EngagementHttpDependencies) {
  return async (
    request: Request,
    requestId: string,
    _parameters: EngagementRouteParameters = {},
  ): Promise<Response> => {
    try {
      const actor = await dependencies.actors.resolve(request);
      if (actor.kind === "authenticated" && !UUID.test(actor.appUserId)) {
        throw new EngagementError("ACTOR_MAPPING_UNAVAILABLE");
      }
      const resolvedActorId = actor.kind === "authenticated"
        ? actor.appUserId.toLowerCase()
        : null;
      const authenticatedActorId = (): string => {
        if (!resolvedActorId) throw new EngagementError("ACTOR_REQUIRED");
        return resolvedActorId;
      };
      const url = new URL(request.url);
      const pathname = url.pathname.replace(/\/$/, "") || "/";

      if (pathname === "/api/notifications") {
        if (request.method === "GET") {
          return jsonSuccess(
            await dependencies.service.notifications(
              authenticatedActorId(),
              queryInput(url),
            ),
            requestId,
          );
        }
      }

      const notificationMatch = /^\/api\/notifications\/([^/]+)$/.exec(pathname);
      if (notificationMatch?.[1] && request.method === "PATCH") {
        return jsonSuccess(
          await dependencies.service.updateNotification(
            authenticatedActorId(),
            validatedId(notificationMatch[1], true),
            await jsonInput(request),
          ),
          requestId,
        );
      }

      const comment = commentPath(pathname);
      if (comment && !comment.commentId) {
        if (request.method === "GET") {
          return jsonSuccess(
            await dependencies.service.comments(
              actor,
              comment.projectId,
              comment.updateId,
              queryInput(url),
            ),
            requestId,
          );
        }
        if (request.method === "POST") {
          const result = await dependencies.service.createComment(
            authenticatedActorId(),
            comment.projectId,
            comment.updateId,
            await jsonInput(request),
          );
          return jsonSuccess(result, requestId, { status: result.replayed ? 200 : 201 });
        }
      }
      if (comment?.commentId && request.method === "DELETE") {
        return jsonSuccess(
          await dependencies.service.deleteComment(
            authenticatedActorId(),
            comment.projectId,
            comment.updateId,
            comment.commentId,
            await jsonInput(request),
          ),
          requestId,
        );
      }

      const reaction = reactionPath(pathname);
      if (reaction) {
        if (request.method === "GET") {
          return jsonSuccess(
            await dependencies.service.reactions(
              actor,
              reaction.projectId,
              reaction.updateId,
              queryInput(url),
            ),
            requestId,
          );
        }
        if (request.method === "PUT") {
          return jsonSuccess(
            await dependencies.service.addReaction(
              authenticatedActorId(),
              reaction.projectId,
              reaction.updateId,
              await jsonInput(request),
            ),
            requestId,
          );
        }
        if (request.method === "DELETE") {
          return jsonSuccess(
            await dependencies.service.removeReaction(
              authenticatedActorId(),
              reaction.projectId,
              reaction.updateId,
              await jsonInput(request),
            ),
            requestId,
          );
        }
      }

      return jsonError(404, "NOT_FOUND", "Deze API-route bestaat niet.", requestId);
    } catch (error) {
      rethrowEngagementError(error);
    }
  };
}
