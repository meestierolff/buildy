import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import Header from "@/components/Header";
import MobileNav from "@/components/app/MobileNav";
import { useAuth } from "@/hooks/useAuth";
import { useProjectDashboard } from "@/hooks/useProjectApi";
import { getMobileNavigationItems, MOBILE_NAVIGATION_ITEMS } from "@/lib/productNavigation";
import { BrowserRouter } from "@/lib/router";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/hooks/useProjectApi", () => ({ useProjectDashboard: vi.fn() }));
vi.mock("@/components/app/OnboardingDialog", () => ({ default: () => null }));
vi.mock("@/components/moderation/FeedbackLauncher", () => ({ default: () => null }));
vi.mock("@/pages/TripDetail", () => ({ default: () => <div>Geopend verhaal</div> }));

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
    vi.mocked(useProjectDashboard).mockReturnValue({
      data: { pages: [{ items: [], nextCursor: null }] },
      isSuccess: true,
    } as unknown as ReturnType<typeof useProjectDashboard>);
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

  it("maakt ingelogd verhalen, gevolgde projecten en meldingen bereikbaar", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: "owner",
        name: "Ada Bouwer",
        email: "ada@example.com",
        username: "test-eigenaar",
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

    expect(screen.getByRole("link", { name: "Buildy" })).toHaveAttribute("href", "/projecten");
    expect(screen.getByRole("link", { name: "Verhalen" })).toHaveAttribute("href", "/projecten");
    expect(screen.getByRole("link", { name: "Volgend" })).toHaveAttribute("href", "/volgend");
    expect(screen.getByRole("link", { name: "Bouwmoment toevoegen" })).toHaveAttribute("href", "/project/project-1?update=nieuw");
    expect(screen.getByRole("link", { name: "Bouwboek" })).toHaveAttribute("href", "/project/project-1/bouwboek");
    expect(screen.getByRole("link", { name: "Profiel" })).toHaveAttribute("href", "/profiel");
    expect(screen.getByRole("link", { name: "Meldingen" })).toHaveAttribute("href", "/notificaties");
    expect(screen.queryByRole("link", { name: /connecties|bestellingen/i })).not.toBeInTheDocument();
  });

  it("laat een volger zonder eigen verbouwing rondkijken zonder aanmaakflow", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: "owner",
        name: "Ada Bouwer",
        email: "ada@example.com",
        username: "test-eigenaar",
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

    expect(screen.getByRole("link", { name: "Verhalen" })).toHaveAttribute("href", "/projecten");
    expect(screen.getByRole("link", { name: "Volgend" })).toHaveAttribute("href", "/volgend");
    expect(screen.getByRole("link", { name: "Bouwmoment toevoegen" })).toHaveAttribute("href", "/project/nieuw");
    expect(screen.getByRole("link", { name: "Bouwboek" })).toHaveAttribute("href", "/projecten");
    expect(screen.getByRole("link", { name: "Meldingen" })).toHaveAttribute("href", "/notificaties");
  });

  it("gebruikt de vijf afgesproken mobiele bestemmingen", () => {
    expect(MOBILE_NAVIGATION_ITEMS.map((item) => item.label)).toEqual([
      "Verhalen",
      "Volgend",
      "Toevoegen",
      "Bouwboek",
      "Profiel",
    ]);
  });

  it("koppelt mobiele bestemmingen aan de actieve verbouwing", () => {
    const items = getMobileNavigationItems({
      updateHref: "/project/project-1?update=nieuw",
      photobookHref: "/project/project-1/bouwboek",
      profileHref: "/profiel",
    });

    render(<BrowserRouter><MobileNav items={items} /></BrowserRouter>);

    expect(screen.getByRole("link", { name: "Verhalen" })).toHaveAttribute("href", "/projecten");
    expect(screen.getByRole("link", { name: "Volgend" })).toHaveAttribute("href", "/volgend");
    expect(screen.getByRole("link", { name: "Toevoegen" })).toHaveAttribute("href", "/project/project-1?update=nieuw");
    expect(screen.getByRole("link", { name: "Bouwboek" })).toHaveAttribute("href", "/project/project-1/bouwboek");
    expect(screen.getByRole("link", { name: "Profiel" })).toHaveAttribute("href", "/profiel");
  });

  it("houdt ook mobiele fallbacks binnen de actieve MVP-routes", () => {
    const items = getMobileNavigationItems();

    expect(items.map((item) => item.href)).toEqual([
      "/projecten",
      "/volgend",
      "/project/nieuw",
      "/projecten",
      "/profiel",
    ]);
  });

  it("houdt toevoegen en het Bouwboek bij het geopende eigen project", async () => {
    vi.mocked(useAuth).mockReturnValue({
      ...vi.mocked(useAuth)(),
      user: { id: "owner" },
    } as ReturnType<typeof useAuth>);
    vi.mocked(useProjectDashboard).mockReturnValue({
      data: { pages: [{ items: [{ id: "project-1" }, { id: "project-2" }], nextCursor: null }] },
      isSuccess: true,
    } as unknown as ReturnType<typeof useProjectDashboard>);
    window.history.replaceState({}, "", "/project/project-2");

    render(<App />);
    await screen.findByText("Geopend verhaal");

    const mobile = within(screen.getByRole("navigation", { name: "Mobiele navigatie" }));
    expect(mobile.getByRole("link", { name: "Toevoegen" })).toHaveAttribute("href", "/project/project-2?update=nieuw");
    expect(mobile.getByRole("link", { name: "Bouwboek" })).toHaveAttribute("href", "/project/project-2/bouwboek");
    expect(screen.getByRole("link", { name: "Bouwmoment toevoegen" })).toHaveAttribute("href", "/project/project-2?update=nieuw");
    expect(screen.getByRole("link", { name: "Meldingen" })).toHaveAttribute("href", "/notificaties");
  });
});
