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

  it("maps Preview/staging to test checkout and Production to live checkout", () => {
    expect(releaseContractFor("preview")).toEqual({
      profile: "feedback_beta",
      checkoutMode: "test",
    });
    expect(releaseContractFor("staging")).toEqual({
      profile: "feedback_beta",
      checkoutMode: "test",
    });
    expect(releaseContractFor("production")).toEqual({
      profile: "feedback_beta",
      checkoutMode: "live",
    });
    expect(() => releaseContractFor("local" as never)).toThrow("onbekende releaseomgeving");
  });

  it("requires the production-MVP core including payments", () => {
    const capabilities = {
      database: "ready",
      authentication: "ready",
      accountLifecycle: "ready",
      media: "ready",
      photobooks: "ready",
      email: "disabled",
      payments: "ready",
      printFulfilment: "disabled",
      privateBeta: "disabled",
    };

    expect(() => verifyTargetCapabilities(capabilities)).not.toThrow();
    expect(() => verifyTargetCapabilities({ ...capabilities, media: "unconfigured" }))
      .toThrow("kerncapabilities niet ready: media");
    expect(() => verifyTargetCapabilities({ ...capabilities, privateBeta: "ready" }))
      .toThrow("privateBeta moet disabled");
    expect(() => verifyTargetCapabilities({ ...capabilities, payments: "disabled" }))
      .toThrow("kerncapabilities niet ready: payments");
  });

  it("requires the exact target checkout mode and active checkout capability", () => {
    const profile = {
      profile: "feedback_beta",
      checkoutMode: "test",
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
        checkout: true,
      },
    };
    const previewContract = releaseContractFor("preview");
    const productionContract = releaseContractFor("production");

    expect(() => verifyTargetProductProfile(profile, previewContract)).not.toThrow();
    expect(() => verifyTargetProductProfile({ ...profile, checkoutMode: "live" }, productionContract))
      .not.toThrow();
    expect(() => verifyTargetProductProfile({ ...profile, betaMode: true }, previewContract))
      .toThrow("BETA_MODE moet false");
    expect(() => verifyTargetProductProfile({ ...profile, profile: "public_demo" }, previewContract))
      .toThrow("PRODUCT_PROFILE moet feedback_beta");
    expect(() => verifyTargetProductProfile({ ...profile, checkoutMode: "off" }, previewContract))
      .toThrow("CHECKOUT_MODE moet test");
    expect(() => verifyTargetProductProfile({
      ...profile,
      capabilities: { ...profile.capabilities, checkout: false },
    }, previewContract)).toThrow("productcapabilities niet beschikbaar: checkout");
  });

  it("requires all five database boundaries and both active worker checks", () => {
    const checks = {
      configuration: "pass",
      database: "pass",
      accountWorker: "pass",
      mediaWorker: "pass",
      paymentWorker: "pass",
      photobookWorker: "pass",
    };

    expect(targetReadinessFailures(checks)).toEqual([]);
    expect(targetReadinessFailures({ ...checks, mediaWorker: "not_checked" }))
      .toEqual(["mediaWorker=not_checked"]);
    expect(targetReadinessFailures({ ...checks, paymentWorker: "fail" }))
      .toEqual(["paymentWorker=fail"]);
    expect(targetReadinessFailures({ ...checks, photobookWorker: "not_checked" }))
      .toEqual(["photobookWorker=not_checked"]);
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
