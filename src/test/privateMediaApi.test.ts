// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserSha256Base64,
  configureVercelBlobClientUpload,
  PrivateMediaUploadError,
  resetVercelBlobClientUploadForTests,
  uploadFloorplanImage,
  uploadProjectImage,
  waitForProjectMediaReady,
  type PreparedProjectImage,
} from "@/lib/privateMediaApi";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ASSET_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const UPLOAD_KEY = "media-upload:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHECKSUM = "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=";
const PATHNAME = `temporary/22/${ASSET_ID}`;
const HANDLE_UPLOAD_PATH = `/api/media/${ASSET_ID}/blob-upload`;
const PRIVATE_BLOB_URL = `https://store123.private.blob.vercel-storage.com/${PATHNAME}`;

function success(data: unknown): Response {
  return Response.json({ data, meta: { requestId: REQUEST_ID } });
}

function preparedImage(): PreparedProjectImage {
  const file = new File(["abc"], "photo.jpg", { type: "image/jpeg" });
  return {
    file,
    contentType: "image/jpeg",
    sizeBytes: file.size,
    checksumSha256Base64: CHECKSUM,
  };
}

function blobUploadGrant(sizeBytes = 3) {
  return {
    provider: "vercel_blob",
    method: "POST",
    pathname: PATHNAME,
    handleUploadPath: HANDLE_UPLOAD_PATH,
    exactSizeBytes: sizeBytes,
  } as const;
}

function blobUploadResult(contentType = "image/jpeg") {
  return {
    pathname: PATHNAME,
    contentType,
    url: PRIVATE_BLOB_URL,
    downloadUrl: `${PRIVATE_BLOB_URL}?download=1`,
    etag: "private-etag",
  };
}

describe("private project media client", () => {
  afterEach(() => {
    resetVercelBlobClientUploadForTests();
    vi.unstubAllGlobals();
  });

  it("computes the browser SHA-256 over the exact upload bytes", async () => {
    await expect(browserSha256Base64(new Blob(["abc"]))).resolves.toBe(CHECKSUM);
  });

  it("runs intent, private Blob client upload, completion and bounded readiness polling", async () => {
    const prepared = preparedImage();
    let readinessChecks = 0;
    let completionCalls = 0;
    const blobUpload = vi.fn(async () => blobUploadResult());
    const fetchMock = vi.fn(async (resource: string | URL | Request, init?: RequestInit) => {
      const url = String(resource);
      if (url === "/api/media/upload-intents") {
        return success({
          asset: { id: ASSET_ID, projectId: PROJECT_ID, purpose: "project_media", status: "pending_upload" },
          upload: blobUploadGrant(prepared.sizeBytes),
          replayed: false,
        });
      }
      if (url === `/api/media/${ASSET_ID}/complete`) {
        completionCalls += 1;
        return success({
          asset: {
            id: ASSET_ID,
            projectId: PROJECT_ID,
            purpose: "project_media",
            status: completionCalls >= 3 ? "ready" : "uploaded",
          },
          replayed: completionCalls > 1,
        });
      }
      if (url === `/api/media/${ASSET_ID}?size=small` && init?.method === "HEAD") {
        readinessChecks += 1;
        return new Response(null, { status: readinessChecks === 1 ? 404 : 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    configureVercelBlobClientUpload(blobUpload);
    const stages: string[] = [];

    const asset = await uploadProjectImage({
      projectId: PROJECT_ID,
      idempotencyKey: UPLOAD_KEY,
      prepared,
      onStage: (stage) => stages.push(stage),
    }, {
      fetch: fetchMock as typeof fetch,
      sleep: async () => undefined,
      now: () => Date.parse("2026-08-04T12:00:00.000Z"),
    });

    expect(asset).toMatchObject({ id: ASSET_ID, projectId: PROJECT_ID, status: "ready" });
    expect(stages).toEqual(["uploading", "processing", "ready"]);

    const intentCall = fetchMock.mock.calls.find(([url]) => String(url) === "/api/media/upload-intents");
    const intentRequest = intentCall?.[1] as RequestInit;
    expect(JSON.parse(String(intentRequest.body))).toEqual({
      idempotencyKey: UPLOAD_KEY,
      projectId: PROJECT_ID,
      purpose: "project_media",
      contentType: "image/jpeg",
      sizeBytes: 3,
      checksumSha256Base64: CHECKSUM,
    });

    expect(blobUpload).toHaveBeenCalledWith(PATHNAME, prepared.file, {
      access: "private",
      handleUploadUrl: HANDLE_UPLOAD_PATH,
      contentType: "image/jpeg",
      multipart: false,
      abortSignal: undefined,
    });

    const completionCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/complete"));
    expect(JSON.parse(String((completionCall?.[1] as RequestInit).body))).toEqual({});
    expect(completionCalls).toBe(3);
    expect(readinessChecks).toBe(1);
  });

  it("pins floorplan uploads to their dedicated purpose and rejects a cross-purpose response", async () => {
    const prepared = preparedImage();
    let responsePurpose: "floorplan" | "project_media" = "floorplan";
    const fetchMock = vi.fn(async (resource: string | URL | Request, _init?: RequestInit) => {
      if (String(resource) !== "/api/media/upload-intents") throw new Error("Unexpected upload call");
      return success({
        asset: {
          id: ASSET_ID,
          projectId: PROJECT_ID,
          purpose: responsePurpose,
          status: "ready",
        },
        upload: null,
        replayed: responsePurpose === "project_media",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadFloorplanImage({
      projectId: PROJECT_ID,
      idempotencyKey: UPLOAD_KEY,
      prepared,
    }, { fetch: fetchMock as typeof fetch })).resolves.toMatchObject({
      purpose: "floorplan",
      status: "ready",
    });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      projectId: PROJECT_ID,
      purpose: "floorplan",
    });

    responsePurpose = "project_media";
    await expect(uploadFloorplanImage({
      projectId: PROJECT_ID,
      idempotencyKey: UPLOAD_KEY,
      prepared,
    }, { fetch: fetchMock as typeof fetch })).rejects.toMatchObject({
      code: "UNSAFE_UPLOAD_GRANT",
    } satisfies Partial<PrivateMediaUploadError>);
  });

  it("rejects a completion response that switches a floorplan asset to another purpose", async () => {
    const prepared = preparedImage();
    const blobUpload = vi.fn(async () => blobUploadResult());
    const fetchMock = vi.fn(async (resource: string | URL | Request) => {
      const url = String(resource);
      if (url === "/api/media/upload-intents") {
        return success({
          asset: { id: ASSET_ID, projectId: PROJECT_ID, purpose: "floorplan", status: "pending_upload" },
          upload: blobUploadGrant(),
          replayed: false,
        });
      }
      if (url === `/api/media/${ASSET_ID}/complete`) {
        return success({
          asset: { id: ASSET_ID, projectId: PROJECT_ID, purpose: "project_media", status: "uploaded" },
          replayed: false,
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadFloorplanImage({
      projectId: PROJECT_ID,
      idempotencyKey: UPLOAD_KEY,
      prepared,
    }, {
      fetch: fetchMock as typeof fetch,
      blobUpload,
      now: () => Date.parse("2026-08-04T12:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "UNSAFE_UPLOAD_GRANT",
    } satisfies Partial<PrivateMediaUploadError>);
  });

  it("rejects a client-upload grant for another server pathname before any provider upload", async () => {
    const prepared = preparedImage();
    const blobUpload = vi.fn(async () => blobUploadResult());
    const fetchMock = vi.fn(async (resource: string | URL | Request) => {
      if (String(resource) !== "/api/media/upload-intents") throw new Error("PUT must not run");
      return success({
        asset: { id: ASSET_ID, projectId: PROJECT_ID, purpose: "project_media", status: "pending_upload" },
        upload: {
          ...blobUploadGrant(),
          pathname: "temporary/33/33333333-3333-4333-8333-333333333333",
          exactSizeBytes: 3,
        },
        replayed: false,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadProjectImage({
      projectId: PROJECT_ID,
      idempotencyKey: UPLOAD_KEY,
      prepared,
    }, { fetch: fetchMock as typeof fetch, blobUpload })).rejects.toMatchObject({
      code: "UNSAFE_UPLOAD_GRANT",
    } satisfies Partial<PrivateMediaUploadError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(blobUpload).not.toHaveBeenCalled();
  });

  it("recovers a lost completion response through the owner-bound processing poll", async () => {
    const prepared = preparedImage();
    let intentCalls = 0;
    const blobUpload = vi.fn(async () => blobUploadResult());
    let completionCalls = 0;
    const fetchMock = vi.fn(async (resource: string | URL | Request, init?: RequestInit) => {
      const url = String(resource);
      if (url === "/api/media/upload-intents") {
        intentCalls += 1;
        return success({
          asset: { id: ASSET_ID, projectId: PROJECT_ID, purpose: "project_media", status: "pending_upload" },
          upload: blobUploadGrant(),
          replayed: false,
        });
      }
      if (url === `/api/media/${ASSET_ID}/complete`) {
        completionCalls += 1;
        if (completionCalls === 1) throw new TypeError("response lost");
        return success({
          asset: { id: ASSET_ID, projectId: PROJECT_ID, purpose: "project_media", status: "ready" },
          replayed: true,
        });
      }
      if (url === `/api/media/${ASSET_ID}?size=small` && init?.method === "HEAD") {
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const command = {
      projectId: PROJECT_ID,
      idempotencyKey: UPLOAD_KEY,
      prepared,
    };

    await expect(uploadProjectImage(command, {
      fetch: fetchMock as typeof fetch,
      blobUpload,
      sleep: async () => undefined,
    })).resolves.toMatchObject({ id: ASSET_ID, status: "ready" });

    expect(intentCalls).toBe(1);
    expect(blobUpload).toHaveBeenCalledOnce();
    expect(completionCalls).toBe(2);
  });

  it("retries transient readiness failures but stops at its deadline", async () => {
    let currentTime = 0;
    let processingAttempts = 0;
    const fetchMock = vi.fn(async (_resource: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        processingAttempts += 1;
        if (processingAttempts === 1) throw new TypeError("offline");
        return new Response(null, { status: 503 });
      }
      return new Response(null, { status: 404 });
    });

    await expect(waitForProjectMediaReady(ASSET_ID, {
      fetch: fetchMock as typeof fetch,
      now: () => currentTime,
      sleep: async (milliseconds) => { currentTime += milliseconds; },
      readyTimeoutMs: 9,
      initialPollDelayMs: 4,
      maximumPollDelayMs: 4,
    })).rejects.toMatchObject({
      code: "PROCESSING_TIMEOUT",
    } satisfies Partial<PrivateMediaUploadError>);
    expect(processingAttempts).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("fails closed when an owner-bound processing response names another asset", async () => {
    const otherAssetId = "44444444-4444-4444-8444-444444444444";
    const fetchMock = vi.fn(async (_resource: string | URL | Request, init?: RequestInit) => {
      if (init?.method !== "POST") throw new Error("HEAD must not run after an unsafe response");
      return success({
        asset: {
          id: otherAssetId,
          projectId: PROJECT_ID,
          purpose: "project_media",
          status: "ready",
        },
        replayed: true,
      });
    });

    await expect(waitForProjectMediaReady(ASSET_ID, {
      fetch: fetchMock as typeof fetch,
    })).rejects.toMatchObject({
      code: "READINESS_FAILED",
    } satisfies Partial<PrivateMediaUploadError>);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
