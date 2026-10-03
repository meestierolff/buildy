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

  it("beschrijft handmatige boekaanvragen zonder automatische betaling", () => {
    renderLegalPage(<Terms />);

    const text = document.body.textContent ?? "";
    expect(screen.getByRole("heading", { level: 1, name: "Algemene voorwaarden" })).toBeInTheDocument();
    expect(text).toMatch(/gratis digitale dienst/i);
    expect(text).toMatch(/beheerder behandelt die aanvraag handmatig/i);
    expect(text).toMatch(/geen bedrag afgeschreven/i);
    expect(text).toMatch(/aanvraag bewaart de getoonde boekversie/i);
    expect(text).toMatch(/gebruikersnaam en wachtwoord/i);
    expect(text).toMatch(/geen e-mailadres/i);
    expect(text).toMatch(/Bewaar je inloggegevens zorgvuldig/i);
    expect(text).not.toMatch(/Google|OAuth/i);
    expect(text).not.toMatch(/Stripe|Peecho|checkout|herroepingsrecht/i);
    expect(screen.getAllByRole("link", { name: /support(formulier)?/i })[0]).toHaveAttribute("href", "/support");
  });

  it("noemt alleen de datastromen en leveranciers van de actieve MVP", () => {
    renderLegalPage(<Privacy />);

    const text = document.body.textContent ?? "";
    expect(screen.getByRole("heading", { level: 1, name: "Privacyverklaring" })).toBeInTheDocument();
    expect(text).toMatch(/gebruikersnaam.*hash van je wachtwoord/i);
    expect(text).toMatch(/geen e-mailadres/i);
    expect(text).toMatch(/niet automatisch aan gekoppeld/i);
    expect(text).not.toMatch(/Google|OpenID Connect/i);
    expect(text).toMatch(/private Vercel Blob-opslag/i);
    expect(text).toMatch(/Neon/i);
    expect(text).toMatch(/Privénotities en budget/i);
    expect(text).toMatch(/versleuteld opgeslagen/i);
    expect(text).toMatch(/geen gegevens automatisch naar een drukkerij/i);
    expect(text).toMatch(/exploitant.*nog (niet aangeleverd|vereist)/i);
    expect(text).not.toMatch(/Stripe|Peecho|checkout|AI-verwerking/i);
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
