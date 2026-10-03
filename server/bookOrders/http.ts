import { z } from "zod";
import { HttpError } from "../http/errors.js";
import { jsonError, jsonSuccess } from "../http/responses.js";
import { ProjectError } from "../projects/errors.js";
import { ModerationAdminError } from "../moderation/adminErrors.js";
import { PhotobookError } from "../photobooks/errors.js";
import type { ProjectActorResolver } from "../projects/actor.js";
import type { ModerationAdminActorResolver } from "../moderation/adminActor.js";
import type { BookOrderService } from "./service.js";
export type BookOrderHttpDependencies = { actors: ProjectActorResolver; admins: ModerationAdminActorResolver; service: BookOrderService };
async function input(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") throw new HttpError(400, "BAD_REQUEST", "Gebruik application/json.");
  if (Number(request.headers.get("content-length") ?? 0) > 16_384) throw new HttpError(400, "BAD_REQUEST", "De aanvraag is te groot.");
  const text = await request.text();
  if (Buffer.byteLength(text) > 16_384) throw new HttpError(400, "BAD_REQUEST", "De aanvraag is te groot.");
  try { return JSON.parse(text) as unknown; } catch { throw new HttpError(400, "BAD_REQUEST", "Ongeldige aanvraag."); }
}
export function createBookOrderHttpHandler(deps: BookOrderHttpDependencies) {
  return async (request: Request, requestId: string, parameters: Readonly<Record<string, string>> = {}): Promise<Response> => {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/admin/book-orders")) {
        const actor = await deps.admins.resolve(request);
        if (actor.role !== "admin") throw new ModerationAdminError("FORBIDDEN");
        const orderId = parameters.orderId ? z.string().uuid().parse(parameters.orderId) : null;
        if (orderId && url.pathname.endsWith("/pdf") && request.method === "POST") {
          const proof = await deps.service.pdf(actor, orderId, requestId);
          const chunkSize = 64 * 1024;
          let offset = 0;
          const body = new ReadableStream<Uint8Array>({ pull(controller) {
            if (offset >= proof.bytes.byteLength) { controller.close(); return; }
            controller.enqueue(new Uint8Array(proof.bytes.subarray(offset, offset + chunkSize)));
            offset += chunkSize;
          } });
          return new Response(body, { headers: {
            "content-type": "application/pdf",
            "content-disposition": `attachment; filename="Bouwboek-${orderId.slice(0, 8)}.pdf"`,
            "cache-control": "private, no-store", "x-content-type-options": "nosniff", "cross-origin-resource-policy": "same-origin",
            "x-buildy-document-sha256": proof.documentSha256, "x-buildy-pdf-sha256": proof.pdfSha256,
          } });
        }
        if (orderId && request.method === "PATCH") return jsonSuccess(await deps.service.update(actor, orderId, await input(request)), requestId);
        if (!orderId && request.method === "GET") {
          const cursor = url.searchParams.get("cursor");
          return jsonSuccess(await deps.service.queue(actor, cursor ? z.tuple([z.string().datetime(), z.string().uuid()]).parse(cursor.split("|")).join("|") : undefined), requestId);
        }
      } else {
        const actor = await deps.actors.resolve(request);
        if (actor.kind !== "authenticated") throw new HttpError(401, "UNAUTHENTICATED", "Log in om een boek aan te vragen.");
        const projectId = z.string().uuid().parse(parameters.projectId);
        if (request.method === "GET") return jsonSuccess(await deps.service.list(actor.appUserId, projectId), requestId);
        if (request.method === "POST") {
          const result = await deps.service.create(actor.appUserId, projectId, await input(request));
          return jsonSuccess(result, requestId, { status: result.replayed ? 200 : 201 });
        }
      }
      return jsonError(404, "NOT_FOUND", "Deze route bestaat niet.", requestId);
    } catch (error) {
      if (error instanceof ProjectError || error instanceof PhotobookError || error instanceof ModerationAdminError) throw new HttpError(error.status, error.apiCode, error.message);
      throw error;
    }
  };
}
