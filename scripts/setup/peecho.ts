#!/usr/bin/env node
import { checkPeecho, PeechoCheckError } from "./peecho-check.js";

// Load credentials through the process environment / node --env-file, never
// command-line arguments. No write/order/payment endpoints exist in this probe.
const args = process.argv.slice(2);
const productsOnly = args.length === 1 && args[0] === "--products";
const pageArgument = args.length === 1 ? /^--pages=(\d+,\d+,\d+)$/.exec(args[0]) : null;
if (!productsOnly && !pageArgument) {
  process.stderr.write("Gebruik: node --import tsx scripts/setup/peecho.ts --products|--pages=24,40,80\n");
  process.exit(2);
}
try {
  const environment = process.env.PEECHO_ENVIRONMENT;
  if (environment !== "test" && environment !== "live") {
    throw new PeechoCheckError("PEECHO_ENVIRONMENT_REQUIRED_TEST_OR_LIVE");
  }
  const merchantApiKey = process.env.PEECHO_MERCHANT_API_KEY;
  if (!merchantApiKey?.trim()) throw new PeechoCheckError("PEECHO_MERCHANT_API_KEY_MISSING");
  const productId = process.env.PEECHO_PRODUCT_ID;
  const result = await checkPeecho({
    environment,
    merchantApiKey,
    productId: productId ? (/^\d+$/.test(productId) ? Number(productId) : NaN) : undefined,
    pages: pageArgument?.[1].split(",").map(Number),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof PeechoCheckError ? error.message : "PEECHO_CHECK_FAILED"}\n`);
  process.exitCode = 1;
}
