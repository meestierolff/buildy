import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "@/hooks/useAuth";
import { useProjectDashboard } from "@/hooks/useProjectApi";
import { BrowserRouter } from "@/lib/router";
import NewUpdate from "@/pages/NewUpdate";
import type { ProjectCard } from "../../shared/contracts/projects";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: vi.fn() }));
vi.mock("@/hooks/useProjectApi", () => ({ useProjectDashboard: vi.fn() }));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const project: ProjectCard = {
  id: PROJECT_ID,
  slug: "jaren-dertig-huis",
  title: "Jaren-dertig huis",
  description: null,
  projectType: "Volledige renovatie",
  visibility: "private",
  progressPercentage: 25,
  version: 1,
  updatedAt: "2026-08-04T10:00:00.000Z",
  publishedAt: null,
  updateCount: 3,
  lastUpdateAt: "2026-08-04T10:00:00.000Z",
  owner: { id: "22222222-2222-4222-8222-222222222222", displayName: "Noor", slug: "noor" },
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
          id: "33333333-3333-4333-8333-333333333333",
          name: "Noor",
          email: "noor@example.com",
          emailVerified: true,
          image: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          user_metadata: { display_name: "Noor", full_name: "Noor" },
        }
      : null,
  };
}

describe("central update action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/update/nieuw");
    vi.mocked(useProjectDashboard).mockReturnValue({
      data: { pages: [{ items: [project], nextCursor: null }], pageParams: [undefined] },
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProjectDashboard>);
  });

  it("opens the selected project with a one-shot composer trigger", () => {
    vi.mocked(useAuth).mockReturnValue(auth(true));
    render(<BrowserRouter><NewUpdate /></BrowserRouter>);

    expect(screen.getByRole("link", { name: /nieuw Bouwmoment toevoegen aan jaren-dertig huis/i }))
      .toHaveAttribute("href", `/project/${PROJECT_ID}?update=nieuw`);
  });

  it("redirects signed-out visitors back through the canonical route", async () => {
    vi.mocked(useAuth).mockReturnValue(auth(false));
    render(<BrowserRouter><NewUpdate /></BrowserRouter>);

    await waitFor(() => expect(window.location.pathname).toBe("/auth"));
    expect(new URLSearchParams(window.location.search).get("next")).toBe("/update/nieuw");
  });
});
