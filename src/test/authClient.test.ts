import { describe, expect, it } from "vitest";
import {
  authErrorDetails,
  authErrorMessage,
  authPagePath,
  safeNextPath,
} from "@/lib/authClient";

describe("Google OIDC client helpers", () => {
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
    const path = authPagePath("/project/project-1?tab=updates");
    const url = new URL(path, "https://app.buildy.test");

    expect(url.origin).toBe("https://app.buildy.test");
    expect(url.pathname).toBe("/auth");
    expect(url.searchParams.get("next")).toBe("/project/project-1?tab=updates");
    expect([...url.searchParams.keys()]).toEqual(["next"]);
  });

  it("extracts only non-sensitive error classification", () => {
    const error = {
      error: {
        code: "BETA_INVITE_REQUIRED",
        message: "provider detail that must not be shown",
      },
      status: 403,
    };

    expect(authErrorDetails(error)).toEqual({ code: "BETA_INVITE_REQUIRED", status: 403 });
    expect(authErrorMessage(error, "google")).toMatch(/uitnodiging/i);
    expect(authErrorMessage({ status: 429 }, "google")).toMatch(/te vaak/i);
    expect(authErrorMessage({ status: 503 }, "google")).toMatch(/tijdelijk/i);
    expect(authErrorMessage({ status: 503 }, "sign-out")).toMatch(/^Uitloggen is tijdelijk/i);
  });
});
