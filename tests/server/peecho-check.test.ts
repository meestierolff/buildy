// @vitest-environment node
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { checkPeecho } from "../../scripts/setup/peecho-check";

// Synthetic fixtures, never account offerings or evidence of Peecho access.
const merchantApiKey = "synthetic-merchant-secret";
const offering = {
  id: 901,
  name: "Synthetic hardcover",
  paperType: "Matte",
  catalogueItemCode: "synthetic-book",
  minimumQuantity: 1,
  minNumberOfPages: 24,
  maxNumberOfPages: 400,
  dimensionWidth: 297,
  dimensionHeight: 210,
  dynamicSize: false,
};
const catalog = { BO: { HC: [offering] } };
const quote = (pages: number) => ({
  quoteDetails: { countryCode: "NL", currency: "EUR" },
  quotedItems: [{
    offeringId: offering.id, numberOfPages: pages, quantity: 1,
    basePrice: 10, pricePerPage: 0.1, productPrice: 12.4,
    shippingWholesale: 3, totalQuantityDiscount: 0,
    vatPercentage: 0, vat: 0, totalItemPrice: 15.4,
  }],
  quoteSummary: {
    numberOfItems: 1, totalWholesalePrice: 15.4,
    totalShippingPrice: 3, totalQuantityDiscount: 0,
    vatSummary: [{ vatPercentage: 0, vat: 0 }],
  },
});
const input = { environment: "test" as const, merchantApiKey, productId: offering.id, pages: [24, 40, 80] };

function respondingWith(body: unknown) {
  return vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(catalog))
    .mockImplementation(async () => Response.json(body));
}

describe("read-only Peecho v3 connectivity", () => {
  it("reads one actual selected offering and separately quotes three exact page counts", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(catalog));
    for (const pages of input.pages) fetcher.mockResolvedValueOnce(Response.json(quote(pages)));
    const result = await checkPeecho(input, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(4);
    const [productsUrl, productInit] = fetcher.mock.calls[0];
    const url = new URL(String(productsUrl));
    expect(url.origin).toBe("https://test.www.peecho.com");
    expect(url.pathname).toBe("/rest/v3/offering/list");
    expect(url.searchParams.get("merchantApiKey")).toBe(merchantApiKey);
    expect(url.searchParams.get("countryIsoCode2")).toBe("NL");
    expect(productInit?.method).toBe("GET");
    for (const [index, [quoteUrl, init]] of fetcher.mock.calls.slice(1).entries()) {
      expect(String(quoteUrl)).toBe("https://test.www.peecho.com/rest/v3/quote");
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("error");
      expect(JSON.parse(String(init?.body))).toEqual({
        apiKey: merchantApiKey, countryCode: "NL", currency: "EUR",
        items: [{ offeringId: offering.id, numberOfPages: input.pages[index], quantity: 1 }],
      });
    }
    expect(result.quotes.map((item) => item.quotedItems[0].numberOfPages)).toEqual(input.pages);
    expect(result.priceBasis).toContain("unconfirmed");
    expect(result.productionCostsValidated).toBe(false);
    expect(JSON.stringify(result)).not.toContain(merchantApiKey);
  });

  it("keeps live product discovery separate and creates no quote without page counts", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(catalog));
    const result = await checkPeecho({ environment: "live", merchantApiKey }, fetcher);
    expect(new URL(String(fetcher.mock.calls[0][0])).origin).toBe("https://www.peecho.com");
    expect(result.quotes).toEqual([]);
    expect(result.products).toEqual([offering]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { field: "numberOfPages", value: 26 },
    { field: "offeringId", value: 902 },
    { field: "quantity", value: 2 },
  ])("rejects provider changes to $field", async ({ field, value }) => {
    const body = quote(24);
    Object.assign(body.quotedItems[0], { [field]: value });
    await expect(checkPeecho(input, respondingWith(body))).rejects.toThrow(/PEECHO_QUOTE_/);
  });

  it.each(["countryCode", "currency"])("rejects a quote with the wrong %s", async (field) => {
    const body = quote(24);
    Object.assign(body.quoteDetails, { [field]: "XX" });
    await expect(checkPeecho(input, respondingWith(body))).rejects.toThrow("PEECHO_QUOTE_RESPONSE_INVALID");
  });

  it.each([[22, 40, 80], [25, 40, 80], [24, 40, 402]])(
    "refuses invalid page counts before any quote request (%s, %s, %s)",
    async (...pages) => {
      const fetcher = respondingWith(quote(24));
      await expect(checkPeecho({ ...input, pages }, fetcher)).rejects.toThrow("PEECHO_PAGE_COUNT_OUT_OF_RANGE");
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("refuses absent or different-account product IDs before quoting", async () => {
    const fetcher = respondingWith(quote(24));
    await expect(checkPeecho({ ...input, productId: 902 }, fetcher)).rejects.toThrow("PEECHO_SELECTED_PRODUCT_UNAVAILABLE");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(checkPeecho({ ...input, productId: undefined }, fetcher)).rejects.toThrow("PEECHO_THREE_DISTINCT_PAGE_COUNTS_AND_PRODUCT_REQUIRED");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("redacts provider errors, transport errors and echoed credentials", async () => {
    const httpError = vi.fn<typeof fetch>().mockResolvedValue(new Response(merchantApiKey, { status: 403 }));
    await expect(checkPeecho(input, httpError)).rejects.toThrow(/^PEECHO_HTTP_403$/);
    const transportError = vi.fn<typeof fetch>().mockRejectedValue(new Error(`request URL contains ${merchantApiKey}`));
    await expect(checkPeecho(input, transportError)).rejects.toThrow(/^PEECHO_CONNECTION_OR_RESPONSE_FAILED$/);
    const echo = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ BO: { HC: [{ ...offering, name: merchantApiKey }] } }));
    await expect(checkPeecho({ environment: "test", merchantApiKey }, echo)).rejects.toThrow(/^PEECHO_RESPONSE_CONTAINS_CREDENTIAL$/);
  });

  it("caps response bodies and rejects malformed JSON without echoing it", async () => {
    const large = vi.fn<typeof fetch>().mockResolvedValue(new Response("a".repeat(2 * 1024 * 1024 + 1)));
    await expect(checkPeecho(input, large)).rejects.toThrow("PEECHO_RESPONSE_TOO_LARGE");
    const invalid = vi.fn<typeof fetch>().mockResolvedValue(new Response(merchantApiKey));
    await expect(checkPeecho(input, invalid)).rejects.toThrow(/^PEECHO_CONNECTION_OR_RESPONSE_FAILED$/);
  });

  it("reports missing company details without echoing the provider's request or message", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      custom_code: "APP_NO_COMP_DETAILS", url: `https://example.invalid/?key=${merchantApiKey}`,
      details: merchantApiKey,
    }, { status: 404 }));
    await expect(checkPeecho(input, fetcher)).rejects.toThrow(/^PEECHO_HTTP_404_APP_NO_COMP_DETAILS$/);
  });

  it.each(['synthetic-key-with-"quote', "synthetic-key-with-\\slash"])(
    "also redacts JSON-escaped credentials echoed in product fields",
    async (key) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
        BO: { HC: [{ ...offering, name: `prefix ${key} suffix` }] },
      }));
      await expect(checkPeecho({ environment: "test", merchantApiKey: key }, fetcher))
        .rejects.toThrow(/^PEECHO_RESPONSE_CONTAINS_CREDENTIAL$/);
    },
  );

  it("fails the CLI early without a key and never accepts secret arguments", () => {
    const env = { ...process.env, PEECHO_ENVIRONMENT: "test", PEECHO_MERCHANT_API_KEY: "" };
    const run = (args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/setup/peecho.ts", ...args], {
      cwd: process.cwd(), encoding: "utf8", env, timeout: 10_000,
    });
    const missing = run(["--products"]);
    expect(missing.status).toBe(1);
    expect(missing.stderr.trim()).toBe("PEECHO_MERCHANT_API_KEY_MISSING");
    const invalid = run([`--key=${merchantApiKey}`]);
    expect(invalid.status).toBe(2);
    expect(invalid.stdout + invalid.stderr).not.toContain(merchantApiKey);
  });
});
