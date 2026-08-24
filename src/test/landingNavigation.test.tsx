import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Header from "@/components/Header";
import MobileNav from "@/components/app/MobileNav";
import { useAuth } from "@/hooks/useAuth";
import { useOwnProfile } from "@/hooks/useProfiles";
import { MOBILE_NAVIGATION_ITEMS, type ProductNavigationItem } from "@/lib/productNavigation";
import { BrowserRouter } from "@/lib/router";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useProfiles", () => ({ useOwnProfile: vi.fn() }));
vi.mock("@/components/BetaBadge", () => ({ default: () => null }));
vi.mock("@/components/NotificationBell", () => ({ default: () => null }));

describe("landing- en productnavigatie", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      session: null,
      loading: false,
      refreshing: false,
      error: null,
      refetchSession: vi.fn(),
      signOut: vi.fn(),
    });
    vi.mocked(useOwnProfile).mockReturnValue({ data: undefined } as ReturnType<typeof useOwnProfile>);
  });

  it("toont de afgesproken publieke header met één primaire actie", () => {
    render(<BrowserRouter><Header /></BrowserRouter>);

    expect(screen.getByRole("link", { name: "Buildy" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Bekijk voorbeeld" })).toHaveAttribute("href", "/#voorbeeld");
    expect(screen.getByRole("link", { name: "Ontdek verbouwingen" })).toHaveAttribute("href", "/ontdekken");
    expect(screen.getByRole("link", { name: "Hoe werkt het?" })).toHaveAttribute("href", "/#zo-werkt-het");
    expect(screen.getByRole("link", { name: "Inloggen" })).toHaveAttribute("href", "/auth");
    expect(screen.getAllByRole("link", { name: "Voeg je eerste verbouwfoto toe" })).toHaveLength(1);
  });

  it("gebruikt producttaal in de standaard mobiele navigatie", () => {
    expect(MOBILE_NAVIGATION_ITEMS.map((item) => item.label)).toEqual([
      "Verbouwingen",
      "Volgend",
      "Bouwmoment",
      "Verhalen",
      "Profiel",
    ]);
  });

  it("normaliseert ook oude door App aangeleverde labels", () => {
    const legacyItems: readonly ProductNavigationItem[] = [
      { id: "projects", label: "Projecten", href: "/projecten", icon: "projects" },
      { id: "update", label: "Update", href: "/update/nieuw", icon: "add", primaryAction: true },
      { id: "discover", label: "Ontdekken", href: "/ontdekken", icon: "discover" },
      { id: "connections", label: "Vrienden", href: "/connecties", icon: "connections" },
    ];

    render(<BrowserRouter><MobileNav items={legacyItems} /></BrowserRouter>);

    expect(screen.getByRole("link", { name: "Verbouwingen" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bouwmoment" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Verhalen" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connecties" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Projecten" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Update" })).not.toBeInTheDocument();
  });
});
