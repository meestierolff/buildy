import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "@/hooks/useAuth";
import {
  useCreateCommentMutation,
  useDeleteCommentMutation,
  useInfiniteComments,
  useReactionMutation,
  useReactionSummary,
} from "@/hooks/useEngagement";
import {
  useFollowingFeed,
  useProjectDashboard,
} from "@/hooks/useProjectApi";
import { BrowserRouter } from "@/lib/router";
import Favorites from "@/pages/Favorites";
import Index from "@/pages/Index";
import type { FollowingFeed, ProjectCard } from "../../shared/contracts/projects";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: vi.fn() }));
vi.mock("@/hooks/useEngagement", () => ({
  useCreateCommentMutation: vi.fn(),
  useDeleteCommentMutation: vi.fn(),
  useInfiniteComments: vi.fn(),
  useReactionMutation: vi.fn(),
  useReactionSummary: vi.fn(),
}));
vi.mock("@/hooks/useProjectApi", () => ({
  useFollowingFeed: vi.fn(),
  useProjectDashboard: vi.fn(),
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
          username: "test-eigenaar",
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

describe("landing and project dashboard browser states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
    vi.mocked(useAuth).mockReturnValue(auth(false));
    vi.mocked(useProjectDashboard).mockReturnValue(
      infiniteResult() as unknown as ReturnType<typeof useProjectDashboard>,
    );
  });

  it("keeps the landing route focused on starting a renovation", () => {
    render(<BrowserRouter><Index /></BrowserRouter>);

    expect(screen.getByRole("heading", { level: 1, name: /Jouw huis\.\s*Jouw avontuur\.\s*Jouw verhaal\./ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Beleef het samen" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Een boek dat met je meegroeit." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start je verbouwverhaal" })).toHaveAttribute("href", "/auth");
    expect(screen.queryByText("Veilige keuken")).not.toBeInTheDocument();
    expect(vi.mocked(useProjectDashboard)).toHaveBeenCalledWith(false);
  });

  it("shows only the authenticated dashboard on the projects route", () => {
    vi.mocked(useAuth).mockReturnValue(auth(true));
    vi.mocked(useProjectDashboard).mockReturnValue(
      infiniteResult([{ ...project, visibility: "private", publishedAt: null }]) as unknown as ReturnType<typeof useProjectDashboard>,
    );
    window.history.replaceState({}, "", "/projecten");
    render(<BrowserRouter><Index /></BrowserRouter>);

    expect(screen.getByRole("heading", { level: 1, name: "Jouw projecten" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /jouw avontuur/i })).not.toBeInTheDocument();
    expect(vi.mocked(useProjectDashboard)).toHaveBeenCalledWith(true);
  });

  it("retains existing landing intent parameters on the authenticated projects route", async () => {
    vi.mocked(useAuth).mockReturnValue(auth(true));
    window.history.replaceState({}, "", "/?intent=landing-photo");
    render(<BrowserRouter><Index /></BrowserRouter>);

    await waitFor(() => expect(window.location.pathname).toBe("/projecten"));
    expect(window.location.search).toBe("?intent=landing-photo");
    expect(screen.getByRole("heading", { name: "Jouw projecten" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Liever eerst bij anderen meekijken" })).toHaveAttribute("href", "/connecties");
  });
});

describe("typed following feed browser states", () => {
  const react = vi.fn().mockResolvedValue({ state: "active" });

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/volgend");
    vi.mocked(useAuth).mockReturnValue(auth(true));
    vi.mocked(useReactionSummary).mockReturnValue({
      data: { items: [{ emoji: "👍", count: 3, viewerReacted: false }] },
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useReactionSummary>);
    vi.mocked(useReactionMutation).mockReturnValue({
      mutateAsync: react,
      isPending: false,
    } as unknown as ReturnType<typeof useReactionMutation>);
    vi.mocked(useInfiniteComments).mockReturnValue({
      data: { pages: [{ items: [], nextCursor: null }] },
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useInfiniteComments>);
    vi.mocked(useCreateCommentMutation).mockReturnValue({
      isPending: false,
    } as unknown as ReturnType<typeof useCreateCommentMutation>);
    vi.mocked(useDeleteCommentMutation).mockReturnValue({
      isPending: false,
    } as unknown as ReturnType<typeof useDeleteCommentMutation>);
  });

  it("lets a follower react and open comments on the selected published Bouwmoment", async () => {
    const feed: FollowingFeed = {
      projects: [project],
      activity: [{
        project: { id: PROJECT_ID, title: project.title, owner: project.owner, followSource: "user" },
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
    expect(screen.getByRole("link", { name: "Profiel van Noor" })).toHaveAttribute("href", "/profiel/noor");
    expect(screen.getByText("Mijlpaal")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Plaats reactie 👍, 3" }));
    await waitFor(() => expect(react).toHaveBeenCalledWith({
      action: "add",
      input: { target: "update", emoji: "👍" },
    }));
    expect(useReactionMutation).toHaveBeenCalledWith(PROJECT_ID, UPDATE_ID);

    fireEvent.click(screen.getByRole("button", { name: "Opmerkingen bij Werkblad geplaatst openen" }));
    expect(screen.getByRole("textbox", { name: "Nieuwe reactie" })).toBeInTheDocument();
    expect(useInfiniteComments).toHaveBeenCalledWith(PROJECT_ID, UPDATE_ID, true);
    expect(window.location.pathname).toBe("/volgend");
  });

  it("does not retain followed projects after a read error", () => {
    vi.mocked(useFollowingFeed).mockReturnValue({
      data: { projects: [project], activity: [] },
      isPending: false,
      isError: true,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useFollowingFeed>);
    render(<BrowserRouter><Favorites /></BrowserRouter>);
    expect(screen.getByText("Je tijdlijn kon niet worden geladen")).toBeInTheDocument();
    expect(screen.queryByText("Veilige keuken")).not.toBeInTheDocument();
  });
});
