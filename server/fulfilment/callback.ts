import { createHash } from "node:crypto";

import {
  PrintProviderError,
  type PrintOrder,
  type PrintProvider,
  type VerifiedPrintCallback,
} from "../print/printProvider.js";
import { HttpError } from "../http/errors.js";
import { jsonSuccess } from "../http/responses.js";
import type {
  PeechoFulfilmentRepository,
  ProviderInboxEnvironment,
} from "./types.js";

const MAX_CALLBACK_BYTES = 64 * 1024;

function contentTypeIsJson(value: string | null): boolean {
  if (!value) return false;
  return value.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function parseCallback(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new HttpError(400, "BAD_REQUEST", "De Peecho-callback is geen geldige JSON.");
  }
}

function translateVerificationError(error: unknown): never {
  if (error instanceof PrintProviderError) {
    if (error.code === "INVALID_CONFIGURATION") {
      throw new HttpError(503, "PROVIDER_UNAVAILABLE", "De Peecho-callback is niet veilig geconfigureerd.");
    }
    throw new HttpError(401, "UNAUTHENTICATED", "De Peecho-callback kon niet worden geverifieerd.");
  }
  throw error;
}

function translateCanonicalReadError(error: unknown): never {
  if (error instanceof PrintProviderError) {
    throw new HttpError(503, "PROVIDER_UNAVAILABLE", "De actuele Peecho-orderstatus kon niet worden bevestigd.");
  }
  throw error;
}

function canonicalCallback(
  verified: VerifiedPrintCallback,
  canonical: PrintOrder,
  providerEnvironment: PrintProvider["environment"],
): VerifiedPrintCallback {
  if (
    canonical.providerOrderId !== verified.providerOrderId
    || canonical.merchantReference === null
  ) {
    throw new HttpError(503, "PROVIDER_UNAVAILABLE", "De actuele Peecho-orderidentiteit kon niet worden bevestigd.");
  }
  const trackingCode = canonical.trackingCode;
  const trackingUrl = canonical.trackingUrl;
  const eventKey = createHash("sha256").update(JSON.stringify([
    "peecho-canonical-callback-v1",
    providerEnvironment,
    canonical.providerOrderId,
    canonical.merchantReference,
    canonical.status.providerStatus,
    trackingCode,
    trackingUrl,
  ])).digest("hex");
  return {
    ...verified,
    eventKey,
    merchantReference: canonical.merchantReference,
    oldStatus: canonical.status,
    newStatus: canonical.status,
    trackingCode,
    trackingUrl,
  };
}

export function createPeechoCallbackHandler(input: {
  applicationEnvironment: ProviderInboxEnvironment;
  provider: Pick<PrintProvider, "environment" | "verifyCallback" | "getOrder">;
  repository: Pick<PeechoFulfilmentRepository, "recordCallback">;
}) {
  return async (request: Request, requestId: string): Promise<Response> => {
    if (!contentTypeIsJson(request.headers.get("content-type"))) {
      throw new HttpError(415, "BAD_REQUEST", "De Peecho-callback vereist application/json.");
    }
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_CALLBACK_BYTES) {
      throw new HttpError(413, "BAD_REQUEST", "De Peecho-callbackpayload is te groot.");
    }
    const rawBody = await request.text();
    const bodyBytes = Buffer.byteLength(rawBody, "utf8");
    if (bodyBytes < 2 || bodyBytes > MAX_CALLBACK_BYTES) {
      throw new HttpError(400, "BAD_REQUEST", "De Peecho-callbackpayload heeft een ongeldige grootte.");
    }

    let verified;
    try {
      verified = input.provider.verifyCallback(parseCallback(rawBody));
    } catch (error) {
      translateVerificationError(error);
    }
    let canonicalOrder;
    try {
      canonicalOrder = await input.provider.getOrder({ providerOrderId: verified.providerOrderId });
    } catch (error) {
      translateCanonicalReadError(error);
    }
    const canonical = canonicalCallback(verified, canonicalOrder, input.provider.environment);
    const result = await input.repository.recordCallback({
      inboxEnvironment: input.applicationEnvironment,
      providerEnvironment: input.provider.environment,
      event: canonical,
    });
    return jsonSuccess({ accepted: true as const, ...result }, requestId);
  };
}
