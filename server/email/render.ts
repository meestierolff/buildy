import { z } from "zod";

const textSchema = z.string().trim().min(1).max(2_000);
const urlSchema = z.string().url().refine((value) => new URL(value).protocol === "https:", {
  message: "E-maillinks moeten HTTPS gebruiken.",
});

export interface TransactionalEmailDocument {
  subject: string;
  previewText: string;
  heading: string;
  paragraphs: string[];
  facts?: Array<{ label: string; value: string }>;
  callToAction?: { label: string; url: string };
  closing?: string;
}

export interface RenderedTransactionalEmail {
  html: string;
  subject: string;
  text: string;
}

const documentSchema = z.object({
  subject: textSchema.max(160),
  previewText: textSchema.max(200),
  heading: textSchema.max(200),
  paragraphs: z.array(textSchema).min(1).max(12),
  facts: z.array(z.object({ label: textSchema.max(120), value: textSchema.max(500) }).strict()).max(30).optional(),
  callToAction: z.object({ label: textSchema.max(80), url: urlSchema }).strict().optional(),
  closing: textSchema.max(500).optional(),
}).strict();

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderTransactionalEmail(input: TransactionalEmailDocument): RenderedTransactionalEmail {
  const document = documentSchema.parse(input);
  const facts = document.facts?.map(({ label, value }) => `
    <tr>
      <th scope="row" style="padding:10px 0;border-bottom:1px solid #e3ded4;text-align:left;color:#5f625c;font-size:14px;font-weight:600;vertical-align:top">${escapeHtml(label)}</th>
      <td style="padding:10px 0 10px 24px;border-bottom:1px solid #e3ded4;text-align:right;color:#20231f;font-size:14px;vertical-align:top">${escapeHtml(value)}</td>
    </tr>`).join("") ?? "";
  const paragraphs = document.paragraphs
    .map((paragraph) => `<p style="margin:0 0 18px;color:#343832;font-size:16px;line-height:1.65">${escapeHtml(paragraph)}</p>`)
    .join("");
  const callToAction = document.callToAction
    ? `<p style="margin:28px 0"><a href="${escapeHtml(document.callToAction.url)}" style="display:inline-block;padding:14px 20px;background:#1e4a3a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;border-radius:4px">${escapeHtml(document.callToAction.label)}</a></p>`
    : "";
  const closing = document.closing
    ? `<p style="margin:26px 0 0;color:#5f625c;font-size:14px;line-height:1.6">${escapeHtml(document.closing)}</p>`
    : "";

  const html = `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(document.subject)}</title>
  <style>@media(max-width:620px){.shell{padding:18px!important}.paper{padding:28px 20px!important}.brand{font-size:20px!important}}</style>
</head>
<body style="margin:0;background:#f2efe8;color:#20231f;font-family:Inter,Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(document.previewText)}</div>
  <div class="shell" style="padding:32px 16px">
    <main class="paper" style="box-sizing:border-box;max-width:600px;margin:0 auto;padding:42px 44px;background:#fffdf8;border-top:5px solid #c9643e">
      <div class="brand" style="margin-bottom:34px;color:#1e4a3a;font-size:23px;font-weight:800;letter-spacing:-.02em">BUILDY</div>
      <h1 style="margin:0 0 22px;color:#20231f;font-family:Georgia,serif;font-size:32px;line-height:1.2;font-weight:700">${escapeHtml(document.heading)}</h1>
      ${paragraphs}
      ${facts ? `<table role="presentation" style="width:100%;margin:24px 0;border-collapse:collapse">${facts}</table>` : ""}
      ${callToAction}
      ${closing}
    </main>
    <footer style="max-width:600px;margin:18px auto 0;color:#777b74;font-size:12px;line-height:1.6;text-align:center">Buildy · Van eerste sleutel tot laatste plint.</footer>
  </div>
</body>
</html>`;

  const textFacts = document.facts?.map(({ label, value }) => `${label}: ${value}`).join("\n") ?? "";
  const text = [
    document.heading,
    "",
    ...document.paragraphs.flatMap((paragraph) => [paragraph, ""]),
    textFacts,
    textFacts ? "" : undefined,
    document.callToAction ? `${document.callToAction.label}: ${document.callToAction.url}` : undefined,
    document.callToAction ? "" : undefined,
    document.closing,
    "",
    "Buildy — Van eerste sleutel tot laatste plint.",
  ].filter((line): line is string => line !== undefined).join("\n");

  return { html, subject: document.subject, text };
}

const orderConfirmationSchema = z.object({
  orderNumber: textSchema.max(80),
  orderDate: textSchema.max(80),
  bookVariant: textSchema.max(160),
  pageCount: z.number().int().min(20).max(400),
  quantity: z.number().int().min(1).max(100),
  subtotal: textSchema.max(80),
  vatStatus: textSchema.max(160),
  shipping: textSchema.max(80),
  total: textSchema.max(80),
  currency: z.string().regex(/^[A-Z]{3}$/),
  deliveryEstimate: textSchema.max(160),
  shippingDestination: textSchema.max(500),
  sellerLegalIdentity: textSchema.max(300),
  sellerContact: textSchema.max(300),
  acceptedTermsVersion: textSchema.max(80),
  customizationNotice: textSchema.max(500),
  orderStatusUrl: urlSchema,
}).strict();

export type OrderConfirmationInput = z.infer<typeof orderConfirmationSchema>;

/** Builds the durable post-payment confirmation from persisted order facts. */
export function buildOrderConfirmationEmail(input: OrderConfirmationInput): RenderedTransactionalEmail {
  const order = orderConfirmationSchema.parse(input);
  return renderTransactionalEmail({
    subject: `Je Bouwboek-bestelling ${order.orderNumber} is bevestigd`,
    previewText: `Bestelling ${order.orderNumber} is betaald en wordt klaargemaakt voor productie.`,
    heading: "Je Bouwboek is besteld",
    paragraphs: [
      "Dank je wel. We hebben je betaling ontvangen en bewaren hieronder alle gegevens van je bestelling.",
      "Je printproof en bestelling zijn nu vergrendeld. In je orderstatus zie je iedere volgende stap van productie en verzending.",
    ],
    facts: [
      { label: "Ordernummer", value: order.orderNumber },
      { label: "Besteld op", value: order.orderDate },
      { label: "Boekvariant", value: order.bookVariant },
      { label: "Pagina’s", value: String(order.pageCount) },
      { label: "Aantal", value: String(order.quantity) },
      { label: "Bedrag", value: order.subtotal },
      { label: "Btw", value: order.vatStatus },
      { label: "Verzending", value: order.shipping },
      { label: "Totaal", value: `${order.total} ${order.currency}` },
      { label: "Verwachte levering", value: order.deliveryEstimate },
      { label: "Verzendbestemming", value: order.shippingDestination },
      { label: "Verkoper", value: order.sellerLegalIdentity },
      { label: "Contact", value: order.sellerContact },
      { label: "Voorwaarden", value: order.acceptedTermsVersion },
      { label: "Maatwerk", value: order.customizationNotice },
    ],
    callToAction: { label: "Bekijk je orderstatus", url: order.orderStatusUrl },
    closing: "Heb je een vraag over deze bestelling? Reageer niet met privégegevens, maar gebruik de contactgegevens hierboven en vermeld alleen je ordernummer.",
  });
}
