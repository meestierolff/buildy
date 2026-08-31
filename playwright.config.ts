import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const playwrightMode = process.env.PLAYWRIGHT_MODE?.trim() ?? "";
if (!["", "preview", "staging-real"].includes(playwrightMode)) {
  throw new Error(`Onbekende PLAYWRIGHT_MODE: ${playwrightMode}`);
}

// When PLAYWRIGHT_MODE=preview we serve the production build via `vite preview`,
// which is what runs after every CI build. Otherwise fall back to `vite dev`
// for local iteration.
const useProductionPreview = playwrightMode === "preview";
const useRealStaging = playwrightMode === "staging-real";
const configuredBaseURL = process.env.PLAYWRIGHT_BASE_URL?.trim();
const configuredStorageState = process.env.PLAYWRIGHT_STORAGE_STATE?.trim();
const configuredStagingProjectId = process.env.PLAYWRIGHT_STAGING_PROJECT_ID?.trim();
const vercelAutomationBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();

if (useRealStaging) {
  if (!configuredBaseURL) throw new Error("PLAYWRIGHT_BASE_URL is verplicht voor staging-real.");
  const target = new URL(configuredBaseURL);
  if (
    configuredBaseURL !== target.origin
    || target.protocol !== "https:"
    || target.username
    || target.password
  ) throw new Error("staging-real accepteert uitsluitend één exacte HTTPS-origin.");
  if (!configuredStorageState || !existsSync(configuredStorageState)) {
    throw new Error("PLAYWRIGHT_STORAGE_STATE moet naar een bestaande beschermde statefile wijzen.");
  }
  if (
    !configuredStagingProjectId
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(configuredStagingProjectId)
  ) {
    throw new Error("PLAYWRIGHT_STAGING_PROJECT_ID ontbreekt of is ongeldig.");
  }
}

const baseURL = configuredBaseURL || "http://127.0.0.1:8090";
const devCommand = "bun run dev:web -- --host 127.0.0.1 --port 8090";
const previewCommand = "bunx vite preview --host 127.0.0.1 --port 8090 --strictPort";
const crossBrowserCoreTestMatch =
  /(?:canonical-routes|discovery|friends-follow|landing-photo-handoff|photobook|project-detail|project-registration-synthetic|project-share-link|public-accessibility)\.e2e\.ts/;
const mobileChromiumTestMatch =
  /(?:canonical-routes|discovery|friends-follow|landing-photo-handoff|photobook|project-detail|project-registration-synthetic|project-share-link|public-accessibility|public-demo)\.e2e\.ts/;

const desktopViewport = { width: 1440, height: 1000 } as const;
const tabletViewport = { width: 768, height: 1024 } as const;
const mobileViewport = { width: 390, height: 844 } as const;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: useRealStaging ? /staging-real\.e2e\.ts/ : /.*\.e2e\.ts/,
  testIgnore: useRealStaging ? undefined : /staging-real\.e2e\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // A retry after Stripe accepted payment would create a second real test
  // order. The manual provider gate therefore runs exactly once.
  retries: useRealStaging ? 0 : process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    storageState: process.env.PLAYWRIGHT_STORAGE_STATE || undefined,
    extraHTTPHeaders: vercelAutomationBypassSecret
      ? { "x-vercel-protection-bypass": vercelAutomationBypassSecret }
      : undefined,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  ...(process.env.PLAYWRIGHT_BASE_URL
    ? {}
    : {
        webServer: {
          command: useProductionPreview ? previewCommand : devCommand,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
  projects: useRealStaging ? [
    {
      name: "staging-real",
      testMatch: /staging-real\.e2e\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: desktopViewport },
    },
  ] : [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: desktopViewport },
    },
    {
      name: "firefox-core",
      testMatch: crossBrowserCoreTestMatch,
      use: { ...devices["Desktop Firefox"], viewport: desktopViewport },
    },
    {
      name: "webkit-core",
      testMatch: crossBrowserCoreTestMatch,
      use: { ...devices["Desktop Safari"], viewport: desktopViewport },
    },
    {
      name: "mobile-chromium",
      testMatch: mobileChromiumTestMatch,
      use: { ...devices["Pixel 5"], viewport: mobileViewport },
    },
    {
      name: "tablet-chromium",
      testMatch: crossBrowserCoreTestMatch,
      use: {
        ...devices["Desktop Chrome"],
        viewport: tabletViewport,
        hasTouch: true,
      },
    },
  ],
});
