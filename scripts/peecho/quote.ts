#!/usr/bin/env bun
import {
  createPeechoProvider,
  optionalPositiveInteger,
  parseCliArguments,
  requireOption,
  runCli,
  writeJson,
} from "./_shared";

await runCli(async () => {
  const arguments_ = parseCliArguments(process.argv.slice(2), {
    options: ["offering-id", "pages", "quantity", "country", "state", "currency"],
  });
  const provider = createPeechoProvider();
  const pageCount = optionalPositiveInteger(arguments_, "pages");
  const quantity = optionalPositiveInteger(arguments_, "quantity", 1);
  const quote = await provider.getQuote({
    countryCode: requireOption(arguments_, "country"),
    currency: arguments_.options.currency ?? "EUR",
    ...(arguments_.options.state ? { state: arguments_.options.state } : {}),
    items: [{
      offeringId: requireOption(arguments_, "offering-id"),
      ...(pageCount === undefined ? {} : { pageCount }),
      quantity: quantity ?? 1,
    }],
  });
  writeJson({ environment: provider.environment, quote });
});
