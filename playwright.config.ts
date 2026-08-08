import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8090";

// When PLAYWRIGHT_MODE=preview we serve the production build via `vite preview`,
// which is what runs after every CI build. Otherwise fall back to `vite dev`
// for local iteration.
const useProductionPreview = process.env.PLAYWRIGHT_MODE === "preview";
const devCommand = "bun run dev:web -- --host 127.0.0.1 --port 8090";
const previewCommand = "bunx vite preview --host 127.0.0.1 --port 8090 --strictPort";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.e2e\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    storageState: process.env.PLAYWRIGHT_STORAGE_STATE || undefined,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: process.env.CI ? "retain-on-failure" : "off",
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
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
