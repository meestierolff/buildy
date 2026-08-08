#!/usr/bin/env bun
import {
  createPeechoProvider,
  optionalPositiveInteger,
  parseCliArguments,
  runCli,
  writeJson,
} from "./_shared";

await runCli(async () => {
  const arguments_ = parseCliArguments(process.argv.slice(2), {
    options: ["offering-id", "country", "currency", "pages", "quantity"],
  });
  const provider = createPeechoProvider();
  const currency = arguments_.options.currency ?? "EUR";
  const offerings = await provider.getOfferings({
    ...(arguments_.options.country ? { countryCode: arguments_.options.country } : {}),
    currency,
  });
  if (offerings.length === 0) throw new Error("Account gaf geen actieve offerings terug.");
  const offeringId = arguments_.options["offering-id"] ?? offerings[0]?.id;
  if (!offeringId) throw new Error("Geen offering beschikbaar voor productspecificatie.");
  const specification = await provider.getProductSpecification({
    offeringId,
    ...(arguments_.options.country ? { countryCode: arguments_.options.country } : {}),
    currency,
  });
  const pageCount = optionalPositiveInteger(arguments_, "pages");
  const quantity = optionalPositiveInteger(arguments_, "quantity", 1) ?? 1;
  const quote = arguments_.options.country
    ? await provider.getQuote({
        countryCode: arguments_.options.country,
        currency,
        items: [{
          offeringId,
          ...(pageCount === undefined ? {} : { pageCount }),
          quantity,
        }],
      })
    : null;

  writeJson({
    mode: "read-only",
    mutationPerformed: false,
    environment: provider.environment,
    offeringCount: offerings.length,
    specification,
    quote,
  });
});
