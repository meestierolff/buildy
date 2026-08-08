import { describe, expect, it } from "vitest";
import {
  authErrorDetails,
  authErrorMessage,
  authPagePath,
  parsePasswordResetLink,
  safeNextPath,
} from "@/lib/authClient";

describe("Better Auth client helpers", () => {
  it("keeps only canonical same-origin application next paths", () => {
    expect(safeNextPath("/project/project-1?tab=foto%27s#update-2")).toBe(
      "/project/project-1?tab=foto%27s#update-2",
    );

    for (const unsafe of [
      "https://attacker.example/steal",
      "//attacker.example/steal",
      "/\\attacker.example",
      "/%5cattacker.example",
      "/%2f%2fattacker.example",
      "/%252f%252fattacker.example",
      "/api/auth/get-session",
      "/auth?next=/project/project-1",
      "/wachtwoord-resetten",
      "/project/project-1\nSet-Cookie:evil",
      "project/project-1",
    ]) {
      expect(safeNextPath(unsafe)).toBe("/");
    }
  });

  it("builds relative auth callback paths without exposing another origin", () => {
    const path = authPagePath("/project/project-1?tab=updates", "verified");
    const url = new URL(path, "https://app.buildy.test");

    expect(url.origin).toBe("https://app.buildy.test");
    expect(url.pathname).toBe("/auth");
    expect(url.searchParams.get("next")).toBe("/project/project-1?tab=updates");
    expect(url.searchParams.get("verified")).toBe("1");
  });

  it("extracts only non-sensitive error classification", () => {
    const error = {
      error: {
        code: "EMAIL_NOT_VERIFIED",
        message: "provider detail that must not be shown",
      },
      status: 403,
    };

    expect(authErrorDetails(error)).toEqual({ code: "EMAIL_NOT_VERIFIED", status: 403 });
    expect(authErrorMessage(error, "sign-in")).toMatch(/bevestig/i);
    expect(authErrorMessage({ status: 429 }, "sign-in")).toMatch(/te vaak/i);
    expect(authErrorMessage({ status: 503 }, "sign-in")).toMatch(/tijdelijk/i);
  });

  it("accepts a bounded reset token and rejects malformed links", () => {
    expect(parsePasswordResetLink("?token=abc_DEF-123&next=%2Ftrip%2F1")).toEqual({
      token: "abc_DEF-123",
    });
    expect(parsePasswordResetLink("?error=TOKEN_EXPIRED&token=ignored")).toEqual({
      errorCode: "TOKEN_EXPIRED",
    });
    expect(parsePasswordResetLink("?token=%3Cscript%3E")).toEqual({
      errorCode: "INVALID_TOKEN",
    });
    expect(parsePasswordResetLink("")).toEqual({ errorCode: "INVALID_TOKEN" });
  });
});
