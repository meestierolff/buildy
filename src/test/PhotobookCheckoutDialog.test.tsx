import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PhotobookCheckoutDialog } from "@/components/photobook/PhotobookCheckoutDialog";

const REVISION_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const COMMAND_ID = "55555555-5555-4555-8555-555555555555";
const DOCUMENT_SHA = "a".repeat(64);
const PDF_SHA = "b".repeat(64);

const amounts = {
  currency: "EUR",
  subtotalMinor: 10_000,
  shippingMinor: 1_000,
  taxMinor: 2_310,
  totalMinor: 13_310,
};

function response(data: unknown): Response {
  return Response.json({ data, meta: { requestId: REQUEST_ID } });
}

function renderDialog(onCheckoutRedirect = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PhotobookCheckoutDialog
        documentSha256={DOCUMENT_SHA}
        onCheckoutRedirect={onCheckoutRedirect}
        onOpenChange={vi.fn()}
        open
        pageCount={24}
        pdfSha256={PDF_SHA}
        revisionId={REVISION_ID}
      />
    </QueryClientProvider>,
  );
  return onCheckoutRedirect;
}

describe("PhotobookCheckoutDialog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("toont eerst de exacte quote en start pas na twee bevestigingen Stripe Checkout", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => COMMAND_ID });
    const quote = {
      proofRevisionId: REVISION_ID,
      sku: "a4-landscape-hardcover-v1",
      format: "a4-landscape-hardcover-v1",
      pageCount: 24,
      quantity: 1,
      destinationCountry: "NL",
      quoteReference: "quote-exact-1",
      amounts,
      deliveryEstimate: "5–8 werkdagen",
      taxTreatment: "vat_included",
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      termsVersion: "2026-08-01",
      seller: {
        legalName: "Buildy B.V.",
        tradeName: "Buildy",
        registrationNumber: "12345678",
        vatNumber: "NL001234567B01",
        address: "Bouwstraat 1, Utrecht, Nederland",
        countryCode: "NL",
        supportEmail: "support@example.com",
      },
      personalisedProduct: true,
    };
    const checkout = {
      orderId: ORDER_ID,
      orderNumber: "BLD-ABCD-1234",
      projectId: PROJECT_ID,
      proofRevisionId: REVISION_ID,
      sku: "a4-landscape-hardcover-v1",
      format: "a4-landscape-hardcover-v1",
      pageCount: 24,
      quantity: 1,
      destinationCountry: "NL",
      amounts,
      deliveryEstimate: "5–8 werkdagen",
      termsVersion: "2026-08-01",
      status: "checkout_open",
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_buildy",
      checkoutExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      replayed: false,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(quote))
      .mockResolvedValueOnce(response(checkout));
    vi.stubGlobal("fetch", fetchMock);
    const redirect = renderDialog();

    fireEvent.change(screen.getByLabelText("Voornaam"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Achternaam"), { target: { value: "Bakker" } });
    fireEvent.change(screen.getByLabelText("Straat en huisnummer"), { target: { value: "Bouwstraat 12" } });
    fireEvent.change(screen.getByLabelText("Postcode"), { target: { value: "1234 AB" } });
    fireEvent.change(screen.getByLabelText("Plaats"), { target: { value: "Utrecht" } });
    fireEvent.click(screen.getByRole("button", { name: "Prijs en levering opvragen" }));

    expect(await screen.findByText(/133,10/)).toBeInTheDocument();
    const checkoutButton = screen.getByRole("button", { name: "Naar beveiligde betaling" });
    expect(checkoutButton).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /algemene voorwaarden/i }));
    expect(checkoutButton).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /maatwerkproduct/i }));
    expect(checkoutButton).toBeEnabled();
    fireEvent.click(checkoutButton);

    await waitFor(() => expect(redirect).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_buildy"));
    const checkoutBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body));
    expect(checkoutBody).toMatchObject({
      idempotencyKey: COMMAND_ID,
      expectedQuoteReference: "quote-exact-1",
      expectedTotalMinor: 13_310,
      termsVersion: "2026-08-01",
      personalisedProductAccepted: true,
      documentSha256: DOCUMENT_SHA,
      pdfSha256: PDF_SHA,
    });
  });

  it("blokkeert een quote zolang verplichte adresvelden ontbreken", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Prijs en levering opvragen" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Controleer het afleveradres");
    expect(screen.getByLabelText("Voornaam")).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
