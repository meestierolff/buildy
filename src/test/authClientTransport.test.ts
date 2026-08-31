import { afterEach, describe, expect, it, vi } from "vitest";

function requestUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString();
}

describe("Google OIDC browser transport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("starts Google login with a same-origin cookie request and never persists tokens", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        data: {
          authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?client_id=public-client-id",
        },
        meta: { requestId: "22222222-2222-4222-8222-222222222222" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    const { authClient } = await import("@/lib/authClient");

    const result = await authClient.beginGoogleSignIn("/projecten");

    expect(result).toContain("accounts.google.com");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0]!;
    const url = new URL(requestUrl(input), window.location.origin);
    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toBe("/api/auth/sign-in/google");
    expect(url.search).toBe("");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect(JSON.parse(String(init?.body))).toEqual({ next: "/projecten" });
    expect(storageSpy).not.toHaveBeenCalled();
  });
});
