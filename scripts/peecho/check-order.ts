#!/usr/bin/env bun
import {
  createPeechoProvider,
  parseCliArguments,
  requireOption,
  runCli,
  writeJson,
} from "./_shared";

await runCli(async () => {
  const arguments_ = parseCliArguments(process.argv.slice(2), {
    options: ["order-id", "reference"],
  });
  const provider = createPeechoProvider();
  const order = await provider.getOrder({
    providerOrderId: requireOption(arguments_, "order-id"),
    ...(arguments_.options.reference ? { merchantReference: arguments_.options.reference } : {}),
  });
  writeJson({ environment: provider.environment, order });
});
