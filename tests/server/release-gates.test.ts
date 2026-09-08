// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  parseLaunchCliArguments,
  releaseContractFor,
  requireExpectedGitSha,
  requireSyntheticStagingEmail,
  targetReadinessFailures,
  verifyDeployedGitSha,
  verifySyntheticSessionEmail,
  verifyTargetCapabilities,
  verifyTargetProductProfile,
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

  it("keeps checkout off in every free MVP release environment", () => {
    expect(releaseContractFor("preview")).toEqual({
      profile: "feedback_beta",
      checkoutMode: "off",
    });
    expect(releaseContractFor("staging")).toEqual({
      profile: "feedback_beta",
      checkoutMode: "off",
    });
    expect(releaseContractFor("production")).toEqual({
      profile: "feedback_beta",
      checkoutMode: "off",
    });
    expect(() => releaseContractFor("local" as never)).toThrow("onbekende releaseomgeving");
  });

  it("requires accounts and storage while rejecting active payments", () => {
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

    expect(() => verifyTargetCapabilities(capabilities)).not.toThrow();
    expect(() => verifyTargetCapabilities({ ...capabilities, media: "unconfigured" }))
      .toThrow("kerncapabilities niet ready: media");
    expect(() => verifyTargetCapabilities({ ...capabilities, privateBeta: "ready" }))
      .toThrow("privateBeta moet disabled");
    expect(() => verifyTargetCapabilities({ ...capabilities, payments: "ready" }))
      .toThrow("payments moet disabled");
  });

  it("requires the account product and rejects checkout activation or a demo", () => {
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
    const previewContract = releaseContractFor("preview");
    const productionContract = releaseContractFor("production");

    expect(() => verifyTargetProductProfile(profile, previewContract)).not.toThrow();
    expect(() => verifyTargetProductProfile(profile, productionContract)).not.toThrow();
    expect(() => verifyTargetProductProfile({ ...profile, checkoutMode: "live" }, productionContract))
      .toThrow("CHECKOUT_MODE moet off");
    expect(() => verifyTargetProductProfile({ ...profile, betaMode: true }, previewContract))
      .toThrow("BETA_MODE moet false");
    expect(() => verifyTargetProductProfile({ ...profile, profile: "public_demo" }, previewContract))
      .toThrow("PRODUCT_PROFILE moet feedback_beta");
    expect(() => verifyTargetProductProfile({ ...profile, checkoutMode: "test" }, previewContract))
      .toThrow("CHECKOUT_MODE moet off");
    expect(() => verifyTargetProductProfile({
      ...profile,
      capabilities: { ...profile.capabilities, checkout: true },
    }, previewContract)).toThrow("checkout moeten uit staan");
  });

  it("requires core database boundaries and permits explicitly idle commerce workers", () => {
    const checks = {
      configuration: "pass",
      database: "pass",
      accountWorker: "pass",
      mediaWorker: "pass",
      paymentWorker: "not_checked",
      photobookWorker: "not_checked",
    };

    expect(targetReadinessFailures(checks)).toEqual([]);
    expect(targetReadinessFailures({ ...checks, mediaWorker: "not_checked" }))
      .toEqual(["mediaWorker=not_checked"]);
    expect(targetReadinessFailures({ ...checks, paymentWorker: "fail" }))
      .toEqual(["paymentWorker=fail"]);
    expect(targetReadinessFailures({ ...checks, photobookWorker: "fail" }))
      .toEqual(["photobookWorker=fail"]);
    expect(targetReadinessFailures({ configuration: "pass" })).toEqual([
      "database=missing",
      "accountWorker=missing",
      "mediaWorker=missing",
      "paymentWorker=missing",
      "photobookWorker=missing",
    ]);
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
