const PEECHO_SCRIPT_BASE_URL = "https://d3aln0nj58oevo.cloudfront.net/button/script";
const PEECHO_MIN_PDF_BYTES = 1_000;

type PeechoClientEnv = {
  VITE_PEECHO_SCRIPT_URL?: string;
  VITE_PEECHO_BUTTON_KEY?: string;
};

export const getPeechoScriptUrl = (env: PeechoClientEnv = import.meta.env) => {
  const explicitUrl = env.VITE_PEECHO_SCRIPT_URL?.trim();
  if (explicitUrl) return explicitUrl;

  const buttonKey = env.VITE_PEECHO_BUTTON_KEY?.trim();
  if (!buttonKey) return "";
  if (buttonKey.startsWith("http://") || buttonKey.startsWith("https://")) return buttonKey;

  return `${PEECHO_SCRIPT_BASE_URL}/${buttonKey}.js`;
};

export const createPeechoReference = (tripId: string) => {
  const timestamp = Date.now().toString(36);
  const nonce = crypto.randomUUID().slice(0, 8);
  return `buildy-${tripId}-${timestamp}-${nonce}`;
};

export const assertPeechoPdfReachable = async (
  url: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 10_000,
) => {
  const fetchWithTimeout = async (init: RequestInit) => {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetcher(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("De PDF-check duurde te lang. Probeer het boek opnieuw klaar te maken.");
      }
      throw error;
    } finally {
      globalThis.clearTimeout(timer);
    }
  };

  let response = await fetchWithTimeout({ method: "HEAD", cache: "no-store" });
  if (response.status === 405 || response.status === 501) {
    response = await fetchWithTimeout({
      method: "GET",
      cache: "no-store",
      headers: { Range: "bytes=0-0" },
    });
  }

  if (!response.ok) {
    throw new Error("De PDF is niet publiek bereikbaar voor Peecho.");
  }

  const contentRangeTotal = response.headers.get("content-range")?.match(/\/(\d+)$/)?.[1];
  const contentLength = Number(contentRangeTotal ?? response.headers.get("content-length") ?? 0);
  if (contentLength > 0 && contentLength < PEECHO_MIN_PDF_BYTES) {
    throw new Error("De PDF lijkt onvolledig. Probeer het boek opnieuw klaar te maken.");
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType && !contentType.includes("pdf") && !contentType.includes("octet-stream")) {
    throw new Error("De geüploade Bouwboek-PDF heeft een onverwacht bestandstype.");
  }
};
