import { z } from "zod";

// Read-only v3 contracts: https://www.peecho.com/print-api-documentation
// This probe does not approve consumer prices or create/pay for orders.
const bases = {
  test: "https://test.www.peecho.com/rest/v3/",
  live: "https://www.peecho.com/rest/v3/",
} as const;
const integer = z.number().int().nonnegative().safe();
const amount = z.number().finite().nonnegative();
const offeringSchema = z.object({
  id: integer.positive(),
  name: z.string().min(1).max(300),
  paperType: z.string().max(300),
  catalogueItemCode: z.string().max(120),
  minimumQuantity: integer,
  minNumberOfPages: integer,
  maxNumberOfPages: integer,
  dimensionWidth: z.number().positive().finite(),
  dimensionHeight: z.number().positive().finite(),
  dynamicSize: z.boolean(),
  minDimensionWidth: z.number().positive().finite().optional(),
  minDimensionHeight: z.number().positive().finite().optional(),
});
const quoteSchema = z.object({
  quoteDetails: z.object({ countryCode: z.literal("NL"), currency: z.literal("EUR") }),
  quotedItems: z.array(z.object({
    offeringId: integer.positive(),
    numberOfPages: integer.positive(),
    quantity: z.literal(1),
    basePrice: amount,
    pricePerPage: amount,
    productPrice: amount,
    shippingWholesale: amount,
    totalQuantityDiscount: amount,
    vatPercentage: amount,
    vat: amount,
    totalItemPrice: amount,
  })).length(1),
  quoteSummary: z.object({
    numberOfItems: z.literal(1),
    totalWholesalePrice: amount,
    totalShippingPrice: amount,
    totalQuantityDiscount: amount,
    vatSummary: z.array(z.object({ vatPercentage: amount, vat: amount })).max(20),
  }),
});

export class PeechoCheckError extends Error {}

export interface PeechoCheckInput {
  environment: "test" | "live";
  merchantApiKey: string;
  productId?: number;
  pages?: number[];
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new PeechoCheckError("PEECHO_EMPTY_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw new PeechoCheckError("PEECHO_RESPONSE_TOO_LARGE");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function checkPeecho(
  input: PeechoCheckInput,
  fetcher: typeof fetch = fetch,
) {
  const parsed = z.object({
    environment: z.enum(["test", "live"]),
    merchantApiKey: z.string().trim().min(1).max(512),
    productId: integer.positive().optional(),
    pages: z.array(integer.positive().max(500)).length(3).optional(),
  }).safeParse(input);
  if (!parsed.success) throw new PeechoCheckError("PEECHO_CONFIGURATION_INVALID");
  const config = parsed.data;
  if (config.pages && (!config.productId || new Set(config.pages).size !== 3)) {
    throw new PeechoCheckError("PEECHO_THREE_DISTINCT_PAGE_COUNTS_AND_PRODUCT_REQUIRED");
  }

  async function request(endpoint: "offering/list" | "quote", pages?: number) {
    const url = new URL(endpoint, bases[config.environment]);
    const init: RequestInit = {
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: "application/json" },
      method: "GET",
    };
    if (endpoint === "offering/list") {
      // Peecho requires this credential in the query. Never log the URL.
      url.searchParams.set("merchantApiKey", config.merchantApiKey);
      url.searchParams.set("countryIsoCode2", "NL");
      url.searchParams.set("currency", "EUR");
    } else {
      init.method = "POST";
      init.headers = { ...init.headers, "Content-Type": "application/json" };
      init.body = JSON.stringify({
        apiKey: config.merchantApiKey,
        countryCode: "NL",
        currency: "EUR",
        items: [{ offeringId: config.productId, numberOfPages: pages, quantity: 1 }],
      });
    }
    try {
      const response = await fetcher(url, init);
      if (!response.ok) {
        // Provider error bodies can echo credentials, addresses and request URLs.
        // Only known machine codes are safe and useful to disclose.
        const error = z.object({ custom_code: z.enum([
          "APP_FORBIDDEN", "APP_NO_COMP_DETAILS", "INVALID_DATA", "CURR_INVALID",
          "NO_PF", "OFF_MIN", "OFF_NOT_FOUND", "MULTI_ORDER_INVALID_DATA",
        ]) }).safeParse(await readJson(response).catch(() => null));
        throw new PeechoCheckError(
          `PEECHO_HTTP_${response.status}${error.success ? `_${error.data.custom_code}` : ""}`,
        );
      }
      return await readJson(response);
    } catch (error) {
      if (error instanceof PeechoCheckError) throw error;
      throw new PeechoCheckError("PEECHO_CONNECTION_OR_RESPONSE_FAILED");
    }
  }

  const catalog = z.object({ BO: z.object({ HC: z.array(offeringSchema) }) })
    .safeParse(await request("offering/list"));
  if (!catalog.success) throw new PeechoCheckError("PEECHO_HARDCOVER_CATALOG_UNAVAILABLE");
  const hardcover = catalog.data.BO.HC.filter((item) => item.minimumQuantity <= 1);
  if (hardcover.length === 0) throw new PeechoCheckError("PEECHO_SINGLE_COPY_HARDCOVER_UNAVAILABLE");
  const selected = config.productId
    ? hardcover.find((item) => item.id === config.productId)
    : undefined;
  if (config.productId && !selected) throw new PeechoCheckError("PEECHO_SELECTED_PRODUCT_UNAVAILABLE");
  if (selected && config.pages?.some((pages) =>
    pages % 2 !== 0 || pages < Math.max(24, selected.minNumberOfPages)
    || pages > selected.maxNumberOfPages
  )) throw new PeechoCheckError("PEECHO_PAGE_COUNT_OUT_OF_RANGE");

  const quotes = [];
  for (const pages of config.pages ?? []) {
    const quoted = quoteSchema.safeParse(await request("quote", pages));
    if (!quoted.success) throw new PeechoCheckError("PEECHO_QUOTE_RESPONSE_INVALID");
    const item = quoted.data.quotedItems[0];
    if (item.offeringId !== config.productId || item.numberOfPages !== pages) {
      throw new PeechoCheckError("PEECHO_QUOTE_CHANGED_REQUEST");
    }
    quotes.push({ receivedAt: new Date().toISOString(), ...quoted.data });
  }
  const result = {
    environment: config.environment,
    credentialPresent: true,
    authenticatedProductRead: true,
    destination: "NL",
    currency: "EUR",
    quantity: 1,
    products: selected ? [selected] : hardcover,
    quotes,
    // The reference does not establish quote money units or nonzero VAT
    // inclusion. Preserve raw amounts; do not calculate a consumer price.
    priceBasis: "raw_provider_amounts_units_and_tax_basis_unconfirmed",
    productionCostsValidated: false,
    printCompatibility: "not_verified",
    checkedAt: new Date().toISOString(),
  };
  const serializedKey = JSON.stringify(config.merchantApiKey).slice(1, -1);
  if (JSON.stringify(result).includes(serializedKey)) {
    throw new PeechoCheckError("PEECHO_RESPONSE_CONTAINS_CREDENTIAL");
  }
  return result;
}
