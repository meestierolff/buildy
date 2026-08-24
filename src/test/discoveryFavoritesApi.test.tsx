import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "@/hooks/useAuth";
import {
  useFollowingFeed,
  useProjectDashboard,
  useProjectDiscovery,
} from "@/hooks/useProjectApi";
import { BrowserRouter } from "@/lib/router";
import Favorites from "@/pages/Favorites";
import Index from "@/pages/Index";
import type { FollowingFeed, ProjectCard } from "../../shared/contracts/projects";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: vi.fn() }));
vi.mock("@/hooks/useProjectApi", () => ({
  useFollowingFeed: vi.fn(),
  useProjectDashboard: vi.fn(),
  useProjectDiscovery: vi.fn(),
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const UPDATE_ID = "33333333-3333-4333-8333-333333333333";

const project: ProjectCard = {
  id: PROJECT_ID,
  slug: "veilige-keuken",
  title: "Veilige keuken",
  description: null,
  projectType: "Keuken",
  visibility: "public",
  progressPercentage: 40,
  version: 1,
  updatedAt: "2026-08-04T10:00:00.000Z",
  publishedAt: "2026-08-04T10:00:00.000Z",
  updateCount: 1,
  lastUpdateAt: "2026-08-04T10:00:00.000Z",
  owner: { id: OWNER_ID, displayName: "Noor", slug: "noor" },
  cover: null,
};

function auth(authenticated: boolean): ReturnType<typeof useAuth> {
  return {
    error: null,
    loading: false,
    refreshing: false,
    refetchSession: vi.fn(),
    session: null,
    signOut: vi.fn(),
    user: authenticated
      ? {
          id: "provider-user",
          name: "Noor",
          email: "noor@example.com",
          emailVerified: true,
          image: null,
          createdAt: new Date("2026-08-04T10:00:00.000Z"),
          updatedAt: new Date("2026-08-04T10:00:00.000Z"),
          user_metadata: { display_name: "Noor", full_name: "Noor" },
        }
      : null,
  };
}

function infiniteResult(items: ProjectCard[] = [], error = false) {
  return {
    data: error ? undefined : { pages: [{ items, nextCursor: null }], pageParams: [undefined] },
    isPending: false,
    isError: error,
    refetch: vi.fn(),
  };
}

describe("typed discovery browser states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
    vi.mocked(useAuth).mockReturnValue(auth(false));
    vi.mocked(useProjectDashboard).mockReturnValue(
      infiniteResult() as unknown as ReturnType<typeof useProjectDashboard>,
    );
    vi.mocked(useProjectDiscovery).mockReturnValue(
      infiniteResult([project]) as unknown as ReturnType<typeof useProjectDiscovery>,
    );
  });

  it("renders only the typed public discovery DTO", () => {
    window.history.replaceState({}, "", "/ontdekken");
    render(<BrowserRouter><Index /></BrowserRouter>);
    expect(screen.getAllByText("Veilige keuken").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Door Noor/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Openbaar").length).toBeGreaterThan(0);
  });

  it("fails closed when discovery cannot be verified", () => {
    window.history.replaceState({}, "", "/ontdekken");
    vi.mocked(useProjectDiscovery).mockReturnValue(
      infiniteResult([], true) as unknown as ReturnType<typeof useProjectDiscovery>,
    );
    render(<BrowserRouter><Index /></BrowserRouter>);
    expect(screen.getByText("Openbare verbouwingen zijn even niet bereikbaar")).toBeInTheDocument();
    expect(screen.queryByText("Veilige keuken")).not.toBeInTheDocument();
  });

  it("keeps the landing route marketing-only while discovery has its own canonical page", () => {
    render(<BrowserRouter><Index /></BrowserRouter>);

    expect(screen.getByRole("heading", { level: 1, name: "Maak van je verbouwing een verhaal om te bewaren." })).toBeInTheDocument();
    expect(screen.getByText("Het dagboek voor je verbouwing")).toBeInTheDocument();
    expect(screen.getByText("Leg ieder bouwmoment vast, laat vrienden en familie meekijken en maak er later een persoonlijk Bouwboek van.")).toBeInTheDocument();
    expect(screen.queryByText("Veilige keuken")).not.toBeInTheDocument();
    expect(vi.mocked(useProjectDiscovery)).toHaveBeenCalledWith(false);
    expect(vi.mocked(useProjectDashboard)).toHaveBeenCalledWith(false);
  });

  it("shows only the authenticated dashboard on the projects route", () => {
    vi.mocked(useAuth).mockReturnValue(auth(true));
    vi.mocked(useProjectDashboard).mockReturnValue(
      infiniteResult([{ ...project, visibility: "private", publishedAt: null }]) as unknown as ReturnType<typeof useProjectDashboard>,
    );
    window.history.replaceState({}, "", "/projecten");
    render(<BrowserRouter><Index /></BrowserRouter>);

    expect(screen.getByRole("heading", { level: 1, name: "Mijn verbouwingen" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /maak van je verbouwing/i })).not.toBeInTheDocument();
    expect(vi.mocked(useProjectDiscovery)).toHaveBeenCalledWith(false);
    expect(vi.mocked(useProjectDashboard)).toHaveBeenCalledWith(true);
  });
});

describe("typed following feed browser states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue(auth(true));
  });

  it("renders server-filtered followed projects and published activity", () => {
    const feed: FollowingFeed = {
      projects: [project],
      activity: [{
        project: { id: PROJECT_ID, title: project.title },
        update: {
          id: UPDATE_ID,
          projectId: PROJECT_ID,
          phase: null,
          title: "Werkblad geplaatst",
          room: "Keuken",
          description: "De laatste plaat ligt.",
          updateDate: "2026-08-04",
          status: "published",
          isMilestone: true,
          sortOrder: 0,
          contentRevision: 1,
          version: 1,
          publishedAt: "2026-08-04T10:00:00.000Z",
          updatedAt: "2026-08-04T10:00:00.000Z",
          media: [],
        },
      }],
    };
    vi.mocked(useFollowingFeed).mockReturnValue({
      data: feed,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useFollowingFeed>);

    render(<BrowserRouter><Favorites /></BrowserRouter>);
    expect(screen.getByText("Werkblad geplaatst")).toBeInTheDocument();
    expect(screen.getByText("Veilige keuken")).toBeInTheDocument();
    expect(screen.getByText("Mijlpaal")).toBeInTheDocument();
  });

  it("does not retain followed projects after a read error", () => {
    vi.mocked(useFollowingFeed).mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useFollowingFeed>);
    render(<BrowserRouter><Favorites /></BrowserRouter>);
    expect(screen.getByText("Je feed kon niet worden geladen")).toBeInTheDocument();
    expect(screen.queryByText("Veilige keuken")).not.toBeInTheDocument();
  });
});
