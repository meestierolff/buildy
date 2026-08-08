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
      SITEMAP_SOURCE_TOKEN: "",
      SITEMAP_SOURCE_URL: "",
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
    expect(sitemap).toContain("https://buildy.invalid/ontdekken");
    expect(sitemap).not.toContain("/projecten</loc>");
    expect(sitemap).not.toContain("/notificaties</loc>");
    expect(robots).toContain("Disallow: /notificaties");
    expect(robots).toContain("Disallow: /update/nieuw");
    expect(robots).not.toContain("/meldingen");
  });

  it("publishes projects by validated UUID and profiles by validated slug", () => {
    const output = outputDirectory();
    const projectId = "11111111-1111-4111-8111-111111111111";
    const source = encodeURIComponent(JSON.stringify({
      projects: [
        { id: projectId, slug: "must-not-be-used", updatedAt: "2026-08-03T10:00:00.000Z" },
        { id: "not-a-uuid", slug: "unsafe-project" },
      ],
      profiles: [
        { slug: "noor-bouwt", updatedAt: "2026-08-04T10:00:00.000Z" },
        { slug: "../private" },
      ],
    }));
    const result = generate(output, {
      APP_ORIGIN: "https://preview.example.test",
      SITEMAP_SOURCE_URL: `data:application/json,${source}`,
    });

    expect(result.status, result.stderr).toBe(0);
    const sitemap = readFileSync(join(output, "sitemap.xml"), "utf8");
    expect(sitemap).toContain(`https://preview.example.test/project/${projectId}`);
    expect(sitemap).toContain("https://preview.example.test/profiel/noor-bouwt");
    expect(sitemap).not.toContain("must-not-be-used");
    expect(sitemap).not.toContain("unsafe-project");
    expect(sitemap).not.toContain("../private");
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
