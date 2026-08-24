// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRuntimeConfigForTests } from "../../server/config/runtime";
import { handleApiRequest } from "../../server/http/router";
import { MediaError } from "../../server/media/errors";
import type { MediaHttpService } from "../../server/media/http";
import {
  configureDefaultMediaRuntime,
  resetDefaultMediaRuntimeForTests,
} from "../../server/media/runtime";
import type { MediaProcessingWorker } from "../../server/media/worker";
import {
  ANONYMOUS_PROJECT_ACTOR,
  type ProjectActorResolver,
} from "../../server/projects/actor";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const FORGED_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const ASSET_ID = "44444444-4444-4444-8444-444444444444";
const ORIGIN = "https://test.buildy.example";

function actorResolver(appUserId: string | null): ProjectActorResolver {
  return {
    resolve: vi.fn(async () => appUserId
      ? { kind: "authenticated" as const, appUserId }
      : ANONYMOUS_PROJECT_ACTOR),
  };
}

function mediaService(overrides: Partial<MediaHttpService> = {}): MediaHttpService {
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
    handleClientUpload: async () => ({ type: "blob.generate-client-token", clientToken: "test" }),
    completeUpload: async () => ({
      asset: {
        id: ASSET_ID,
        projectId: PROJECT_ID,
        purpose: "project_media",
        status: "uploaded",
      },
      replayed: false,
    }),
    readDisplay: async () => ({
      status: 200,
      body: new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(Buffer.from("display")); controller.close(); },
      }),
      headers: { "content-type": "image/webp", "cache-control": "private, no-store" },
    }),
    createOriginalGrant: async () => ({
      path: `/api/media/${ASSET_ID}/original`,
      purpose: "photobook",
      expiresAt: "2026-08-04T10:05:00.000Z",
      requiredHeaders: { "x-buildy-media-purpose-grant": "token" },
    }),
    readOriginal: async () => ({
      status: 200,
      body: new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(Buffer.from("original")); controller.close(); },
      }),
      headers: { "content-type": "image/jpeg", "cache-control": "private, no-store" },
    }),
    ...overrides,
  };
}

function configure(
  appUserId: string | null,
  service: MediaHttpService,
  worker: MediaProcessingWorker = {
    processAsset: async () => ({ status: "idle" }),
  } as unknown as MediaProcessingWorker,
): void {
  configureDefaultMediaRuntime({
    actors: actorResolver(appUserId),
    processor: worker,
    service,
  });
}

describe("private media HTTP routes", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("APP_ORIGIN", ORIGIN);
    vi.stubEnv("DATABASE_URL", "");
    resetRuntimeConfigForTests();
    resetDefaultMediaRuntimeForTests();
  });

  afterEach(() => {
    resetDefaultMediaRuntimeForTests();
    vi.unstubAllEnvs();
    resetRuntimeConfigForTests();
  });

  it("fails closed until private storage and actor dependencies are composed", async () => {
    const response = await handleApiRequest(new Request(`${ORIGIN}/api/media/${ASSET_ID}`));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PROVIDER_UNAVAILABLE" },
    });
  });

  it("serves an authorized display derivative anonymously without a signed URL DTO", async () => {
    const display = vi.fn(mediaService().readDisplay);
    configure(null, mediaService({ readDisplay: display }));

    const response = await handleApiRequest(new Request(
      `${ORIGIN}/api/media/${ASSET_ID}?size=medium&v=1.1`,
    ));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("display");
    expect(display).toHaveBeenCalledWith(
      ANONYMOUS_PROJECT_ACTOR,
      ASSET_ID,
      { size: "medium", v: "1.1" },
      expect.any(Headers),
      false,
    );
    expect(response.headers.get("location")).toBeNull();
  });

  it("requires the mapped actor for upload intents and ignores forged identity headers", async () => {
    const create = vi.fn(async (actorId: string) => {
      expect(actorId).toBe(ACTOR_ID);
      return mediaService().createUploadIntent(actorId, {});
    });
    configure(ACTOR_ID, mediaService({ createUploadIntent: create }));

    const response = await handleApiRequest(new Request(`${ORIGIN}/api/media/upload-intents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "x-user-id": FORGED_ID,
      },
      body: JSON.stringify({ projectId: PROJECT_ID }),
    }));

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledOnce();

    resetDefaultMediaRuntimeForTests();
    configure(null, mediaService());
    const anonymous = await handleApiRequest(new Request(`${ORIGIN}/api/media/upload-intents`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: "{}",
    }));
    expect(anonymous.status).toBe(401);
  });

  it("routes same-origin Blob token requests and originless verified-provider callbacks", async () => {
    const handleClientUpload = vi.fn(async (
      actorId: string | null,
      assetId: string | null,
    ) => ({ type: assetId ? "blob.generate-client-token" : "blob.upload-completed", actorId }));
    configure(ACTOR_ID, mediaService({ handleClientUpload }));

    const tokenResponse = await handleApiRequest(new Request(
      `${ORIGIN}/api/media/${ASSET_ID}/blob-upload`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ type: "blob.generate-client-token" }),
      },
    ));
    const callbackResponse = await handleApiRequest(new Request(
      `${ORIGIN}/api/media/blob-upload-completed`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "blob.upload-completed" }),
      },
    ));

    expect(tokenResponse.status).toBe(200);
    expect(callbackResponse.status).toBe(200);
    expect(handleClientUpload).toHaveBeenNthCalledWith(
      1,
      ACTOR_ID,
      ASSET_ID,
      expect.any(Request),
      { type: "blob.generate-client-token" },
    );
    expect(handleClientUpload).toHaveBeenNthCalledWith(
      2,
      null,
      null,
      expect.any(Request),
      { type: "blob.upload-completed" },
    );
  });

  it("keeps the browser Blob token route behind same-origin protection", async () => {
    const handleClientUpload = vi.fn(mediaService().handleClientUpload);
    configure(ACTOR_ID, mediaService({ handleClientUpload }));

    const response = await handleApiRequest(new Request(
      `${ORIGIN}/api/media/${ASSET_ID}/blob-upload`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://attacker.invalid" },
        body: "{}",
      },
    ));

    expect(response.status).toBe(403);
    expect(handleClientUpload).not.toHaveBeenCalled();
  });

  it("returns the same non-enumerating 404 for private, blocked or absent media", async () => {
    configure(FORGED_ID, mediaService({
      readDisplay: async () => { throw new MediaError("MEDIA_NOT_FOUND"); },
    }));

    const response = await handleApiRequest(new Request(`${ORIGIN}/api/media/${ASSET_ID}`));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "NOT_FOUND",
        message: "Dit mediabestand bestaat niet of is niet toegankelijk.",
      },
    });
  });

  it("returns Retry-After for an upload rate-limit decision", async () => {
    configure(ACTOR_ID, mediaService({
      createUploadIntent: async () => {
        throw new MediaError("RATE_LIMITED", { retryAfterSeconds: 23 });
      },
    }));

    const response = await handleApiRequest(new Request(`${ORIGIN}/api/media/upload-intents`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: "{}",
    }));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("23");
  });

  it("requires an authenticated purpose grant route for originals", async () => {
    const readOriginal = vi.fn(mediaService().readOriginal);
    configure(ACTOR_ID, mediaService({ readOriginal }));

    const response = await handleApiRequest(new Request(
      `${ORIGIN}/api/media/${ASSET_ID}/original?purpose=photobook`,
      { headers: { "x-buildy-media-purpose-grant": "app-purpose-token" } },
    ));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("original");
    expect(readOriginal).toHaveBeenCalledWith(
      ACTOR_ID,
      ASSET_ID,
      "photobook",
      "app-purpose-token",
      expect.any(Headers),
      false,
    );
  });

  it("lets a share grant reach display derivatives but never original-media routes", async () => {
    const shareActor = { kind: "anonymous" as const, shareLinkId: PROJECT_ID };
    const readDisplay = vi.fn(mediaService().readDisplay);
    const readOriginal = vi.fn(mediaService().readOriginal);
    configureDefaultMediaRuntime({
      actors: { resolve: vi.fn(async () => shareActor) },
      processor: { processAsset: async () => ({ status: "idle" }) } as unknown as MediaProcessingWorker,
      service: mediaService({ readDisplay, readOriginal }),
    });

    const display = await handleApiRequest(new Request(`${ORIGIN}/api/media/${ASSET_ID}?size=medium`));
    const original = await handleApiRequest(new Request(
      `${ORIGIN}/api/media/${ASSET_ID}/original?purpose=photobook`,
      { headers: { "x-buildy-media-purpose-grant": "forged-purpose-grant" } },
    ));

    expect(display.status).toBe(200);
    expect(readDisplay).toHaveBeenCalledWith(
      shareActor,
      ASSET_ID,
      { size: "medium" },
      expect.any(Headers),
      false,
    );
    expect(original.status).toBe(401);
    expect(readOriginal).not.toHaveBeenCalled();
  });

});
