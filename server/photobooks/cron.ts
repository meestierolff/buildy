import { createHash, timingSafeEqual } from "node:crypto";
import { HttpError } from "../http/errors.js";
import { jsonSuccess } from "../http/responses.js";
import { resolveDefaultPhotobookWorker } from "./runtime.js";

function secretMatches(actual: string | null, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual ?? "").digest();
  const expectedDigest = createHash("sha256").update(`Bearer ${expected}`).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

export function createPhotobookCronHandler(
  resolveWorker = resolveDefaultPhotobookWorker,
) {
  return async function handlePhotobookCronRequest(request: Request, requestId: string): Promise<Response> {
    const runtime = resolveWorker();
    if (!secretMatches(request.headers.get("authorization"), runtime.cronSecret)) {
      throw new HttpError(401, "UNAUTHENTICATED", "Deze workerroute is niet toegankelijk.");
    }
    return jsonSuccess(await runtime.worker.processNext(), requestId);
  };
}

export const handleDefaultPhotobookCronRequest = createPhotobookCronHandler();
