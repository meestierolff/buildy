#!/usr/bin/env bun
import { inspectPdf, validatePdfForOffering } from "./_pdf";
import {
  createPeechoProvider,
  parseCliArguments,
  requireOption,
  runCli,
  writeJson,
} from "./_shared";

await runCli(async () => {
  const arguments_ = parseCliArguments(process.argv.slice(2), {
    options: ["file", "offering-id", "country", "currency", "tolerance-mm"],
    flags: ["allow-odd-pages"],
  });
  const pdf = await inspectPdf(requireOption(arguments_, "file"));
  const offeringId = arguments_.options["offering-id"];
  if (!offeringId) {
    writeJson({
      pdf,
      offeringValidated: false,
      limitations: [
        "RGB-colour-profile-not-proven",
        "font-embedding-not-proven",
        "effective-image-dpi-not-proven",
      ],
    });
    return;
  }

  const toleranceRaw = arguments_.options["tolerance-mm"] ?? "1";
  const tolerance = Number(toleranceRaw.replace(",", "."));
  const provider = createPeechoProvider();
  const offering = await provider.getProductSpecification({
    offeringId,
    ...(arguments_.options.country ? { countryCode: arguments_.options.country } : {}),
    ...(arguments_.options.currency ? { currency: arguments_.options.currency } : {}),
  });
  validatePdfForOffering({
    pdf,
    offering,
    requireEvenPages: !arguments_.flags.has("allow-odd-pages"),
    dimensionToleranceMm: tolerance,
  });
  writeJson({
    pdf,
    offeringValidated: true,
    offering: {
      id: offering.id,
      name: offering.name,
      minimumPageCount: offering.minimumPageCount,
      maximumPageCount: offering.maximumPageCount,
      widthMm: offering.widthMm,
      heightMm: offering.heightMm,
      dynamicSize: offering.dynamicSize,
    },
    limitations: [
      "RGB-colour-profile-not-proven",
      "font-embedding-not-proven",
      "effective-image-dpi-not-proven",
    ],
  });
});
