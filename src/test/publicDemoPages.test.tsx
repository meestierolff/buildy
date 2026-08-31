import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BrowserRouter } from "@/lib/router";
import PublicDemoDeferred from "@/pages/PublicDemoDeferred";
import {
  PublicExampleBook,
  PublicExampleRenovation,
} from "@/pages/PublicDemoExample";

vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: vi.fn() }));

describe("openbare demo-pagina's", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("maakt accountafhankelijke routes intentioneel en herstelbaar", () => {
    window.history.replaceState({}, "", "/auth");
    render(<BrowserRouter><PublicDemoDeferred /></BrowserRouter>);

    expect(screen.getByRole("heading", { name: "Persoonlijke accounts openen later in de bèta." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Terug naar de demo" })).toHaveAttribute("href", "/#probeer-buildy");
    expect(screen.queryByText(/Google login unavailable|provider error/i)).not.toBeInTheDocument();
  });

  it("labelt de repository-eigen voorbeeldverbouwing en activiteit als demonstratie", () => {
    window.history.replaceState({}, "", "/project/voorbeeldverbouwing");
    render(<BrowserRouter><PublicExampleRenovation /></BrowserRouter>);

    expect(screen.getByText("Voorbeeldverbouwing")).toBeInTheDocument();
    expect(screen.getByText(/volledig verzonnen/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Bouwmoment [1-3]/)).toHaveLength(3);
    expect(screen.getByText(/Voorbeeldreactie · demonstratie/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /voorbeeld-Bouwboek/i })).toHaveAttribute(
      "href",
      "/project/voorbeeldverbouwing/bouwboek",
    );
  });

  it("toont een volledig statisch Bouwboek zonder betaal- of provideractie", () => {
    window.history.replaceState({}, "", "/project/voorbeeldverbouwing/bouwboek");
    render(<BrowserRouter><PublicExampleBook /></BrowserRouter>);

    expect(screen.getByText("Voorbeeldweergave")).toBeInTheDocument();
    expect(screen.getByText("Zo groeit je Bouwboek straks met je verbouwing mee.")).toBeInTheDocument();
    expect(screen.getByText("Fysiek bestellen volgt na de bèta.")).toBeInTheDocument();
    expect(screen.getByText("Omslag")).toBeInTheDocument();
    expect(screen.getByText("Openingsspread")).toBeInTheDocument();
    expect(screen.getByText("Slotpagina")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /bestel|betaal|checkout/i })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Stripe|Peecho|verzending|prijs/i);
  });
});
