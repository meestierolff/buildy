import { describe, expect, it } from "vitest";
import { assertPeechoPdfBlob, assertPeechoPdfReachable, createPeechoReference, getPeechoScriptUrl } from "@/lib/peecho";
import { getPeechoPrintPageCount, PEECHO_MIN_PAGES } from "@/lib/peechoExport";

describe("Peecho helpers", () => {
  it("pads print page counts to Peecho's minimum and an even number", () => {
    expect(getPeechoPrintPageCount(1)).toBe(PEECHO_MIN_PAGES);
    expect(getPeechoPrintPageCount(23)).toBe(PEECHO_MIN_PAGES);
    expect(getPeechoPrintPageCount(24)).toBe(24);
    expect(getPeechoPrintPageCount(25)).toBe(26);
    expect(getPeechoPrintPageCount(40)).toBe(40);
    expect(getPeechoPrintPageCount(Number.NaN)).toBe(PEECHO_MIN_PAGES);
    expect(getPeechoPrintPageCount(-4)).toBe(PEECHO_MIN_PAGES);
  });

  it("derives the Print Button script URL from a button key", () => {
    expect(getPeechoScriptUrl({ VITE_PEECHO_BUTTON_KEY: "123456789" })).toBe(
      "https://d3aln0nj58oevo.cloudfront.net/button/script/123456789.js",
    );
  });

  it("prefers an explicit Print Button script URL", () => {
    expect(getPeechoScriptUrl({
      VITE_PEECHO_BUTTON_KEY: "123456789",
      VITE_PEECHO_SCRIPT_URL: "https://cdn.example.test/peecho.js",
    })).toBe("https://cdn.example.test/peecho.js");
  });

  it("creates unique merchant references tied to the trip", () => {
    const first = createPeechoReference("trip-123");
    const second = createPeechoReference("trip-123");

    expect(first).toMatch(/^buildy-trip-123-[a-z0-9]+-[a-f0-9]{8}$/);
    expect(second).toMatch(/^buildy-trip-123-[a-z0-9]+-[a-f0-9]{8}$/);
    expect(first).not.toBe(second);
  });

  it("accepts reachable PDF URLs for Peecho", async () => {
    const fetcher = async () => new Response(null, {
      status: 200,
      headers: {
        "content-length": "25000",
        "content-type": "application/pdf",
      },
    });

    await expect(assertPeechoPdfReachable("https://example.test/book.pdf", fetcher as typeof fetch)).resolves.toBeUndefined();
  });

  it("rejects inaccessible PDF URLs before checkout", async () => {
    const fetcher = async () => new Response(null, { status: 403 });

    await expect(assertPeechoPdfReachable("https://example.test/private.pdf", fetcher as typeof fetch)).rejects.toThrow(
      /niet publiek bereikbaar/i,
    );
  });

  it("falls back to ranged GET when HEAD is unavailable", async () => {
    const calls: string[] = [];
    const fetcher = async (_url: string, init?: RequestInit) => {
      calls.push(init?.method ?? "GET");
      if (init?.method === "HEAD") return new Response(null, { status: 405 });
      return new Response(null, {
        status: 206,
        headers: {
          "content-range": "bytes 0-0/25000",
          "content-type": "application/pdf",
        },
      });
    };

    await expect(assertPeechoPdfReachable("https://example.test/book.pdf", fetcher as typeof fetch)).resolves.toBeUndefined();
    expect(calls).toEqual(["HEAD", "GET"]);
  });

  it("times out slow PDF reachability checks", async () => {
    const fetcher = async (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });

    await expect(assertPeechoPdfReachable("https://example.test/slow.pdf", fetcher as typeof fetch, 1)).rejects.toThrow(
      /duurde te lang/i,
    );
  });

  it("validates PDF magic bytes, trailer and size before upload", async () => {
    const padding = "x".repeat(1_100);
    const blob = new Blob([`%PDF-1.7\n${padding}\n%%EOF`], { type: "application/pdf" });
    await expect(assertPeechoPdfBlob(blob)).resolves.toBeUndefined();
  });

  it("rejects truncated or non-PDF blobs before upload", async () => {
    const invalid = new Blob(["not-a-pdf".repeat(200)], { type: "application/pdf" });
    await expect(assertPeechoPdfBlob(invalid)).rejects.toThrow(/beschadigd/i);
  });
});
