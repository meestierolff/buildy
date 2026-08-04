import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outputRoot = path.resolve(process.argv[2] || "artifacts/baseline");
const targets = [
  { environment: "local", baseUrl: process.env.BASELINE_LOCAL_URL || "http://127.0.0.1:8090" },
  { environment: "live", baseUrl: process.env.BASELINE_LIVE_URL || "https://buildy-log.lovable.app" },
];

const ownerProjectId = "373b3e31-fb84-45e4-9103-9de7beb43563";
const publicProjectId = "08bab0ef-3afc-4a6a-81c3-640a071ac464";
const publicProfileId = "af842993-4095-47f7-91e8-a05575ceb70b";

const scenarios = [
  { name: "landing-logged-out", route: "/" },
  { name: "auth-login-register", route: "/auth?mode=register" },
  { name: "new-project-logged-out", route: "/trips/new" },
  { name: "own-project-unauthenticated", route: `/trip/${ownerProjectId}` },
  { name: "public-project", route: `/trip/${publicProjectId}` },
  { name: "private-project-access", route: `/trip/${ownerProjectId}` },
  { name: "update-composer-unavailable-logged-out", route: `/trip/${ownerProjectId}` },
  { name: "before-after-viewer", route: `/trip/${publicProjectId}` },
  { name: "connections", route: "/vrienden" },
  { name: "public-profile", route: `/profile/${publicProfileId}` },
  { name: "notifications-unavailable-logged-out", route: "/" },
  { name: "budget", route: `/trip/${ownerProjectId}/budget` },
  { name: "floorplan", route: `/trip/${publicProjectId}` },
  { name: "photobook", route: `/trip/${ownerProjectId}/photobook` },
  { name: "checkout-unavailable-logged-out", route: `/trip/${ownerProjectId}/photobook` },
  { name: "order-status", route: "/bestelling/baseline-synthetic-order" },
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
