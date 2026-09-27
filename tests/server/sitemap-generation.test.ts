import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(process.cwd(), "scripts/generate-sitemap.mjs");
const temporaryDirectories: string[] = [];

function outputDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "buildy-sitemap-"));
  temporaryDirectories.push(directory);
  return directory;
}

function generate(output: string, environment: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [SCRIPT, "--output-dir", output], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      APP_ORIGIN: "",
      VITE_SITE_URL: "",
      ...environment,
    },
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("provider-neutral sitemap generation", () => {
  it("fails closed to a reserved origin and excludes private application routes", () => {
    const output = outputDirectory();
    const result = generate(output);

    expect(result.status, result.stderr).toBe(0);
    const sitemap = readFileSync(join(output, "sitemap.xml"), "utf8");
    const robots = readFileSync(join(output, "robots.txt"), "utf8");

    expect(sitemap).toContain("https://buildy.invalid/");
    expect(sitemap).not.toContain("/ontdekken</loc>");
    expect(sitemap).not.toContain("/projecten</loc>");
    expect(sitemap).not.toContain("/notificaties</loc>");
    expect(robots).toContain("Disallow: /notificaties");
    expect(robots).toContain("Disallow: /update/nieuw");
    expect(robots).not.toContain("/meldingen");
  });

  it("publishes only static public pages for the configured origin", () => {
    const output = outputDirectory();
    const result = generate(output, { APP_ORIGIN: "https://preview.example.test" });
    expect(result.status, result.stderr).toBe(0);
    const sitemap = readFileSync(join(output, "sitemap.xml"), "utf8");
    expect(sitemap).toContain("https://preview.example.test/privacy");
    expect(sitemap).not.toContain("/project/");
    expect(sitemap).not.toContain("/profiel/");
  });

  it("rejects an origin with credentials, a path or insecure remote HTTP", () => {
    for (const appOrigin of [
      "https://user:secret@example.test",
      "https://example.test/app",
      "http://example.test",
    ]) {
      const result = generate(outputDirectory(), { APP_ORIGIN: appOrigin });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("veilige origin zonder pad");
    }
  });
});
