// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserSha256Base64,
  PrivateMediaUploadError,
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

describe("private project media client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("computes the browser SHA-256 over the exact upload bytes", async () => {
    await expect(browserSha256Base64(new Blob(["abc"]))).resolves.toBe(CHECKSUM);
  });

  it("runs intent, exact-header PUT, completion and bounded readiness polling", async () => {
    const prepared = preparedImage();
    let readinessChecks = 0;
    const fetchMock = vi.fn(async (resource: string | URL | Request, init?: RequestInit) => {
      const url = String(resource);
      if (url === "/api/media/upload-intents") {
        return success({
          asset: { id: ASSET_ID, projectId: PROJECT_ID, purpose: "project_media", status: "pending_upload" },
          upload: {
            method: "PUT",
            url: "https://storage.example.invalid/private-object",
            expiresAt: "2099-08-04T12:00:00.000Z",
            requiredHeaders: {
              "Content-Length": String(prepared.sizeBytes),
              "Content-Type": prepared.contentType,
              "X-Amz-Meta-Buildy-Sha256": prepared.checksumSha256Base64,
            },
            exactSizeBytes: prepared.sizeBytes,
          },
          replayed: false,
        });
      }
      if (url === "https://storage.example.invalid/private-object") {
        return new Response(null, { status: 200 });
      }
      if (url === `/api/media/${ASSET_ID}/complete`) {
        return success({
          asset: { id: ASSET_ID, projectId: PROJECT_ID, purpose: "project_media", status: "uploaded" },
          replayed: false,
        });
      }
      if (url === `/api/media/${ASSET_ID}?size=small` && init?.method === "HEAD") {
        readinessChecks += 1;
        return new Response(null, { status: readinessChecks === 1 ? 404 : 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
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

    const putCall = fetchMock.mock.calls.find(([url]) => String(url).startsWith("https://storage.example.invalid"));
    const putRequest = putCall?.[1] as RequestInit;
    const putHeaders = new Headers(putRequest.headers);
    expect(putRequest).toMatchObject({
      method: "PUT",
      body: prepared.file,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(putHeaders.get("content-type")).toBe("image/jpeg");
    expect(putHeaders.get("x-amz-meta-buildy-sha256")).toBe(CHECKSUM);
    expect(putHeaders.has("content-length")).toBe(false);

    const completionCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/complete"));
    expect(JSON.parse(String((completionCall?.[1] as RequestInit).body))).toEqual({});
    expect(readinessChecks).toBe(2);
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
    const fetchMock = vi.fn(async (resource: string | URL | Request) => {
      const url = String(resource);
      if (url === "/api/media/upload-intents") {
        return success({
          asset: { id: ASSET_ID, projectId: PROJECT_ID, purpose: "floorplan", status: "pending_upload" },
          upload: {
            method: "PUT",
            url: "https://storage.example.invalid/private-object",
            expiresAt: "2099-08-04T12:00:00.000Z",
            requiredHeaders: {
              "content-length": "3",
              "content-type": "image/jpeg",
              "x-amz-meta-buildy-sha256": CHECKSUM,
            },
            exactSizeBytes: 3,
          },
          replayed: false,
        });
      }
      if (url === "https://storage.example.invalid/private-object") {
        return new Response(null, { status: 200 });
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
      now: () => Date.parse("2026-08-04T12:00:00.000Z"),
    })).rejects.toMatchObject({
      code: "UNSAFE_UPLOAD_GRANT",
    } satisfies Partial<PrivateMediaUploadError>);
  });

  it("rejects an upload grant with any unrecognised header before PUT", async () => {
    const prepared = preparedImage();
    const fetchMock = vi.fn(async (resource: string | URL | Request) => {
      if (String(resource) !== "/api/media/upload-intents") throw new Error("PUT must not run");
      return success({
        asset: { id: ASSET_ID, projectId: PROJECT_ID, purpose: "project_media", status: "pending_upload" },
        upload: {
          method: "PUT",
          url: "https://storage.example.invalid/private-object",
          expiresAt: "2099-08-04T12:00:00.000Z",
          requiredHeaders: {
            "Content-Length": "3",
            "Content-Type": "image/jpeg",
            "X-Amz-Meta-Buildy-Sha256": CHECKSUM,
            "X-Unexpected": "owner-controlled-value",
          },
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
    }, { fetch: fetchMock as typeof fetch })).rejects.toMatchObject({
      code: "UNSAFE_UPLOAD_GRANT",
    } satisfies Partial<PrivateMediaUploadError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resumes the same idempotent asset after a lost completion response without a second PUT", async () => {
    const prepared = preparedImage();
    let intentCalls = 0;
    let putCalls = 0;
    let completionCalls = 0;
    const fetchMock = vi.fn(async (resource: string | URL | Request, init?: RequestInit) => {
      const url = String(resource);
      if (url === "/api/media/upload-intents") {
        intentCalls += 1;
        if (intentCalls === 2) {
          return success({
            asset: { id: ASSET_ID, projectId: PROJECT_ID, purpose: "project_media", status: "processing" },
            upload: null,
            replayed: true,
          });
        }
        return success({
          asset: { id: ASSET_ID, projectId: PROJECT_ID, purpose: "project_media", status: "pending_upload" },
          upload: {
            method: "PUT",
            url: "https://storage.example.invalid/private-object",
            expiresAt: "2099-08-04T12:00:00.000Z",
            requiredHeaders: {
              "content-length": "3",
              "content-type": "image/jpeg",
              "x-amz-meta-buildy-sha256": CHECKSUM,
            },
            exactSizeBytes: 3,
          },
          replayed: false,
        });
      }
      if (url === "https://storage.example.invalid/private-object") {
        putCalls += 1;
        return new Response(null, { status: 200 });
      }
      if (url === `/api/media/${ASSET_ID}/complete`) {
        completionCalls += 1;
        throw new TypeError("response lost");
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
      sleep: async () => undefined,
    })).rejects.toThrow("response lost");
    await expect(uploadProjectImage(command, {
      fetch: fetchMock as typeof fetch,
      sleep: async () => undefined,
    })).resolves.toMatchObject({ id: ASSET_ID, status: "ready" });

    expect(intentCalls).toBe(2);
    expect(putCalls).toBe(1);
    expect(completionCalls).toBe(1);
  });

  it("retries transient readiness failures but stops at its deadline", async () => {
    let currentTime = 0;
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValue(new Response(null, { status: 404 }));

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
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
