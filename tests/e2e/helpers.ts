import {
  expect,
  test as base,
  type ConsoleMessage,
  type Page,
  type Request,
  type Response,
} from "@playwright/test";

/**
 * Shared constants and helpers for the Buildy Playwright regression suite.
 *
 * Data-dependent journeys install explicit same-origin fixtures; public smoke
 * journeys intentionally exercise the selected local or deployed base URL.
 */

export const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8090";

type BrowserDiagnostics = {
  messages: string[];
  dispose: () => void;
};

const diagnosticsByPage = new WeakMap<Page, BrowserDiagnostics>();

function networkTarget(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return rawUrl.split(/[?#]/, 1)[0] ?? "onbekende URL";
  }
}

function sanitizeDiagnosticText(value: string): string {
  return value.replace(/https?:\/\/[^\s)\]}'"]+/g, (rawUrl) => networkTarget(rawUrl));
}

/**
 * Installs one fail-closed browser diagnostic collector per page.
 *
 * Query strings and fragments are omitted from network diagnostics so test
 * output cannot accidentally retain tokens or other user-controlled values.
 * Read-only fetches cancelled by the client query lifecycle have no failed
 * server response and are excluded; every other failed resource and every 5xx
 * response remains a hard failure.
 */
export function installBrowserDiagnostics(page: Page): BrowserDiagnostics {
  const existing = diagnosticsByPage.get(page);
  if (existing) return existing;

  const messages: string[] = [];
  const seen = new Set<string>();
  const record = (message: string) => {
    if (seen.has(message)) return;
    seen.add(message);
    messages.push(message);
  };
  const onPageError = (error: Error) => record(`pageerror: ${sanitizeDiagnosticText(error.message)}`);
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() === "error") {
      record(`console: ${sanitizeDiagnosticText(message.text())}`);
    }
  };
  const onRequestFailed = (request: Request) => {
    const rawFailure = request.failure()?.errorText ?? "onbekende netwerkfout";
    const isClientCancelledRead = request.resourceType() === "fetch"
      && ["GET", "HEAD"].includes(request.method())
      && /(?:ERR_ABORTED|NS_BINDING_ABORTED|cancelled)/i.test(rawFailure);
    if (isClientCancelledRead) return;
    const failure = sanitizeDiagnosticText(rawFailure);
    record(`requestfailed: ${request.method()} ${networkTarget(request.url())} (${failure})`);
  };
  const onResponse = (response: Response) => {
    if (response.status() < 500) return;
    record(
      `http-${response.status()}: ${response.request().method()} ${networkTarget(response.url())}`,
    );
  };

  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  page.on("requestfailed", onRequestFailed);
  page.on("response", onResponse);

  const diagnostics = {
    messages,
    dispose: () => {
      page.off("pageerror", onPageError);
      page.off("console", onConsole);
      page.off("requestfailed", onRequestFailed);
      page.off("response", onResponse);
      diagnosticsByPage.delete(page);
    },
  };
  diagnosticsByPage.set(page, diagnostics);
  return diagnostics;
}

type BrowserHarnessFixtures = {
  browserDiagnostics: void;
};

/** Every test importing this shared test object gets fail-closed diagnostics. */
export const test = base.extend<BrowserHarnessFixtures>({
  browserDiagnostics: [async ({ page }, use, testInfo) => {
    const diagnostics = installBrowserDiagnostics(page);
    await use();
    diagnostics.dispose();

    if (diagnostics.messages.length === 0 || testInfo.status === "skipped") return;
    await testInfo.attach("unexpected-browser-diagnostics", {
      body: Buffer.from(`${JSON.stringify(diagnostics.messages, null, 2)}\n`, "utf8"),
      contentType: "application/json",
    });
    expect(diagnostics.messages, "onverwachte browser-, netwerk- of serverfouten").toEqual([]);
  }, { auto: true }],
});

export { expect };

/** Wait until every image inside photobook pages has loaded; timeout is a test failure. */
export const waitForPhotobookImages = async (page: Page) => {
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll("[data-photobook-page] img"))
      .every((img) => (img as HTMLImageElement).complete),
    undefined,
    { timeout: 5000 },
  );
};

/**
 * Collect diagnostics about visible images: how many render, how many are broken,
 * and how many overlap. Used by photobook layout tests to catch print regressions.
 */
export const collectImageDiagnostics = (page: Page) =>
  page.evaluate(() => {
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const imgs = Array.from(document.querySelectorAll("[data-photobook-page] img"))
      .map((img) => {
        const rect = img.getBoundingClientRect();
        const style = window.getComputedStyle(img);
        return {
          x: rect.x,
          y: rect.y,
          w: rect.width,
          h: rect.height,
          naturalWidth: (img as HTMLImageElement).naturalWidth,
          naturalHeight: (img as HTMLImageElement).naturalHeight,
          visible:
            style.visibility !== "hidden"
            && style.display !== "none"
            && rect.width > 20
            && rect.height > 20
            && rect.bottom > 0
            && rect.right > 0
            && rect.left < viewportW
            && rect.top < viewportH,
        };
      })
      .filter((img) => img.visible);

    let overlaps = 0;
    for (let i = 0; i < imgs.length; i += 1) {
      for (let j = i + 1; j < imgs.length; j += 1) {
        const a = imgs[i];
        const b = imgs[j];
        const overlapW = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
        const overlapH = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        if (overlapW * overlapH > 4) overlaps += 1;
      }
    }

    return {
      visibleImages: imgs.length,
      brokenImages: imgs.filter((img) => img.naturalWidth === 0 || img.naturalHeight === 0).length,
      overlaps,
    };
  });
