import type { AccountExport, AccountSession } from "../../shared/contracts/account.js";
import { HttpError } from "../http/errors.js";
import { jsonError, jsonSuccess } from "../http/responses.js";
import type { ProjectActorResolver } from "../projects/actor.js";
import { ProjectError } from "../projects/errors.js";
import { AccountError } from "./errors.js";
import type { AccountExportDownload } from "./service.js";
import type { DeletionMutation } from "./types.js";

const MAX_JSON_BODY_BYTES = 16 * 1024;

export interface AccountHttpService {
  sessions(request: Request): Promise<AccountSession[]>;
  revokeSession(request: Request, sessionId: string): Promise<{
    revokedSessionId: string;
    revokedCurrentSession: boolean;
  }>;
  exports(actorId: string): Promise<AccountExport[]>;
  createExport(actorId: string, input: unknown): Promise<{ export: AccountExport; replayed: boolean }>;
  downloadExport(actorId: string, jobId: string): Promise<AccountExportDownload>;
  requestDeletion(actorId: string, request: Request, input: unknown): Promise<DeletionMutation>;
}

export type AccountHttpDependencies = {
  actors: ProjectActorResolver;
  service: AccountHttpService;
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

function decodedIdentifier(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded || decoded.length > 255 || decoded.includes("/")) throw new Error("invalid");
    return decoded;
  } catch {
    throw new AccountError("SESSION_NOT_FOUND");
  }
}

function decodedExportId(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decoded)) {
      throw new Error("invalid");
    }
    return decoded;
  } catch {
    throw new AccountError("EXPORT_NOT_FOUND");
  }
}

function exportHeaders(download: AccountExportDownload): Headers {
  return new Headers({
    "cache-control": "private, no-store, max-age=0",
    "content-disposition": `attachment; filename="${download.filename}"`,
    "content-length": String(download.bytes.byteLength),
    "content-type": "application/zip",
    "cross-origin-resource-policy": "same-origin",
    etag: `"sha256-${download.object.sha256}"`,
    "x-buildy-manifest-sha256": download.object.manifestSha256,
    "x-content-type-options": "nosniff",
  });
}

function rethrowAccountError(error: unknown): never {
  if (error instanceof AccountError || error instanceof ProjectError) {
    throw new HttpError(error.status, error.apiCode, error.message);
  }
  throw error;
}

export function createAccountHttpHandler(dependencies: AccountHttpDependencies) {
  return async (request: Request, requestId: string): Promise<Response> => {
    try {
      const actor = await dependencies.actors.resolve(request);
      if (actor.kind !== "authenticated") throw new AccountError("ACTOR_REQUIRED");
      const actorId = actor.appUserId;
      const pathname = new URL(request.url).pathname.replace(/\/$/, "") || "/";

      if (pathname === "/api/account/sessions" && request.method === "GET") {
        return jsonSuccess({ sessions: await dependencies.service.sessions(request) }, requestId);
      }
      const sessionMatch = /^\/api\/account\/sessions\/([^/]+)$/.exec(pathname);
      if (sessionMatch && request.method === "DELETE") {
        return jsonSuccess(
          await dependencies.service.revokeSession(request, decodedIdentifier(sessionMatch[1])),
          requestId,
        );
      }
      if (pathname === "/api/account/exports") {
        if (request.method === "GET") {
          return jsonSuccess({ exports: await dependencies.service.exports(actorId) }, requestId);
        }
        if (request.method === "POST") {
          const result = await dependencies.service.createExport(actorId, await jsonInput(request));
          return jsonSuccess(result, requestId, { status: result.replayed ? 200 : 202 });
        }
      }
      const downloadMatch = /^\/api\/account\/exports\/([^/]+)\/download$/.exec(pathname);
      if (downloadMatch && ["GET", "HEAD"].includes(request.method)) {
        const download = await dependencies.service.downloadExport(
          actorId,
          decodedExportId(downloadMatch[1]),
        );
        const headers = exportHeaders(download);
        if (request.method === "HEAD") return new Response(null, { status: 200, headers });
        return new Response(Uint8Array.from(download.bytes).buffer, { status: 200, headers });
      }
      if (pathname === "/api/account/deletion" && request.method === "POST") {
        const deletion = await dependencies.service.requestDeletion(
          actorId,
          request,
          await jsonInput(request),
        );
        if (deletion.status === "blocked_active_order") {
          throw new AccountError("ACTIVE_ORDER");
        }
        return jsonSuccess(
          {
            deletion: {
              id: deletion.jobId,
              status: deletion.status,
              activeOrderCount: deletion.activeOrderCount,
            },
            replayed: deletion.replayed,
          },
          requestId,
          { status: 202 },
        );
      }

      return jsonError(404, "NOT_FOUND", "Deze API-route bestaat niet.", requestId);
    } catch (error) {
      rethrowAccountError(error);
    }
  };
}
