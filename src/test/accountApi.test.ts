// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAccountExport,
  getAccountExports,
  getAccountSessions,
  requestAccountDeletion,
  revokeAccountSession,
} from "@/lib/accountApi";
import { ApiClientError } from "@/lib/apiClient";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_KEY = "account-browser-key-0001";

function success(data: unknown): Response {
  return Response.json({ data, meta: { requestId: REQUEST_ID } });
}

describe("account API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("leest getypeerde sessies zonder auth tokenvelden", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success({
      sessions: [{
        id: "session-current",
        isCurrent: true,
        createdAt: "2026-08-04T12:00:00.000Z",
        updatedAt: "2026-08-04T12:00:00.000Z",
        expiresAt: "2026-08-11T12:00:00.000Z",
        ipAddress: null,
        userAgent: "Buildy test",
      }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const sessions = await getAccountSessions();

    expect(sessions[0]).toMatchObject({ id: "session-current", isCurrent: true });
    expect(JSON.stringify(sessions)).not.toContain("token");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/sessions",
      expect.objectContaining({ credentials: "include", method: "GET" }),
    );
  });

  it("maakt alleen het gevalideerde exportcommand en verwerkt pollingstatus", async () => {
    const item = {
      id: JOB_ID,
      status: "retry_scheduled",
      includeMedia: true,
      manifestSha256: null,
      createdAt: "2026-08-04T12:00:00.000Z",
      completedAt: null,
      expiresAt: null,
      downloadPath: null,
      failureCode: "STORAGE_PROVIDER_ERROR",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(success({ export: item, replayed: false }))
      .mockResolvedValueOnce(success({ exports: [item] }));
    vi.stubGlobal("fetch", fetchMock);

    await createAccountExport({ idempotencyKey: CLIENT_KEY, includeMedia: true });
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      idempotencyKey: CLIENT_KEY,
      includeMedia: true,
    });
    await expect(getAccountExports()).resolves.toMatchObject([{
      id: JOB_ID,
      status: "retry_scheduled",
    }]);
  });

  it("URL-encodeert opaque sessie-ID's bij intrekking", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success({
      revokedSessionId: "session:device/encoded",
      revokedCurrentSession: false,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await revokeAccountSession("session:device/encoded");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/sessions/session%3Adevice%2Fencoded",
      expect.objectContaining({ credentials: "include", method: "DELETE" }),
    );
  });

  it("stuurt de expliciete deletebevestiging en idempotency", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success({
      deletion: { id: JOB_ID, status: "deletion_pending", activeOrderCount: 0 },
      replayed: false,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await requestAccountDeletion({
      confirmation: "VERWIJDEREN",
      idempotencyKey: CLIENT_KEY,
    });

    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      confirmation: "VERWIJDEREN",
      idempotencyKey: CLIENT_KEY,
    });
  });

  it("faalt gesloten op een serverrespons met tokens of een ongeldige downloadroute", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success({
      sessions: [{
        id: "session-current",
        isCurrent: true,
        createdAt: "2026-08-04T12:00:00.000Z",
        updatedAt: "2026-08-04T12:00:00.000Z",
        expiresAt: "2026-08-11T12:00:00.000Z",
        ipAddress: null,
        userAgent: null,
        token: "must-not-cross-browser-boundary",
      }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    // Zod objects strip unknown fields, so a token can never reach the caller.
    expect(JSON.stringify(await getAccountSessions())).not.toContain("must-not-cross");

    fetchMock.mockResolvedValueOnce(success({
      exports: [{
        id: JOB_ID,
        status: "ready",
        includeMedia: false,
        manifestSha256: "a".repeat(64),
        createdAt: "2026-08-04T12:00:00.000Z",
        completedAt: "2026-08-04T12:01:00.000Z",
        expiresAt: "2026-08-11T12:01:00.000Z",
        downloadPath: "https://evil.example/export.zip",
        failureCode: null,
      }],
    }));
    await expect(getAccountExports()).rejects.toBeInstanceOf(ApiClientError);
  });
});
