import { afterEach, describe, expect, it, vi } from "vitest";

function requestUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString();
}

describe("Better Auth browser transport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("uses same-origin cookie requests and never persists a returned token", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const pathname = new URL(requestUrl(input), window.location.origin).pathname;
      if (pathname.endsWith("/sign-in/email")) {
        return Response.json({
          redirect: false,
          token: "server-session-token",
          user: {
            createdAt: new Date().toISOString(),
            email: "bewoner@example.com",
            emailVerified: true,
            id: "auth-user-1",
            image: null,
            name: "Bewoner",
            updatedAt: new Date().toISOString(),
          },
        });
      }
      return Response.json({ status: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    const { authClient } = await import("@/lib/authClient");

    const result = await authClient.signIn.email({
      email: "bewoner@example.com",
      password: "correct-horse-battery-staple",
    });

    expect(result.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0];
    const url = new URL(requestUrl(input), window.location.origin);
    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toBe("/api/auth/sign-in/email");
    expect(url.search).not.toContain("password");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect(storageSpy.mock.calls.flat().join(" ")).not.toContain("server-session-token");
  });
});
