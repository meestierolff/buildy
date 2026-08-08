import { describe, expect, it } from "vitest";
import {
  buildOrderConfirmationEmail,
  renderTransactionalEmail,
  type OrderConfirmationInput,
} from "../../server/email/render";

const order: OrderConfirmationInput = {
  orderNumber: "BLD-TEST-2026-0001",
  orderDate: "4 augustus 2026",
  bookVariant: "Bouwboek liggend, 30 × 21 cm, hardcover",
  pageCount: 64,
  quantity: 1,
  subtotal: "€ 78,50",
  vatStatus: "Inclusief 21% btw (€ 13,62)",
  shipping: "€ 6,95",
  total: "€ 85,45",
  currency: "EUR",
  deliveryEstimate: "12–18 augustus 2026",
  shippingDestination: "Teststraat 1, 1234 AB Testdam, Nederland (synthetisch)",
  sellerLegalIdentity: "Buildy Testverkoper B.V. (synthetisch), KvK TEST-000000",
  sellerContact: "support@example.test · +31 20 000 0000 (synthetisch)",
  acceptedTermsVersion: "voorwaarden-test-v1",
  customizationNotice: "Persoonlijk maatwerk op basis van de goedgekeurde printproof; herroeping kan beperkt zijn.",
  orderStatusUrl: "https://app.buildy.test/orders/10000000-0000-4000-8000-000000000001",
};

describe("transactional e-mail rendering", () => {
  it("renders every durable order-confirmation fact in HTML and plain text", () => {
    const rendered = buildOrderConfirmationEmail(order);

    for (const expected of [
      order.orderNumber,
      order.orderDate,
      order.bookVariant,
      String(order.pageCount),
      String(order.quantity),
      order.subtotal,
      order.vatStatus,
      order.shipping,
      `${order.total} ${order.currency}`,
      order.deliveryEstimate,
      order.shippingDestination,
      order.sellerLegalIdentity,
      order.sellerContact,
      order.acceptedTermsVersion,
      order.customizationNotice,
      order.orderStatusUrl,
    ]) {
      expect(rendered.text).toContain(expected);
      expect(rendered.html).toContain(expected.replaceAll("&", "&amp;"));
    }
    expect(rendered.html).toContain('<html lang="nl">');
    expect(rendered.html).toContain('name="viewport"');
    expect(rendered.text).not.toMatch(/<[^>]+>/);
  });

  it("escapes untrusted copy and rejects insecure action links", () => {
    const rendered = renderTransactionalEmail({
      subject: "Veilig bericht",
      previewText: "Een veilige preview",
      heading: "Hallo <script>alert(1)</script>",
      paragraphs: ["Dit is & blijft tekst."],
      callToAction: { label: "Open", url: "https://app.buildy.test/safe?one=1&two=2" },
    });

    expect(rendered.html).not.toContain("<script>alert(1)</script>");
    expect(rendered.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(rendered.html).toContain("one=1&amp;two=2");
    expect(() => renderTransactionalEmail({
      subject: "Onveilig",
      previewText: "Onveilig",
      heading: "Onveilig",
      paragraphs: ["Onveilig"],
      callToAction: { label: "Open", url: "http://app.buildy.test/token" },
    })).toThrow();
  });
});
