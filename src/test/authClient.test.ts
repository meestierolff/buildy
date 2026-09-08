import { describe, expect, it } from "vitest";
import {
  authErrorDetails,
  authErrorMessage,
  authPagePath,
  safeNextPath,
} from "@/lib/authClient";

describe("username/password client helpers", () => {
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
    expect(authErrorMessage(error, "sign-up")).toMatch(/uitnodiging/i);
    expect(authErrorMessage({ status: 429 }, "sign-in")).toMatch(/te vaak/i);
    expect(authErrorMessage({ status: 503 }, "sign-in")).toMatch(/tijdelijk/i);
    expect(authErrorMessage({ status: 503 }, "sign-out")).toMatch(/^Uitloggen is tijdelijk/i);
  });

  it("does not distinguish an unknown username from an incorrect password", () => {
    expect(authErrorMessage({ code: "INVALID_CREDENTIALS", status: 401 }, "sign-in"))
      .toBe("Je gebruikersnaam of wachtwoord klopt niet. Probeer het opnieuw.");
    expect(authErrorMessage({ code: "USERNAME_UNAVAILABLE", status: 409 }, "sign-up")).toMatch(/gebruikersnaam is niet beschikbaar/);
    expect(authErrorMessage({ code: "WEAK_PASSWORD", status: 400 }, "sign-up")).toMatch(/minimaal 15 tekens/);
  });
});
