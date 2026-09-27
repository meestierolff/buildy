import { afterEach, describe, expect, it, vi } from "vitest";
import { authClient, AuthClientError } from "@/lib/authClient";

const requestId = "22222222-2222-4222-8222-222222222222";
const password = "  drie rustige bouwdagen  ";

describe("username/password browser transport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    ["signIn", "/api/auth/sign-in"],
    ["signUp", "/api/auth/sign-up"],
  ] as const)("uses a typed same-origin cookie request for %s without storing credentials", async (method, path) => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ data: { next: "/project/nieuw?intent=eerste-bouwmoment" }, meta: { requestId } }));
    vi.stubGlobal("fetch", fetchMock);
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");

    const result = await authClient[method]({
      username: "Bouw_Eigenaar",
      password,
      next: "/project/nieuw?intent=eerste-bouwmoment",
    });

    expect(result).toBe("/project/nieuw?intent=eerste-bouwmoment");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(path, expect.objectContaining({
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ username: "bouw_eigenaar", password, next: result }),
    }));
    expect(storageSpy).not.toHaveBeenCalled();
  });

  it("sanitizes the destination while preserving all password whitespace", async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: { next: "/" }, meta: { requestId } }));
    vi.stubGlobal("fetch", fetchMock);

    await authClient.signIn({ username: "eigenaar", password, next: "//attacker.example/steal" });

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/sign-in", expect.objectContaining({
      body: JSON.stringify({ username: "eigenaar", password, next: "/" }),
    }));
  });

  it("rejects invalid registration input before sending it", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(authClient.signUp({ username: "eigenaar", password: "te kort" })).rejects.toThrow();
    await expect(authClient.signUp({ username: "email@example.test", password })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the server error classification for generic invalid-credential feedback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      error: { code: "INVALID_CREDENTIALS", message: "Sign-in failed", requestId },
    }, { status: 401 })));
    await expect(authClient.signIn({ username: "eigenaar", password })).rejects.toMatchObject({
      name: "AuthClientError", code: "INVALID_CREDENTIALS", status: 401,
    } satisfies Partial<AuthClientError>);
  });

  it("reads an account session without inventing an email or verified-email claim", async () => {
    const now = "2026-09-08T12:00:00.000Z";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      data: {
        session: { id: requestId, userId: "username-account", createdAt: now, updatedAt: now, expiresAt: "2026-10-08T12:00:00.000Z" },
        user: { id: "username-account", name: "Eigenaar", username: "eigenaar", email: null, emailVerified: false, image: null, createdAt: now, updatedAt: now },
      },
      meta: { requestId },
    })));

    expect((await authClient.getSession()).user).toMatchObject({
      username: "eigenaar", email: null, emailVerified: false,
      createdAt: new Date(now),
    });
  });
});
