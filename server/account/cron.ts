import { createHash, timingSafeEqual } from "node:crypto";
import { HttpError } from "../http/errors.js";
import { jsonSuccess } from "../http/responses.js";
import { logEvent } from "../observability/logger.js";
import { resolveDefaultAccountWorker } from "./runtime.js";

function secretMatches(actual: string | null, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual ?? "").digest();
  const expectedDigest = createHash("sha256").update(`Bearer ${expected}`).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

export function createAccountCronHandler(resolveWorker = resolveDefaultAccountWorker) {
  return async function handleAccountCronRequest(request: Request, requestId: string): Promise<Response> {
    const runtime = resolveWorker();
    if (!secretMatches(request.headers.get("authorization"), runtime.cronSecret)) {
      throw new HttpError(401, "UNAUTHENTICATED", "Deze workerroute is niet toegankelijk.");
    }
    const result = await runtime.worker.processNext();
    if (result.status === "dead_letter") {
      logEvent("error", "account.lifecycle_dead_letter", {
        requestId,
        jobId: result.jobId,
        operation: result.operation,
      });
    }
    return jsonSuccess(result, requestId);
  };
}

export const handleDefaultAccountCronRequest = createAccountCronHandler();
