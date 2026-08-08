import { createHash, timingSafeEqual } from "node:crypto";
import { HttpError } from "../http/errors.js";
import { jsonSuccess } from "../http/responses.js";
import { resolveDefaultEmailWorker, type ConfiguredEmailWorker } from "./runtime.js";

function secretMatches(actual: string | null, expected: string): boolean {
  const expectedHeader = `Bearer ${expected}`;
  const actualDigest = createHash("sha256").update(actual ?? "").digest();
  const expectedDigest = createHash("sha256").update(expectedHeader).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

export function createEmailCronHandler(
  resolveWorker: () => ConfiguredEmailWorker = resolveDefaultEmailWorker,
) {
  return async function handleEmailCronRequest(request: Request, requestId: string): Promise<Response> {
    const runtime = resolveWorker();
    if (!secretMatches(request.headers.get("authorization"), runtime.cronSecret)) {
      throw new HttpError(401, "UNAUTHENTICATED", "Deze workerroute is niet toegankelijk.");
    }

    const result = await runtime.worker.runOnce();
    return jsonSuccess(result, requestId);
  };
}

export const handleDefaultEmailCronRequest = createEmailCronHandler();
