import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("canonical product route configuration", () => {
  it("pins Node 22 and makes Vercel typecheck the exact production build", () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
      engines?: { node?: string };
    };
    const config = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as {
      installCommand?: string;
      buildCommand?: string;
    };

    expect(packageJson.engines?.node).toBe("22.x");
    expect(config.installCommand).toBe("bun install --frozen-lockfile");
    expect(config.buildCommand).toBe("bun run typecheck && bun run build");
  });

  it("documents open signup with commerce disabled for the MVP", () => {
    const environmentExample = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");

    expect(environmentExample).toMatch(/^BETA_MODE="false"/m);
    expect(environmentExample).toMatch(/^CHECKOUT_MODE="off"/m);
  });

  it("keeps every legacy public URL as a permanent redirect", () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as {
      redirects?: Array<{ source: string; destination: string; permanent?: boolean }>;
    };
    const redirects = new Map((config.redirects ?? []).map((redirect) => [redirect.source, redirect]));
    const expected = new Map([
      ["/trips/new", "/project/nieuw"],
      ["/trip/:id/photobook", "/project/:id/bouwboek"],
      ["/projecten/:id/bouwboek", "/project/:id/bouwboek"],
      ["/trip/:id/budget", "/project/:id/budget"],
      ["/trip/:id", "/project/:id"],
      ["/profile/:profileKey", "/profiel/:profileKey"],
      ["/favorieten", "/volgend"],
      ["/vrienden", "/connecties"],
    ]);

    for (const [source, destination] of expected) {
      expect(redirects.get(source), source).toMatchObject({ destination, permanent: true });
    }
  });

  it("routes public project documents through metadata rendering before the SPA catch-all", () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as {
      rewrites?: Array<{ source: string; destination: string }>;
    };

    expect(config.rewrites?.slice(0, 2)).toEqual([
      { source: "/project/:id", destination: "/api/page?__buildy_project_id=:id" },
      { source: "/api/:path*", destination: "/api/router?__buildy_api_path=:path*" },
    ]);
    expect(config.rewrites?.at(-1)).toEqual({ source: "/:path*", destination: "/index.html" });
  });

  it("keeps generic SEO provider-neutral without an invented price", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    const robots = readFileSync(resolve(process.cwd(), "public/robots.txt"), "utf8");
    const sitemap = readFileSync(resolve(process.cwd(), "public/sitemap.xml"), "utf8");
    const config = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as {
      headers?: Array<{ headers?: Array<{ key: string; value: string }> }>;
    };
    const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    expect(jsonLd).toBeDefined();
    expect(jsonLd).not.toContain('"price"');
    expect(`${html}\n${robots}\n${sitemap}`).not.toMatch(/https:\/\/(?:www\.)?buildy\.app/i);
    expect(sitemap).not.toContain("/ontdekken</loc>");

    const csp = config.headers
      ?.flatMap((entry) => entry.headers ?? [])
      .find((header) => header.key === "Content-Security-Policy")?.value;
    const digest = createHash("sha256").update(jsonLd ?? "").digest("base64");
    expect(csp).toContain(`'sha256-${digest}'`);
  });
});
