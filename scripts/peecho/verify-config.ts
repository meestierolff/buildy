#!/usr/bin/env bun
import { PEECHO_V3_BASE_URLS } from "../../server/print/peechoV3Provider";
import {
  createPeechoProvider,
  parseCliArguments,
  readPeechoEnvironment,
  runCli,
  writeJson,
} from "./_shared";

await runCli(async () => {
  const arguments_ = parseCliArguments(process.argv.slice(2), {
    flags: ["offline", "require-secret"],
  });
  const environment = readPeechoEnvironment();
  const provider = createPeechoProvider();
  const secretConfigured = Boolean(process.env.PEECHO_SECRET_KEY);
  if (arguments_.flags.has("require-secret") && !secretConfigured) {
    throw new Error("PEECHO_SECRET_KEY ontbreekt terwijl --require-secret is gevraagd.");
  }
  const offerings = arguments_.flags.has("offline") ? null : await provider.getOfferings();
  writeJson({
    provider: provider.provider,
    environment,
    baseUrl: PEECHO_V3_BASE_URLS[environment],
    merchantApiKeyConfigured: true,
    secretConfigured,
    remoteReadVerified: offerings !== null,
    offeringCount: offerings?.length ?? null,
    dashboardChecksStillRequired: [
      "company-details",
      "credits-or-invoicing",
      "webhook-url",
      "account-specific-offering-approval",
    ],
  });
});
