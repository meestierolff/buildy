// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { AccountExport, AccountSession } from "../../shared/contracts/account";
import { createAccountCronHandler } from "../../server/account/cron";
import {
  createAccountHttpHandler,
  type AccountHttpService,
} from "../../server/account/http";
import type { ProjectActorResolver } from "../../server/projects/actor";
import type { AccountWorkerRuntime } from "../../server/account/runtime";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";

const session: AccountSession = {
  id: "session-1",
  isCurrent: true,
  createdAt: "2026-08-04T11:55:00.000Z",
  updatedAt: "2026-08-04T11:55:00.000Z",
  expiresAt: "2026-08-11T11:55:00.000Z",
  ipAddress: null,
  userAgent: "Buildy test",
};

const accountExport: AccountExport = {
  id: JOB_ID,
  status: "requested",
  includeMedia: false,
  manifestSha256: null,
  createdAt: "2026-08-04T12:00:00.000Z",
  completedAt: null,
  expiresAt: null,
  downloadPath: null,
  failureCode: null,
};

function service(): AccountHttpService {
  return {
    sessions: vi.fn().mockResolvedValue([session]),
    revokeSession: vi.fn().mockResolvedValue({
      revokedSessionId: session.id,
      revokedCurrentSession: true,
    }),
    exports: vi.fn().mockResolvedValue([accountExport]),
    createExport: vi.fn().mockResolvedValue({ export: accountExport, replayed: false }),
    downloadExport: vi.fn().mockResolvedValue({
      bytes: Uint8Array.from([0x50, 0x4b, 0x03, 0x04]),
      filename: "buildy-data-export-33333333.zip",
      object: {
        jobId: JOB_ID,
        objectKey: `exports/33/${JOB_ID}/buildy-export.zip`,
        sizeBytes: 4,
        sha256: "a".repeat(64),
        manifestSha256: "b".repeat(64),
      },
    }),
    requestDeletion: vi.fn().mockResolvedValue({
      jobId: JOB_ID,
      status: "deletion_pending",
      activeOrderCount: 0,
      replayed: false,
    }),
  };
}

function actors(authenticated = true): ProjectActorResolver {
  return {
    resolve: vi.fn().mockResolvedValue(authenticated
      ? { kind: "authenticated", appUserId: ACTOR_ID }
      : { kind: "anonymous" }),
  };
}

describe("account HTTP boundary", () => {
  it("weigert iedere accountoperatie vóór disclosure voor anonieme requests", async () => {
    const account = service();
    const handler = createAccountHttpHandler({ actors: actors(false), service: account });

    await expect(handler(
      new Request("https://app.buildy.test/api/account/sessions"),
      REQUEST_ID,
    )).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    expect(account.sessions).not.toHaveBeenCalled();
  });

  it("gebruikt uitsluitend de vertrouwde actor voor exportreads en -writes", async () => {
    const account = service();
    const handler = createAccountHttpHandler({ actors: actors(), service: account });
    const input = {
      idempotencyKey: "account-export-http-0001",
      includeMedia: true,
      userId: OTHER_ID,
    };

    const response = await handler(new Request("https://app.buildy.test/api/account/exports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }), REQUEST_ID);

    expect(response.status).toBe(202);
    expect(account.createExport).toHaveBeenCalledWith(ACTOR_ID, input);
    expect(account.createExport).not.toHaveBeenCalledWith(OTHER_ID, expect.anything());
  });

  it("streamt GET/HEAD downloads met private no-store headers en zonder objectkey", async () => {
    const account = service();
    const handler = createAccountHttpHandler({ actors: actors(), service: account });
    const path = `https://app.buildy.test/api/account/exports/${JOB_ID}/download`;

    const response = await handler(new Request(path), REQUEST_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-disposition"))
      .toBe('attachment; filename="buildy-data-export-33333333.zip"');
    expect(response.headers.get("x-buildy-manifest-sha256")).toBe("b".repeat(64));
    expect(await response.arrayBuffer()).toEqual(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]).buffer);

    const head = await handler(new Request(path, { method: "HEAD" }), REQUEST_ID);
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("4");
    expect(await head.text()).toBe("");
    expect(vi.mocked(account.downloadExport)).toHaveBeenCalledTimes(2);
  });

  it("vertaalt een persisted active-order blokkade naar een geldige getypeerde HTTP-fout", async () => {
    const account = service();
    vi.mocked(account.requestDeletion).mockResolvedValue({
      jobId: JOB_ID,
      status: "blocked_active_order",
      activeOrderCount: 1,
      replayed: false,
    });
    const handler = createAccountHttpHandler({ actors: actors(), service: account });

    await expect(handler(new Request("https://app.buildy.test/api/account/deletion", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        confirmation: "VERWIJDEREN",
        idempotencyKey: "account-deletion-http-0001",
      }),
    }), REQUEST_ID)).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      message: expect.stringContaining("bouwboekbestelling"),
    });
  });

  it("routeert sessie-intrekking met een gedecodeerde opaque sessie-ID", async () => {
    const account = service();
    const handler = createAccountHttpHandler({ actors: actors(), service: account });

    const response = await handler(new Request(
      "https://app.buildy.test/api/account/sessions/session%3Adevice-1",
      { method: "DELETE" },
    ), REQUEST_ID);

    expect(response.status).toBe(200);
    expect(account.revokeSession).toHaveBeenCalledWith(expect.any(Request), "session:device-1");
  });

  it("weigert non-JSON, te grote bodies en gesmokkelde pathsegmenten lokaal", async () => {
    const account = service();
    const handler = createAccountHttpHandler({ actors: actors(), service: account });

    await expect(handler(new Request("https://app.buildy.test/api/account/exports", {
      method: "POST",
      body: "{}",
    }), REQUEST_ID)).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });

    await expect(handler(new Request("https://app.buildy.test/api/account/deletion", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "999999" },
      body: "{}",
    }), REQUEST_ID)).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });

    await expect(handler(new Request(
      `https://app.buildy.test/api/account/exports/${JOB_ID}%2Fother/download`,
    ), REQUEST_ID)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(account.downloadExport).not.toHaveBeenCalled();
  });
});

describe("account lifecycle cron boundary", () => {
  it("weigert een ontbrekend of onjuist bearer secret zonder een job te claimen", async () => {
    const processNext = vi.fn().mockResolvedValue({ status: "idle" });
    const runtime = {
      cronSecret: "a-production-length-cron-secret-value",
      worker: { processNext },
    } as unknown as AccountWorkerRuntime;
    const handler = createAccountCronHandler(() => runtime);

    await expect(handler(
      new Request("https://app.buildy.test/api/internal/cron/account-lifecycle"),
      REQUEST_ID,
    )).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    await expect(handler(new Request(
      "https://app.buildy.test/api/internal/cron/account-lifecycle",
      { headers: { authorization: "Bearer incorrect" } },
    ), REQUEST_ID)).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    expect(processNext).not.toHaveBeenCalled();
  });

  it("claimt exact één begrensde lifecyclejob na constante-tijd secretcontrole", async () => {
    const processNext = vi.fn().mockResolvedValue({
      status: "export_ready",
      jobId: JOB_ID,
      archiveSha256: "a".repeat(64),
    });
    const runtime = {
      cronSecret: "a-production-length-cron-secret-value",
      worker: { processNext },
    } as unknown as AccountWorkerRuntime;
    const handler = createAccountCronHandler(() => runtime);

    const response = await handler(new Request(
      "https://app.buildy.test/api/internal/cron/account-lifecycle",
      { headers: { authorization: `Bearer ${runtime.cronSecret}` } },
    ), REQUEST_ID);

    expect(response.status).toBe(200);
    expect(processNext).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "export_ready", jobId: JOB_ID },
      meta: { requestId: REQUEST_ID },
    });
  });

  it("schrijft een minimale operationele alert wanneer cleanup dead-lettert", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runtime = {
      cronSecret: "a-production-length-cron-secret-value",
      worker: {
        processNext: vi.fn().mockResolvedValue({
          status: "dead_letter",
          jobId: JOB_ID,
          operation: "deletion",
        }),
      },
    } as unknown as AccountWorkerRuntime;
    const handler = createAccountCronHandler(() => runtime);

    try {
      await handler(new Request(
        "https://app.buildy.test/api/internal/cron/account-lifecycle",
        { headers: { authorization: `Bearer ${runtime.cronSecret}` } },
      ), REQUEST_ID);
      expect(errorLog).toHaveBeenCalledOnce();
      expect(JSON.parse(String(errorLog.mock.calls[0]?.[0]))).toMatchObject({
        level: "error",
        event: "account.lifecycle_dead_letter",
        requestId: REQUEST_ID,
        jobId: JOB_ID,
        operation: "deletion",
      });
    } finally {
      errorLog.mockRestore();
    }
  });
});
