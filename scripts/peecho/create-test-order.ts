#!/usr/bin/env bun
import { createHash } from "node:crypto";

import { createPrintOrderInputSchema } from "../../server/print/printProvider";
import {
  createPeechoProvider,
  parseCliArguments,
  readJsonInput,
  requireOption,
  requireSandboxMutation,
  runCli,
  writeJson,
} from "./_shared";

await runCli(async () => {
  const arguments_ = parseCliArguments(process.argv.slice(2), {
    options: ["input"],
    flags: ["confirm-sandbox-create", "pay", "confirm-sandbox-pay"],
  });
  const raw = await readJsonInput(requireOption(arguments_, "input"));
  const parsed = createPrintOrderInputSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Orderinput voldoet niet aan het provider-neutrale printcontract.");
  if (arguments_.flags.has("confirm-sandbox-pay") && !arguments_.flags.has("pay")) {
    throw new Error("--confirm-sandbox-pay is alleen geldig samen met --pay.");
  }
  const provider = createPeechoProvider();
  const safeSummary = {
    environment: provider.environment,
    idempotencyFingerprint: createHash("sha256")
      .update(parsed.data.idempotencyKey)
      .digest("hex")
      .slice(0, 16),
    currency: parsed.data.currency,
    destinationCountry: parsed.data.shippingAddress.countryCode,
    itemCount: parsed.data.items.length,
    items: parsed.data.items.map((item) => ({
      offeringId: item.offeringId,
      quantity: item.quantity,
      fileAttached: Boolean(item.file),
      pageCount: item.file?.pageCount ?? null,
    })),
  };

  if (!arguments_.flags.has("confirm-sandbox-create")) {
    writeJson({
      mode: "dry-run",
      mutationPerformed: false,
      ...safeSummary,
      requiredFlag: "--confirm-sandbox-create",
    });
    return;
  }

  requireSandboxMutation(provider.environment, arguments_, "create");
  if (arguments_.flags.has("pay")) {
    // Validate every requested mutation before the first write. This prevents
    // leaving an unintended OPEN sandbox order when payment confirmation is missing.
    requireSandboxMutation(provider.environment, arguments_, "pay");
  }
  const created = await provider.createOrder(parsed.data);
  // Print the provider ID before an optional payment call so an operator can
  // reconcile a later payment failure without ever creating a second order.
  writeJson({ phase: "created", ...safeSummary, order: created });

  if (!arguments_.flags.has("pay")) return;
  const payment = await provider.payOrder({ providerOrderId: created.providerOrderId });
  writeJson({ phase: "paid", order: payment });
});
