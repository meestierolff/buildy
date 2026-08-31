import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Header from "@/components/Header";
import MobileNav from "@/components/app/MobileNav";
import { useAuth } from "@/hooks/useAuth";
import { useOwnProfile } from "@/hooks/useProfiles";
import { getMobileNavigationItems, MOBILE_NAVIGATION_ITEMS } from "@/lib/productNavigation";
import { BrowserRouter } from "@/lib/router";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useProfiles", () => ({ useOwnProfile: vi.fn() }));

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
    expect(screen.getByRole("link", { name: "Hoe werkt het" })).toHaveAttribute("href", "/#zo-werkt-het");
    expect(screen.getByRole("link", { name: "Inloggen" })).toHaveAttribute("href", "/auth");
    expect(screen.getAllByRole("link", { name: "Start je verbouwverhaal" })).toHaveLength(1);
    expect(screen.queryByRole("link", { name: /ontdek/i })).not.toBeInTheDocument();
  });

  it("toont in de openbare demo alleen de twee ankers en lokale foto-CTA", () => {
    render(<BrowserRouter><Header publicDemo /></BrowserRouter>);

    expect(screen.getByRole("link", { name: "Buildy" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Hoe werkt het?" })).toHaveAttribute("href", "/#zo-werkt-het");
    expect(screen.getByRole("link", { name: "Bekijk voorbeeld" })).toHaveAttribute("href", "/#voorbeeld");
    expect(screen.getByRole("link", { name: "Probeer met je bouwfoto" })).toHaveAttribute("href", "/#probeer-buildy");
    expect(screen.queryByRole("link", { name: /inloggen|registreren|start je account|mijn verbouwing/i })).not.toBeInTheDocument();
  });

  it("toont ingelogd alleen de vier primaire desktopbestemmingen", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: "owner",
        name: "Ada Bouwer",
        email: "ada@example.com",
        emailVerified: true,
        image: null,
        createdAt: new Date("2026-08-04T10:00:00.000Z"),
        updatedAt: new Date("2026-08-04T10:00:00.000Z"),
        user_metadata: { display_name: "Ada Bouwer", full_name: "Ada Bouwer" },
      },
      session: null,
      loading: false,
      refreshing: false,
      error: null,
      refetchSession: vi.fn(),
      signOut: vi.fn(),
    });

    render(<BrowserRouter><Header activeProjectId="project-1" /></BrowserRouter>);

    expect(screen.getByRole("link", { name: "Mijn verbouwing" })).toHaveAttribute("href", "/project/project-1");
    expect(screen.getByRole("link", { name: "Bouwmoment toevoegen" })).toHaveAttribute("href", "/project/project-1?update=nieuw");
    expect(screen.getByRole("link", { name: "Bouwboek" })).toHaveAttribute("href", "/project/project-1/bouwboek");
    expect(screen.getByRole("link", { name: "Profiel" })).toHaveAttribute("href", "/profiel");
    expect(screen.queryByRole("link", { name: /connecties|volgend|bestellingen|meldingen/i })).not.toBeInTheDocument();
  });

  it("stuurt alle projectacties zonder bestaande verbouwing naar de korte aanmaakflow", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: "owner",
        name: "Ada Bouwer",
        email: "ada@example.com",
        emailVerified: true,
        image: null,
        createdAt: new Date("2026-08-04T10:00:00.000Z"),
        updatedAt: new Date("2026-08-04T10:00:00.000Z"),
        user_metadata: { display_name: "Ada Bouwer", full_name: "Ada Bouwer" },
      },
      session: null,
      loading: false,
      refreshing: false,
      error: null,
      refetchSession: vi.fn(),
      signOut: vi.fn(),
    });

    render(<BrowserRouter><Header /></BrowserRouter>);

    expect(screen.getByRole("link", { name: "Mijn verbouwing" })).toHaveAttribute("href", "/project/nieuw");
    expect(screen.getByRole("link", { name: "Bouwmoment toevoegen" })).toHaveAttribute("href", "/project/nieuw");
    expect(screen.getByRole("link", { name: "Bouwboek" })).toHaveAttribute("href", "/project/nieuw");
  });

  it("gebruikt exact de vier afgesproken mobiele labels", () => {
    expect(MOBILE_NAVIGATION_ITEMS.map((item) => item.label)).toEqual([
      "Verhaal",
      "Toevoegen",
      "Bouwboek",
      "Profiel",
    ]);
  });

  it("koppelt mobiele bestemmingen aan de actieve verbouwing", () => {
    const items = getMobileNavigationItems({
      storyHref: "/project/project-1",
      updateHref: "/project/project-1?update=nieuw",
      photobookHref: "/project/project-1/bouwboek",
      profileHref: "/profiel",
    });

    render(<BrowserRouter><MobileNav items={items} /></BrowserRouter>);

    expect(screen.getByRole("link", { name: "Verhaal" })).toHaveAttribute("href", "/project/project-1");
    expect(screen.getByRole("link", { name: "Toevoegen" })).toHaveAttribute("href", "/project/project-1?update=nieuw");
    expect(screen.getByRole("link", { name: "Bouwboek" })).toHaveAttribute("href", "/project/project-1/bouwboek");
    expect(screen.getByRole("link", { name: "Profiel" })).toHaveAttribute("href", "/profiel");
  });

  it("houdt ook mobiele fallbacks binnen de actieve MVP-routes", () => {
    const items = getMobileNavigationItems();

    expect(items.map((item) => item.href)).toEqual([
      "/project/nieuw",
      "/project/nieuw",
      "/project/nieuw",
      "/profiel",
    ]);
  });
});
