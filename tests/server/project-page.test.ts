import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  createProjectPageHandler,
  renderProjectPageHtml,
} from "../../server/pages/projectPage";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ASSET_ID = "22222222-2222-4222-8222-222222222222";
const SHELL = `<!doctype html><html lang="nl"><head>
  <title>Generic</title>
  <meta name="description" content="generic">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="https://old.invalid/">
  <meta property="og:title" content="Generic">
  <meta property="og:url" content="https://old.invalid/">
  <meta name="twitter:title" content="Generic">
  <script type="module" src="/assets/app-safe.js"></script>
</head><body><div id="root"></div></body></html>`;

describe("server-generated public project metadata", () => {
  it("renders one escaped public metadata set and preserves the built SPA shell", async () => {
    const reader = vi.fn().mockResolvedValue({
      id: PROJECT_ID,
      title: `Keuken "<script>alert('x')</script>`,
      description: "Een openbare keukenrenovatie.",
      ownerDisplayName: "Noor & Ada",
      coverAssetId: ASSET_ID,
    });
    const handler = createProjectPageHandler({
      appOrigin: "https://preview.buildy.invalid",
      loadSpaShell: async () => SHELL,
      readAnonymousPublicProject: reader,
    });
    const response = await handler(new Request(
      `https://deployment.invalid/api/page?__buildy_project_id=${PROJECT_ID}&update=nieuw`,
      {
        headers: {
          authorization: "Bearer never-forward",
          cookie: "session=never-forward",
          "user-agent": "LinkPreview/1.0",
        },
      },
    ));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("index, follow");
    expect(reader).toHaveBeenCalledWith(PROJECT_ID);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(html).toContain("/assets/app-safe.js");
    expect(html).toContain("Keuken &quot;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; — Buildy");
    expect(html).not.toContain("<script>alert('x')</script>");
    expect(html).toContain(`https://preview.buildy.invalid/project/${PROJECT_ID}`);
    expect(html).toContain(`https://preview.buildy.invalid/api/media/${ASSET_ID}`);
    expect(html).not.toContain("old.invalid");
    expect(html).not.toContain("never-forward");
    expect(html.match(/<meta\s+property="og:title"/g)).toHaveLength(1);
    expect(html.match(/<link\s+rel="canonical"/g)).toHaveLength(1);
  });

  it("serves the same generic noindex shell for private and missing projects", async () => {
    const handler = createProjectPageHandler({
      appOrigin: "https://preview.buildy.invalid",
      loadSpaShell: async () => SHELL,
      readAnonymousPublicProject: async () => null,
    });
    const response = await handler(new Request(
      `https://deployment.invalid/api/page?__buildy_project_id=${PROJECT_ID}`,
    ));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
    expect(html).toContain("Project — Buildy");
    expect(html).toContain("/assets/app-safe.js");
  });

  it("does not query the repository for invalid route parameters", async () => {
    const reader = vi.fn();
    const handler = createProjectPageHandler({
      appOrigin: "https://preview.buildy.invalid",
      loadSpaShell: async () => SHELL,
      readAnonymousPublicProject: reader,
    });
    const response = await handler(new Request(
      "https://deployment.invalid/api/page?__buildy_project_id=undefined",
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(reader).not.toHaveBeenCalled();
  });

  it("rejects unusable shells instead of returning a dead document", () => {
    expect(() => renderProjectPageHtml("<html><head></head><body></body></html>", {
      canonicalUrl: "https://preview.buildy.invalid/project/example",
      description: "Generic",
      imageAlt: "Generic",
      imageUrl: "https://preview.buildy.invalid/social-preview.svg",
      indexable: false,
      title: "Project — Buildy",
      type: "website",
    })).toThrow("SPA-shell");
  });

  it("returns a generic 503 when the built SPA shell is unusable", async () => {
    const handler = createProjectPageHandler({
      appOrigin: "https://preview.buildy.invalid",
      loadSpaShell: async () => "<html><head></head><body></body></html>",
      readAnonymousPublicProject: async () => null,
    });
    const response = await handler(new Request(
      `https://deployment.invalid/api/page?__buildy_project_id=${PROJECT_ID}`,
    ));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    await expect(response.text()).resolves.not.toContain(PROJECT_ID);
  });

  it("keeps the Vercel project rewrite ahead of the SPA catch-all", () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as {
      rewrites: Array<{ source: string; destination: string }>;
      functions: Record<string, { includeFiles?: string }>;
    };
    expect(config.rewrites[0]).toEqual({
      source: "/project/:id",
      destination: "/api/page?__buildy_project_id=:id",
    });
    expect(config.functions["api/page.ts"]?.includeFiles).toBe("dist/index.html");
  });
});
