// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { healthResponseSchema } from "../../shared/contracts/api";
import { apiRequest, ApiClientError } from "@/lib/apiClient";

describe("typed API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("stuurt cookies mee en valideert een successrespons", async () => {
    const requestId = "da44d420-7705-4c85-80b3-f0a70f954a20";
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      data: {
        status: "ok",
        environment: "test",
        release: "test",
        capabilities: {
          database: "unconfigured",
          authentication: "unconfigured",
          accountLifecycle: "unconfigured",
          media: "unconfigured",
          photobooks: "unconfigured",
          email: "unconfigured",
          payments: "unconfigured",
          printFulfilment: "unconfigured",
          privateBeta: "unconfigured",
        },
      },
      meta: { requestId },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await apiRequest("/api/health", healthResponseSchema);

    expect(response.meta.requestId).toBe(requestId);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ credentials: "include", method: "GET" }),
    );
  });

  it("vertaalt een getypeerde serverfout zonder gevoelige fallbackdetails", async () => {
    const requestId = "f9f23064-bdfb-4ee0-af3d-f05cfbe452b8";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      error: {
        code: "FORBIDDEN",
        message: "Geen toegang.",
        requestId,
      },
    }, { status: 403 })));

    await expect(apiRequest("/api/private", healthResponseSchema)).rejects.toMatchObject({
      name: "ApiClientError",
      code: "FORBIDDEN",
      status: 403,
      requestId,
    } satisfies Partial<ApiClientError>);
  });

  it("weigert een 200-respons die niet aan het contract voldoet", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { status: "ok" } })));
    await expect(apiRequest("/api/health", healthResponseSchema)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });
});
