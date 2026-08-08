import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outputRoot = path.resolve(process.argv[2] || "artifacts/baseline");
const targets = [
  { environment: "local", baseUrl: process.env.BASELINE_LOCAL_URL || "http://127.0.0.1:8090" },
  process.env.BASELINE_TARGET_URL
    ? { environment: process.env.BASELINE_TARGET_NAME || "staging", baseUrl: process.env.BASELINE_TARGET_URL }
    : null,
].filter(Boolean);

const ownerProjectId = process.env.BASELINE_OWNER_PROJECT_ID || "11111111-1111-4111-8111-111111111111";
const publicProjectId = process.env.BASELINE_PUBLIC_PROJECT_ID || "22222222-2222-4222-8222-222222222222";
const publicProfileId = process.env.BASELINE_PUBLIC_PROFILE_KEY || "voorbeeld-bouwer";

const scenarios = [
  { name: "landing-logged-out", route: "/" },
  { name: "discover-logged-out", route: "/ontdekken" },
  { name: "auth-login-register", route: "/auth?mode=register" },
  { name: "new-project-logged-out", route: "/project/nieuw" },
  { name: "own-project-unauthenticated", route: `/project/${ownerProjectId}` },
  { name: "public-project", route: `/project/${publicProjectId}` },
  { name: "private-project-access", route: `/project/${ownerProjectId}` },
  { name: "update-project-choice-logged-out", route: "/update/nieuw" },
  { name: "update-composer-unavailable-logged-out", route: `/project/${ownerProjectId}?update=nieuw` },
  { name: "before-after-viewer", route: `/project/${publicProjectId}` },
  { name: "connections", route: "/connecties" },
  { name: "public-profile", route: `/profiel/${publicProfileId}` },
  { name: "projects-unavailable-logged-out", route: "/projecten" },
  { name: "notifications-unavailable-logged-out", route: "/notificaties" },
  { name: "budget", route: `/project/${ownerProjectId}/budget` },
  { name: "floorplan", route: `/project/${publicProjectId}` },
  { name: "photobook", route: `/project/${ownerProjectId}/bouwboek` },
  { name: "checkout-unavailable-logged-out", route: `/project/${ownerProjectId}/bouwboek` },
  { name: "order-status", route: "/bestellingen/baseline-synthetic-order" },
  { name: "account-settings", route: "/account" },
];

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 1000 },
];

await mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];

for (const target of targets) {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      reducedMotion: "reduce",
      locale: "nl-NL",
    });

    for (const scenario of scenarios) {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });

      const url = `${target.baseUrl}${scenario.route}`;
      const fileName = `${target.environment}-${viewport.name}-${scenario.name}.png`;
      const filePath = path.join(outputRoot, fileName);
      let status = null;
      let finalUrl = url;
      let failure = null;

      try {
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        status = response?.status() ?? null;
        await page.waitForTimeout(1_000);
        finalUrl = page.url();
        await page.screenshot({ path: filePath, fullPage: true });
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }

      results.push({
        environment: target.environment,
        viewport,
        scenario: scenario.name,
        route: scenario.route,
        status,
        finalUrl,
        screenshot: failure ? null : fileName,
        errors: errors.slice(0, 10),
        failure,
        authenticated: false,
      });
      await page.close();
    }

    await context.close();
  }
}

await browser.close();
await writeFile(
  path.join(outputRoot, "manifest.json"),
  `${JSON.stringify({
    capturedAt: new Date().toISOString(),
    note: "Er waren geen synthetische testcredentials of veilige storageState beschikbaar. Ingelogde en owner-only scenario's tonen daarom eerlijk hun uitgelogde/toegangsstatus.",
    results,
  }, null, 2)}\n`,
  "utf8",
);

const failures = results.filter((result) => result.failure);
console.log(`Baseline: ${results.length - failures.length}/${results.length} screenshots opgeslagen in ${outputRoot}`);
if (failures.length > 0) {
  console.error(`${failures.length} scenario's konden niet worden vastgelegd.`);
  process.exitCode = 1;
}
