// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  freeMvpReadinessFailures,
  launchReadinessFailures,
  parseLaunchCliArguments,
  requireExpectedGitSha,
  requireSyntheticStagingEmail,
  verifyDeployedGitSha,
  verifyFreeMvpCapabilities,
  verifyFreeMvpProductProfile,
  verifyLaunchCapabilities,
  verifyLaunchProductProfile,
  verifyPublicDemoCapabilities,
  verifyPublicDemoProductProfile,
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
      "--preview",
      "--base-url=https://preview.buildy.example",
      `--expected-sha=${RELEASE_SHA}`,
    ])).toEqual({
      staticOnly: false,
      requestedEnvironment: "preview",
      rawBaseUrl: "https://preview.buildy.example",
      rawExpectedGitSha: RELEASE_SHA,
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
      ["--preview", "--production"],
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

  it("requires the free MVP core while keeping invites, email, checkout and fulfilment disabled", () => {
    const capabilities = {
      database: "ready",
      authentication: "ready",
      accountLifecycle: "ready",
      media: "ready",
      photobooks: "ready",
      email: "disabled",
      payments: "disabled",
      printFulfilment: "disabled",
      privateBeta: "disabled",
    };

    expect(() => verifyFreeMvpCapabilities(capabilities)).not.toThrow();
    expect(() => verifyFreeMvpCapabilities({ ...capabilities, media: "unconfigured" }))
      .toThrow("kerncapabilities niet ready: media");
    expect(() => verifyFreeMvpCapabilities({ ...capabilities, privateBeta: "ready" }))
      .toThrow("privateBeta moet disabled");
    expect(() => verifyFreeMvpCapabilities({ ...capabilities, payments: "ready" }))
      .toThrow("payments moet disabled");
  });

  it("requires the exact open-signup, no-checkout product profile", () => {
    const profile = {
      profile: "feedback_beta",
      checkoutMode: "off",
      betaMode: false,
      inviteRequiredForNewAccounts: false,
      capabilities: {
        googleSignIn: true,
        emailAuth: false,
        renovations: true,
        updates: true,
        story: true,
        media: true,
        photobookPreview: true,
        sharing: true,
        feedback: true,
        accountDeletion: true,
        checkout: false,
      },
    };

    expect(() => verifyFreeMvpProductProfile(profile)).not.toThrow();
    expect(() => verifyFreeMvpProductProfile({ ...profile, betaMode: true }))
      .toThrow("BETA_MODE moet false");
    expect(() => verifyFreeMvpProductProfile({ ...profile, checkoutMode: "test" }))
      .toThrow("CHECKOUT_MODE moet off");
  });

  it("requires the exact provider-independent public demo profile", () => {
    const capabilities = {
      database: "unconfigured",
      authentication: "disabled",
      accountLifecycle: "disabled",
      media: "disabled",
      photobooks: "disabled",
      email: "disabled",
      payments: "disabled",
      printFulfilment: "disabled",
      privateBeta: "disabled",
    };
    const profile = {
      profile: "public_demo",
      checkoutMode: "off",
      betaMode: false,
      inviteRequiredForNewAccounts: false,
      capabilities: {
        googleSignIn: false,
        emailAuth: false,
        renovations: false,
        updates: false,
        story: false,
        media: false,
        photobookPreview: true,
        sharing: false,
        feedback: true,
        accountDeletion: false,
        checkout: false,
      },
    };

    expect(() => verifyPublicDemoCapabilities(capabilities)).not.toThrow();
    expect(() => verifyLaunchCapabilities(capabilities, "public_demo")).not.toThrow();
    expect(() => verifyPublicDemoProductProfile(profile)).not.toThrow();
    expect(() => verifyLaunchProductProfile(profile)).not.toThrow();
    expect(() => verifyPublicDemoCapabilities({ ...capabilities, authentication: "ready" }))
      .toThrow("authentication moet disabled");
    expect(() => verifyPublicDemoProductProfile({
      ...profile,
      capabilities: { ...profile.capabilities, checkout: true },
    })).toThrow("checkout moet uit staan");
    expect(() => verifyPublicDemoProductProfile({
      ...profile,
      capabilities: { ...profile.capabilities, feedback: false },
    })).toThrow("veilige supportroute");
    expect(() => verifyPublicDemoProductProfile({ ...profile, profile: "feedback_beta" }))
      .toThrow("PRODUCT_PROFILE moet public_demo");
  });

  it("requires active runtime workers but allows dormant commerce and print workers", () => {
    const checks = {
      configuration: "pass",
      database: "pass",
      accountWorker: "pass",
      mediaWorker: "pass",
      paymentWorker: "not_checked",
      photobookWorker: "not_checked",
    };

    expect(freeMvpReadinessFailures(checks)).toEqual([]);
    expect(freeMvpReadinessFailures({ ...checks, mediaWorker: "not_checked" }))
      .toEqual(["mediaWorker=not_checked"]);
    expect(freeMvpReadinessFailures({ ...checks, paymentWorker: "fail" }))
      .toEqual(["paymentWorker=fail"]);
    expect(launchReadinessFailures({
      configuration: "pass",
      database: "not_checked",
      accountWorker: "not_checked",
      mediaWorker: "not_checked",
      paymentWorker: "not_checked",
      photobookWorker: "not_checked",
    }, "public_demo")).toEqual([]);
    expect(launchReadinessFailures({
      configuration: "pass",
      database: "fail",
    }, "public_demo")).toEqual(["database=fail"]);
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
