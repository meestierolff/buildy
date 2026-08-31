// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  createMediaHttpHandler,
  type MediaHttpService,
  type MediaRequestProcessor,
} from "../../server/media/http";
import { MediaError } from "../../server/media/errors";
import { ANONYMOUS_PROJECT_ACTOR, type ProjectActorResolver } from "../../server/projects/actor";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const ASSET_ID = "33333333-3333-4333-8333-333333333333";
const ORIGIN = "https://app.buildy.test";

function byteStream(bytes = new Uint8Array()): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) { if (bytes.byteLength) controller.enqueue(bytes); controller.close(); },
  });
}

function service(handleClientUpload: MediaHttpService["handleClientUpload"]): MediaHttpService {
  return {
    createUploadIntent: async () => ({
      asset: {
        id: ASSET_ID,
        projectId: PROJECT_ID,
        purpose: "project_media",
        status: "pending_upload",
      },
      upload: null,
      replayed: false,
    }),
    handleClientUpload,
    completeUpload: async () => ({
      asset: {
        id: ASSET_ID,
        projectId: PROJECT_ID,
        purpose: "project_media",
        status: "uploaded",
      },
      replayed: false,
    }),
    readDisplay: async () => ({ status: 200, body: byteStream(), headers: {} }),
    createOriginalGrant: async () => ({
      path: `/api/media/${ASSET_ID}/original`,
      purpose: "photobook",
      expiresAt: "2026-08-23T08:05:00.000Z",
      requiredHeaders: { "x-buildy-media-purpose-grant": "x".repeat(32) },
    }),
    readOriginal: async () => ({ status: 200, body: byteStream(), headers: {} }),
  };
}

function actors(appUserId: string | null): ProjectActorResolver {
  return {
    resolve: async () => appUserId
      ? { kind: "authenticated", appUserId }
      : ANONYMOUS_PROJECT_ACTOR,
  };
}

function processor(
  result: Awaited<ReturnType<MediaRequestProcessor["processAsset"]>> = { status: "idle" },
): MediaRequestProcessor {
  return { processAsset: vi.fn(async () => result) };
}

describe("Vercel Blob media HTTP boundary", () => {
  it("passes the authenticated actor and route asset to the protected token handler", async () => {
    const handleClientUpload = vi.fn(async () => ({
      type: "blob.generate-client-token",
      clientToken: "opaque-client-token",
    }));
    const handler = createMediaHttpHandler({
      actors: actors(ACTOR_ID),
      processor: processor(),
      service: service(handleClientUpload),
    });
    const body = { type: "blob.generate-client-token", payload: { pathname: `temporary/33/${ASSET_ID}` } };
    const request = new Request(`${ORIGIN}/api/media/${ASSET_ID}/blob-upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const response = await handler(request, "request-id", { assetId: ASSET_ID });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      type: "blob.generate-client-token",
      clientToken: "opaque-client-token",
    });
    expect(handleClientUpload).toHaveBeenCalledWith(ACTOR_ID, ASSET_ID, request, body);
  });

  it("keeps the provider callback sessionless and delegates verification to handleUpload", async () => {
    const handleClientUpload = vi.fn(async () => ({
      type: "blob.upload-completed",
      response: "ok",
    }));
    const handler = createMediaHttpHandler({
      actors: actors(null),
      processor: processor(),
      service: service(handleClientUpload),
    });
    const body = { type: "blob.upload-completed", payload: { pathname: `temporary/33/${ASSET_ID}` } };
    const request = new Request(`${ORIGIN}/api/media/blob-upload-completed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const response = await handler(request, "request-id");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ type: "blob.upload-completed", response: "ok" });
    expect(handleClientUpload).toHaveBeenCalledWith(null, null, request, body);
  });

  it("processes the owner-completed asset in the same request and returns ready", async () => {
    const completeUpload = vi.fn(service(async () => undefined).completeUpload);
    const requestProcessor = processor({
      status: "processed",
      assetId: ASSET_ID,
      temporaryCleanupPending: false,
    });
    const handler = createMediaHttpHandler({
      actors: actors(ACTOR_ID),
      processor: requestProcessor,
      service: { ...service(async () => undefined), completeUpload },
    });
    const request = new Request(`${ORIGIN}/api/media/${ASSET_ID}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    const response = await handler(request, "request-id", { assetId: ASSET_ID });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { asset: { id: ASSET_ID, status: "ready" }, replayed: false },
    });
    expect(completeUpload).toHaveBeenCalledWith(ACTOR_ID, ASSET_ID, {});
    expect(requestProcessor.processAsset).toHaveBeenCalledWith(ASSET_ID);
  });

  it("does not enter the privileged worker before owner-bound completion succeeds", async () => {
    const requestProcessor = processor({
      status: "processed",
      assetId: ASSET_ID,
      temporaryCleanupPending: false,
    });
    const handler = createMediaHttpHandler({
      actors: actors(ACTOR_ID),
      processor: requestProcessor,
      service: {
        ...service(async () => undefined),
        completeUpload: async () => { throw new MediaError("MEDIA_NOT_FOUND"); },
      },
    });

    const response = await handler(new Request(`${ORIGIN}/api/media/${ASSET_ID}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }), "request-id", { assetId: ASSET_ID });

    expect(response.status).toBe(404);
    expect(requestProcessor.processAsset).not.toHaveBeenCalled();
  });

  it("keeps a transiently failed exact asset retryable instead of claiming readiness", async () => {
    const requestProcessor = processor({ status: "retry_scheduled", assetId: ASSET_ID });
    const handler = createMediaHttpHandler({
      actors: actors(ACTOR_ID),
      processor: requestProcessor,
      service: service(async () => undefined),
    });

    const response = await handler(new Request(`${ORIGIN}/api/media/${ASSET_ID}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }), "request-id", { assetId: ASSET_ID });

    await expect(response.json()).resolves.toMatchObject({
      data: { asset: { id: ASSET_ID, status: "uploaded" } },
    });
  });
});
