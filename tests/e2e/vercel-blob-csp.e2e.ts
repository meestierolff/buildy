import { readFileSync } from "node:fs";

import { allowBrowserDiagnostics, BASE, expect, test } from "./helpers";

type VercelHeaders = {
  headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
};

const deploymentConfig = JSON.parse(
  readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"),
) as VercelHeaders;
const contentSecurityPolicy = deploymentConfig.headers
  .find((rule) => rule.source === "/(.*)")?.headers
  .find((header) => header.key.toLowerCase() === "content-security-policy")?.value;

test("de echte CSP laat de Blob API toe en blokkeert andere Vercel API-paden", async ({ page }) => {
  expect(contentSecurityPolicy, "Gebruik de CSP die daadwerkelijk wordt gedeployed.").toBeTruthy();
  const origin = new URL(BASE).origin;
  const fixtureUrl = `${origin}/__synthetic-blob-csp`;
  const allowedUrls = [
    "https://vercel.com/api/blob",
    "https://vercel.com/api/blob/?pathname=synthetic-csp-fixture",
  ];
  const forbiddenUrl = "https://vercel.com/api/user";
  const providerRequests: string[] = [];

  allowBrowserDiagnostics(
    page,
    /^console: .*https:\/\/vercel\.com\/api\/user.*Content Security Policy/i,
    /^requestfailed: PUT https:\/\/vercel\.com\/api\/user \(net::ERR_(?:BLOCKED_BY_CSP|FAILED)\)$/,
  );

  // Only this isolated regression uses a synthetic provider response. The native
  // browser enforces the real deployment policy before an intercepted request.
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.url() === fixtureUrl) {
      await route.fulfill({
        contentType: "text/html",
        headers: { "content-security-policy": contentSecurityPolicy! },
        body: '<!doctype html><html lang="nl"><head><title>CSP fixture</title><link rel="icon" href="data:,"></head><body>Private foto-upload</body></html>',
      });
      return;
    }
    if ([...allowedUrls, forbiddenUrl].includes(request.url())) {
      if (request.method() !== "OPTIONS") providerRequests.push(request.url());
      await route.fulfill({
        status: request.method() === "OPTIONS" ? 204 : 200,
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "PUT, OPTIONS",
          "access-control-allow-headers": "content-type",
          "content-type": "application/json",
        },
        body: request.method() === "OPTIONS" ? "" : JSON.stringify({ synthetic: true }),
      });
      return;
    }
    await route.abort();
  });

  await page.goto(fixtureUrl);
  const result = await page.evaluate(async ({ allowedUrls, forbiddenUrl }) => {
    const violations: Array<{ directive: string; blockedURI: string; disposition: string }> = [];
    const collectViolation = (event: SecurityPolicyViolationEvent) => {
      violations.push({
        directive: event.effectiveDirective,
        blockedURI: event.blockedURI,
        disposition: event.disposition,
      });
    };
    document.addEventListener("securitypolicyviolation", collectViolation);
    const connect = async (url: string) => {
      try {
        const response = await fetch(url, {
          method: "PUT",
          credentials: "omit",
          body: "synthetic upload fixture",
        });
        return response.ok && (await response.json()).synthetic === true;
      } catch {
        return false;
      }
    };
    const allowed = [];
    for (const url of allowedUrls) allowed.push(await connect(url));
    const forbidden = await connect(forbiddenUrl);
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.removeEventListener("securitypolicyviolation", collectViolation);
    return { allowed, forbidden, violations };
  }, { allowedUrls, forbiddenUrl });

  expect(result.allowed).toEqual([true, true]);
  expect(result.forbidden).toBe(false);
  expect(providerRequests).toEqual(allowedUrls);
  expect(result.violations).toEqual([{
    directive: "connect-src",
    blockedURI: forbiddenUrl,
    disposition: "enforce",
  }]);
});
