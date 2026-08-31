import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserRouter } from "@/lib/router";
import Privacy from "@/pages/legal/Privacy";
import Terms from "@/pages/legal/Terms";

vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: vi.fn() }));

function renderLegalPage(page: ReactNode) {
  return render(<BrowserRouter>{page}</BrowserRouter>);
}

describe("juridische copy voor de gratis MVP", () => {
  afterEach(cleanup);

  it("beschrijft in de voorwaarden alleen de gratis dienst en vrijblijvend printonderzoek", () => {
    renderLegalPage(<Terms />);

    const text = document.body.textContent ?? "";
    expect(screen.getByRole("heading", { level: 1, name: "Algemene voorwaarden" })).toBeInTheDocument();
    expect(text).toMatch(/gratis digitale dienst/i);
    expect(text).toMatch(/printinteressevragen zijn alleen feedback/i);
    expect(text).toMatch(/legt jou of Buildy nergens op vast/i);
    expect(text).not.toMatch(/Stripe|Peecho|checkout|bestell|betaling|herroepingsrecht|drukker|bezorger|print-PDF/i);
    expect(screen.getAllByRole("link", { name: /support(formulier)?/i })[0]).toHaveAttribute("href", "/support");
  });

  it("noemt alleen de datastromen en leveranciers van de actieve MVP", () => {
    renderLegalPage(<Privacy />);

    const text = document.body.textContent ?? "";
    expect(screen.getByRole("heading", { level: 1, name: "Privacyverklaring" })).toBeInTheDocument();
    expect(text).toMatch(/Google-identificatie/i);
    expect(text).toMatch(/private Blob-opslag/i);
    expect(text).toMatch(/Neon/i);
    expect(text).toMatch(/printinteresse is alleen productonderzoek/i);
    expect(text).toMatch(/exploitant.*nog (niet aangeleverd|vereist)/i);
    expect(text).not.toMatch(/Stripe|Peecho|checkout|bestell|betaling|drukker|bezorger|print-PDF|AI-verwerking/i);
  });

  it("houdt de juridische navigatie bij Voorwaarden, Privacy en de werkende Support-route", () => {
    renderLegalPage(<Terms />);

    const navigation = screen.getByRole("navigation", { name: "Juridische pagina's" });
    expect(within(navigation).getByRole("link", { name: "Algemene voorwaarden" })).toHaveAttribute("href", "/voorwaarden");
    expect(within(navigation).getByRole("link", { name: "Privacyverklaring" })).toHaveAttribute("href", "/privacy");
    expect(within(navigation).getByRole("link", { name: "Support" })).toHaveAttribute("href", "/support");
    expect(within(navigation).queryByRole("link", { name: /herroeping/i })).not.toBeInTheDocument();
  });
});
