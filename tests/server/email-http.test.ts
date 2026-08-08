// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createEmailCronHandler } from "../../server/email/http";
import type { ConfiguredEmailWorker } from "../../server/email/runtime";

const REQUEST_ID = "10000000-0000-4000-8000-000000000001";

function runtime(runOnce = vi.fn().mockResolvedValue({
  claimed: 2,
  deadLettered: 0,
  delivered: 2,
  reconciled: 1,
  retried: 0,
  skipped: 0,
})) {
  return {
    cronSecret: "a-production-length-cron-secret-value",
    worker: { runOnce },
  } as unknown as ConfiguredEmailWorker;
}

describe("e-mail cron HTTP boundary", () => {
  it("rejects a missing or incorrect bearer secret without running the worker", async () => {
    const configured = runtime();
    const handler = createEmailCronHandler(() => configured);

    await expect(handler(
      new Request("https://app.buildy.test/api/internal/cron/email"),
      REQUEST_ID,
    )).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    await expect(handler(
      new Request("https://app.buildy.test/api/internal/cron/email", {
        headers: { authorization: "Bearer incorrect-secret" },
      }),
      REQUEST_ID,
    )).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(configured.worker.runOnce).not.toHaveBeenCalled();
  });

  it("returns only aggregate counters for an authenticated invocation", async () => {
    const configured = runtime();
    const handler = createEmailCronHandler(() => configured);
    const response = await handler(new Request(
      "https://app.buildy.test/api/internal/cron/email",
      { headers: { authorization: `Bearer ${configured.cronSecret}` } },
    ), REQUEST_ID);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        claimed: 2,
        deadLettered: 0,
        delivered: 2,
        reconciled: 1,
        retried: 0,
        skipped: 0,
      },
      meta: { requestId: REQUEST_ID },
    });
    expect(configured.worker.runOnce).toHaveBeenCalledOnce();
  });
});
