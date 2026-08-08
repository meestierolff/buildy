#!/usr/bin/env bun
import {
  createPeechoProvider,
  parseCliArguments,
  runCli,
  writeJson,
} from "./_shared";

await runCli(async () => {
  const arguments_ = parseCliArguments(process.argv.slice(2), {
    options: ["country", "currency", "category", "subcategory"],
  });
  const provider = createPeechoProvider();
  const offerings = await provider.getOfferings({
    ...(arguments_.options.country ? { countryCode: arguments_.options.country } : {}),
    ...(arguments_.options.currency ? { currency: arguments_.options.currency } : {}),
    ...(arguments_.options.category ? { categoryCode: arguments_.options.category } : {}),
    ...(arguments_.options.subcategory ? { subcategoryCode: arguments_.options.subcategory } : {}),
  });
  writeJson({
    environment: provider.environment,
    count: offerings.length,
    offerings,
  });
});
