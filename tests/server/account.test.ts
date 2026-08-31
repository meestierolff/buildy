// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AccountExport } from "../../shared/contracts/account";
import { AccountService } from "../../server/account/service";
import type {
  AccountAuthGateway,
  AccountAuthSession,
  AccountRepository,
} from "../../server/account/types";
import type { ObjectStorage } from "../../server/storage/objectStorage";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const CLIENT_KEY = "account-client-key-0001";
const RETENTION_POLICY_VERSION = "approved-policy-2026-08";
const NOW = new Date("2026-08-04T12:00:00.000Z");

const currentSession: AccountAuthSession = {
  id: "session-current",
  authUserId: "auth-user-1",
  isCurrent: true,
  createdAt: "2026-08-04T11:55:00.000Z",
  updatedAt: "2026-08-04T11:55:00.000Z",
  expiresAt: "2026-08-11T11:55:00.000Z",
  ipAddress: "127.0.0.1",
  userAgent: "Buildy test",
};

const readyExport: AccountExport = {
  id: JOB_ID,
  status: "ready",
  includeMedia: true,
  manifestSha256: "b".repeat(64),
  createdAt: "2026-08-04T11:00:00.000Z",
  completedAt: "2026-08-04T11:01:00.000Z",
  expiresAt: "2026-08-11T11:01:00.000Z",
  downloadPath: `/api/account/exports/${JOB_ID}/download`,
  failureCode: null,
};

function repository(overrides: Partial<AccountRepository> = {}): AccountRepository {
  return {
    requestExport: async () => ({ jobId: JOB_ID, status: "requested", replayed: false }),
    listExports: async () => [readyExport],
    resolveExportDownload: async () => null,
    requestDeletion: async () => ({
      jobId: JOB_ID,
      status: "deletion_pending",
      activeOrderCount: 0,
      replayed: false,
    }),
    ...overrides,
  };
}

function auth(overrides: Partial<AccountAuthGateway> = {}): AccountAuthGateway {
  return {
    currentSession: async () => currentSession,
    listSessions: async () => [currentSession],
    revokeSession: async (_request, sessionId) => ({
      revoked: sessionId === currentSession.id,
      wasCurrent: sessionId === currentSession.id,
    }),
    ...overrides,
  };
}

function storage(overrides: Partial<ObjectStorage> = {}): ObjectStorage {
  return {
    createUploadUrl: async () => { throw new Error("unused"); },
    completeUpload: async () => { throw new Error("unused"); },
    createDownloadUrl: async () => { throw new Error("signed downloads are forbidden"); },
    streamObject: async () => { throw new Error("unused"); },
    readObject: async () => { throw new Error("unused"); },
    writeObject: async () => { throw new Error("unused"); },
    headObject: async () => null,
    copyObject: async () => undefined,
    deleteObject: async () => undefined,
    listObjects: async () => ({ objects: [] }),
    getChecksum: async () => undefined,
    ...overrides,
  };
}

describe("AccountService", () => {
  it("houdt server-owned sessiegeheimen buiten de sessielijst en trekt sessies in", async () => {
    const revokeSession = vi.fn(auth().revokeSession);
    const service = new AccountService(
      repository(),
      auth({ revokeSession }),
      storage(),
      "buildy-private-media",
      RETENTION_POLICY_VERSION,
      () => NOW,
    );
    const request = new Request("https://app.buildy.test/api/account/sessions");

    const sessions = await service.sessions(request);
    expect(sessions).toEqual([{
      id: currentSession.id,
      isCurrent: true,
      createdAt: currentSession.createdAt,
      updatedAt: currentSession.updatedAt,
      expiresAt: currentSession.expiresAt,
      ipAddress: currentSession.ipAddress,
      userAgent: currentSession.userAgent,
    }]);
    expect(JSON.stringify(sessions)).not.toContain("authUserId");
    await expect(service.revokeSession(request, currentSession.id)).resolves.toEqual({
      revokedSessionId: currentSession.id,
      revokedCurrentSession: true,
    });
    expect(revokeSession).toHaveBeenCalledWith(request, currentSession.id);
  });

  it("maakt actor-scoped exportidempotency en accepteert geen IDOR-velden", async () => {
    const requestExport = vi.fn(repository().requestExport);
    const service = new AccountService(
      repository({ requestExport }),
      auth(),
      storage(),
      "buildy-private-media",
      RETENTION_POLICY_VERSION,
    );

    await service.createExport(ACTOR_ID, { idempotencyKey: CLIENT_KEY, includeMedia: true });
    const firstScopedKey = requestExport.mock.calls[0]?.[1];
    await service.createExport(OTHER_ID, { idempotencyKey: CLIENT_KEY, includeMedia: true });
    const secondScopedKey = requestExport.mock.calls[1]?.[1];

    expect(firstScopedKey).toMatch(/^[0-9a-f]{64}$/);
    expect(firstScopedKey).not.toBe(secondScopedKey);
    expect(firstScopedKey).not.toContain(CLIENT_KEY);
    await expect(service.createExport(ACTOR_ID, {
      idempotencyKey: CLIENT_KEY,
      includeMedia: false,
      userId: OTHER_ID,
    })).rejects.toMatchObject({ name: "ZodError" });
  });

  it("streamt alleen een checksummed private export en maakt geen signed URL", async () => {
    const bytes = Buffer.from("private deterministic export");
    const objectKey = `exports/33/${JOB_ID}/buildy-export.zip`;
    const createDownloadUrl = vi.fn(async () => { throw new Error("must not be called"); });
    const streamObject = vi.fn(async () => ({
      metadata: {
        key: objectKey,
        sizeBytes: bytes.byteLength,
        contentType: "application/zip",
      },
      stream: new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(bytes); controller.close(); },
      }),
      contentLength: bytes.byteLength,
    }));
    const service = new AccountService(
      repository({
        resolveExportDownload: async (actorId, jobId) => actorId === ACTOR_ID && jobId === JOB_ID
          ? {
              jobId: JOB_ID,
              objectKey,
              sizeBytes: bytes.byteLength,
              sha256: createHash("sha256").update(bytes).digest("hex"),
              manifestSha256: "b".repeat(64),
            }
          : null,
      }),
      auth(),
      storage({ createDownloadUrl, streamObject }),
      "buildy-private-media",
      RETENTION_POLICY_VERSION,
    );

    const download = await service.downloadExport(ACTOR_ID, JOB_ID);
    expect(download).toMatchObject({
      status: 200,
      contentLength: bytes.byteLength,
      filename: "buildy-data-export-33333333.zip",
    });
    await expect(new Response(download.body).text()).resolves.toBe(bytes.toString());
    await expect(service.downloadExport(OTHER_ID, JOB_ID))
      .rejects.toMatchObject({ reason: "EXPORT_NOT_READY" });
    expect(streamObject).toHaveBeenCalledTimes(1);
    expect(createDownloadUrl).not.toHaveBeenCalled();
  });

  it("weigert een export als objectlengte of checksum niet meer met de database overeenkomt", async () => {
    const expected = Buffer.from("expected");
    const service = new AccountService(
      repository({
        resolveExportDownload: async () => ({
          jobId: JOB_ID,
          objectKey: `exports/33/${JOB_ID}/buildy-export.zip`,
          sizeBytes: expected.byteLength,
          sha256: createHash("sha256").update(expected).digest("hex"),
          manifestSha256: "b".repeat(64),
        }),
      }),
      auth(),
      storage({
        streamObject: async () => ({
          metadata: {
            key: `exports/33/${JOB_ID}/buildy-export.zip`,
            sizeBytes: expected.byteLength,
            contentType: "application/zip",
          },
          stream: new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(Buffer.from("tampered")); controller.close(); },
          }),
          contentLength: expected.byteLength,
        }),
      }),
      "buildy-private-media",
      RETENTION_POLICY_VERSION,
    );

    const download = await service.downloadExport(ACTOR_ID, JOB_ID);
    await expect(new Response(download.body).arrayBuffer())
      .rejects.toMatchObject({ code: "UPLOAD_MISMATCH" });
  });

  it("vereist een recente Google-sessie voor accountverwijdering", async () => {
    const requestDeletion = vi.fn(repository().requestDeletion);
    const oldSession = { ...currentSession, createdAt: "2026-08-04T10:00:00.000Z" };
    const request = new Request("https://app.buildy.test/api/account/deletion");
    const input = { confirmation: "VERWIJDEREN", idempotencyKey: CLIENT_KEY };
    const stale = new AccountService(
      repository({ requestDeletion }),
      auth({ currentSession: async () => oldSession }),
      storage(),
      "buildy-private-media",
      RETENTION_POLICY_VERSION,
      () => NOW,
    );

    await expect(stale.requestDeletion(ACTOR_ID, request, input))
      .rejects.toMatchObject({ reason: "REAUTH_REQUIRED", status: 403 });
    expect(requestDeletion).not.toHaveBeenCalled();

    const recentlyAuthenticated = new AccountService(
      repository({ requestDeletion }),
      auth(),
      storage(),
      "buildy-private-media",
      RETENTION_POLICY_VERSION,
      () => NOW,
    );
    await recentlyAuthenticated.requestDeletion(ACTOR_ID, request, input);
    expect(requestDeletion).toHaveBeenCalledWith(
      ACTOR_ID,
      expect.stringMatching(/^[0-9a-f]{64}$/),
      RETENTION_POLICY_VERSION,
    );
  });
});
