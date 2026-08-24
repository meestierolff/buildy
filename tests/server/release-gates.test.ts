// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  parseLaunchCliArguments,
  requireExpectedGitSha,
  requireSyntheticStagingEmail,
  verifyCheckoutCapability,
  verifyDeployedGitSha,
  verifySyntheticSessionEmail,
} from "../../scripts/release-gates.mjs";

const RELEASE_SHA = "0123456789abcdef0123456789abcdef01234567";

describe("deployment release identity gates", () => {
  it("parses exactly one explicit launch mode and rejects ambiguous or unknown CLI input", () => {
    expect(parseLaunchCliArguments(["--static"])).toEqual({
      staticOnly: true,
      requestedEnvironment: undefined,
      rawBaseUrl: undefined,
      rawExpectedGitSha: undefined,
    });
    expect(parseLaunchCliArguments([
      "--staging",
      "--base-url=https://staging.buildy.example",
      `--expected-sha=${RELEASE_SHA}`,
    ])).toEqual({
      staticOnly: false,
      requestedEnvironment: "staging",
      rawBaseUrl: "https://staging.buildy.example",
      rawExpectedGitSha: RELEASE_SHA,
    });
    expect(parseLaunchCliArguments(["--production"], {
      APP_ORIGIN: "https://buildy.example",
      LAUNCH_EXPECTED_GIT_SHA: RELEASE_SHA,
    })).toMatchObject({
      requestedEnvironment: "production",
      rawBaseUrl: "https://buildy.example",
      rawExpectedGitSha: RELEASE_SHA,
    });

    for (const input of [
      [],
      ["--definitely-unknown"],
      ["--static", "--production"],
      ["--staging", "--production"],
      ["--staging", "--environment=staging"],
      ["--environment=local"],
      ["--staging", "--base-url"],
      ["--staging", "--base-url=https://one.example", "--base-url=https://two.example"],
    ]) {
      expect(() => parseLaunchCliArguments(input)).toThrow();
    }
  });

  it("requires a full git SHA", () => {
    expect(requireExpectedGitSha(RELEASE_SHA.toUpperCase())).toBe(RELEASE_SHA);
    expect(() => requireExpectedGitSha(undefined)).toThrow("volledige verwachte 40-teken git-SHA");
    expect(() => requireExpectedGitSha(RELEASE_SHA.slice(0, 12))).toThrow("volledige verwachte 40-teken git-SHA");
  });

  it("matches the deployed full SHA exactly", () => {
    expect(() => verifyDeployedGitSha(RELEASE_SHA, RELEASE_SHA)).not.toThrow();
    expect(() => verifyDeployedGitSha(`${RELEASE_SHA.slice(0, 39)}8`, RELEASE_SHA)).toThrow("komt niet overeen");
    expect(() => verifyDeployedGitSha(RELEASE_SHA.slice(0, 12), RELEASE_SHA)).toThrow("geen volledige geldige git-SHA");
  });

  it("requires test checkout in staging and live checkout in production", () => {
    expect(() => verifyCheckoutCapability("production", "ready")).not.toThrow();
    expect(() => verifyCheckoutCapability("production", "disabled")).toThrow("production vereist live checkout");
    expect(() => verifyCheckoutCapability("staging", "ready")).not.toThrow();
    expect(() => verifyCheckoutCapability("staging", "disabled")).toThrow("staging vereist test checkout");
    expect(() => verifyCheckoutCapability("staging", "unconfigured")).toThrow("staging vereist test checkout");
  });

  it("accepts only a dedicated non-personal staging account and binds the live session to it", () => {
    const email = requireSyntheticStagingEmail("buildy-staging-e2e@example.com");
    expect(email).toBe("buildy-staging-e2e@example.com");
    expect(() => requireSyntheticStagingEmail("persoon@example.com")).toThrow("niet-persoonlijk");
    expect(() => requireSyntheticStagingEmail(" buildy-staging-e2e@example.com")).toThrow("niet-persoonlijk");
    expect(() => verifySyntheticSessionEmail("BUILDY-STAGING-E2E@example.com", email)).not.toThrow();
    expect(() => verifySyntheticSessionEmail("persoon@example.com", email)).toThrow("synthetische account");
  });
});
