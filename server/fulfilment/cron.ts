import { createHash, timingSafeEqual } from "node:crypto";

import { HttpError } from "../http/errors.js";
import { jsonSuccess } from "../http/responses.js";
import { resolveDefaultPeechoFulfilmentRuntime } from "./runtime.js";

function secretMatches(actual: string | null, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual ?? "").digest();
  const expectedDigest = createHash("sha256").update(`Bearer ${expected}`).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

export function createPeechoFulfilmentCronHandler(
  resolveRuntime = resolveDefaultPeechoFulfilmentRuntime,
) {
  return async function handlePeechoFulfilmentCron(
    request: Request,
    requestId: string,
  ): Promise<Response> {
    const runtime = resolveRuntime();
    if (!secretMatches(request.headers.get("authorization"), runtime.cronSecret)) {
      throw new HttpError(401, "UNAUTHENTICATED", "Deze workerroute is niet toegankelijk.");
    }
    return jsonSuccess(await runtime.worker.processNext(), requestId);
  };
}

export const handleDefaultPeechoFulfilmentCron = createPeechoFulfilmentCronHandler();
