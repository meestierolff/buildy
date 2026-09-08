// @vitest-environment node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RELEASE_SHA = "0123456789abcdef0123456789abcdef01234567";
const root = process.cwd();

const fetchFixture = `
const target = process.env.BUILDY_LAUNCH_FIXTURE_TARGET;
const checkoutMode = process.env.BUILDY_LAUNCH_FIXTURE_CHECKOUT_MODE;
const profileName = process.env.BUILDY_LAUNCH_FIXTURE_PROFILE ?? "feedback_beta";
const paymentWorker = process.env.BUILDY_LAUNCH_FIXTURE_PAYMENT_WORKER ?? "pass";
const release = process.env.BUILDY_LAUNCH_FIXTURE_SHA;
const origin = process.env.BUILDY_LAUNCH_FIXTURE_ORIGIN;

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify({ data }), {
  status,
  headers: { "content-type": "application/json", ...headers },
});
const productCapabilities = {
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
};
const healthCapabilities = {
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
const readinessChecks = {
  configuration: "pass",
  database: "pass",
  accountWorker: "pass",
  mediaWorker: "pass",
  paymentWorker,
  photobookWorker: "pass",
};

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init.method ?? (input instanceof Request ? input.method : "GET");
  if (url.pathname === "/") {
    return new Response("<!doctype html>", {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": "default-src 'self'",
        "cross-origin-opener-policy": "same-origin-allow-popups",
        "permissions-policy": "camera=(self)",
        "referrer-policy": "no-referrer",
        "strict-transport-security": "max-age=63072000",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
      },
    });
  }
  if (url.pathname === "/api/product-profile") {
    return json({
      profile: profileName,
      checkoutMode,
      betaMode: false,
      inviteRequiredForNewAccounts: false,
      capabilities: productCapabilities,
    });
  }
  if (url.pathname === "/api/health") {
    return json({ status: "ok", environment: target, release, capabilities: healthCapabilities }, 200, {
      "x-request-id": "00000000-0000-4000-8000-000000000000",
    });
  }
  if (url.pathname === "/api/readiness") return json({ ready: true, checks: readinessChecks });
  if (["/privacy", "/voorwaarden", "/herroeping", "/robots.txt", "/sitemap.xml"].includes(url.pathname)) {
    return new Response("ok", { status: 200 });
  }
  if (url.pathname.startsWith("/api/media/") && url.pathname.endsWith("/original")) {
    return json({}, 401);
  }
  if (url.pathname === "/api/projects" && method === "POST") {
    const requestOrigin = new Headers(init.headers).get("origin");
    return json({}, requestOrigin === origin ? 401 : 403);
  }
  if (url.pathname === "/api/admin/orders") return json({}, 401);
  if (url.pathname === "/api/internal/cron/account-lifecycle") return json({}, 401);
  if (["/api/internal/cron/media", "/api/internal/cron/photobooks"].includes(url.pathname)) {
    return json({}, 404);
  }
  if (url.pathname === "/api/webhooks/stripe") return json({}, 400);
  return json({}, 404);
};
`;
const preload = `data:text/javascript,${encodeURIComponent(fetchFixture)}`;

function runLaunchCheck(
  target: "preview" | "staging" | "production",
  checkoutMode: "test" | "live",
  profile = "feedback_beta",
  paymentWorker = "pass",
) {
  const origin = `https://${target}.buildy.test`;
  return spawnSync(process.execPath, [
    "--import",
    preload,
    resolve(root, "scripts/check-launch.mjs"),
    `--${target}`,
    `--base-url=${origin}`,
    `--expected-sha=${RELEASE_SHA}`,
  ], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      BUILDY_LAUNCH_FIXTURE_TARGET: target,
      BUILDY_LAUNCH_FIXTURE_CHECKOUT_MODE: checkoutMode,
      BUILDY_LAUNCH_FIXTURE_PROFILE: profile,
      BUILDY_LAUNCH_FIXTURE_PAYMENT_WORKER: paymentWorker,
      BUILDY_LAUNCH_FIXTURE_SHA: RELEASE_SHA,
      BUILDY_LAUNCH_FIXTURE_ORIGIN: origin,
    },
  });
}

describe("target-aware launch check", () => {
  it.each(["preview", "staging"] as const)(
    "requires feedback_beta with Stripe test mode for %s",
    (target) => {
      const result = runLaunchCheck(target, "test");

      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain(`${target} op https://${target}.buildy.test; feedback_beta/test`);
      expect(result.stdout).toContain("checkout test; volledige productcapabilities actief");
      expect(result.stdout).toContain("configuratie-/database- en workergrenzen pass");
    },
  );

  it("requires feedback_beta with Stripe live mode for production", () => {
    const result = runLaunchCheck("production", "live");

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain("production op https://production.buildy.test; feedback_beta/live");
    expect(result.stdout).toContain("checkout live; volledige productcapabilities actief");
  });

  it("fails closed on a checkout mode or product-profile mismatch", () => {
    const wrongMode = runLaunchCheck("production", "test");
    const wrongProfile = runLaunchCheck("preview", "test", "public_demo");
    const uncheckedPaymentWorker = runLaunchCheck("preview", "test", "feedback_beta", "not_checked");

    expect(wrongMode.status).toBe(1);
    expect(wrongMode.stdout).toContain("CHECKOUT_MODE moet live zijn voor dit releasedoel");
    expect(wrongProfile.status).toBe(1);
    expect(wrongProfile.stdout).toContain("PRODUCT_PROFILE moet feedback_beta zijn");
    expect(uncheckedPaymentWorker.status).toBe(1);
    expect(uncheckedPaymentWorker.stdout).toContain("paymentWorker=not_checked");
  });
});
