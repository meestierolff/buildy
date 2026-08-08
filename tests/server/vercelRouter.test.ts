import { describe, expect, it } from "vitest";
import { restoreRewrittenApiRequest } from "../../api/router";

describe("Vercel API rewrite", () => {
  it("restores the original API pathname and preserves ordinary query parameters", () => {
    const request = new Request(
      "https://buildy.example/api/router?__buildy_api_path=health&probe=1",
    );
    const restored = new URL(restoreRewrittenApiRequest(request).url);

    expect(restored.pathname).toBe("/api/health");
    expect(restored.searchParams.get("probe")).toBe("1");
    expect(restored.searchParams.has("__buildy_api_path")).toBe(false);
  });

  it.each(["../health", "health//nested", "health%5Csecret"])(
    "routes an unsafe rewritten path to a guaranteed miss: %s",
    (path) => {
      const request = new Request(`https://buildy.example/api/router?__buildy_api_path=${path}`);
      expect(new URL(restoreRewrittenApiRequest(request).url).pathname).toBe("/api/__invalid_rewrite");
    },
  );

  it("leaves local direct API requests untouched", () => {
    const request = new Request("http://127.0.0.1:8787/api/readiness");
    expect(restoreRewrittenApiRequest(request)).toBe(request);
  });
});
