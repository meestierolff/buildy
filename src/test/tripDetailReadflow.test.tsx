import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectOverview, ProjectUpdate } from "../../shared/contracts/projects";
import { useProject } from "@/hooks/useProjectApi";
import { ApiClientError } from "@/lib/apiClient";
import TripDetail from "@/pages/TripDetail";

vi.mock("@/hooks/useProjectApi", () => ({
  useProject: vi.fn(),
  useDeleteProjectMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/router", () => ({
  useParams: () => ({ id: "11111111-1111-4111-8111-111111111111" }),
  useLocation: () => ({
    hash: window.location.hash,
    pathname: window.location.pathname,
    search: window.location.search,
  }),
  useNavigate: () => vi.fn(),
  Navigate: ({ to }: { to: string }) => <output data-testid="route-normalization">{to}</output>,
  Link: ({ to, children, ...props }: {
    to: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => <a href={to} {...props}>{children}</a>,
}));
vi.mock("@/components/FollowButton", () => ({
  default: ({ projectId }: { projectId: string }) => <button type="button">Volg {projectId}</button>,
}));
vi.mock("@/components/ProgressControl", () => ({
  default: ({ expectedVersion }: { expectedVersion: number }) => (
    <div data-testid="progress-control">versie {expectedVersion}</div>
  ),
}));
vi.mock("@/components/BlueprintTimeline", () => ({
  default: ({ updates, projectId }: { updates: ProjectUpdate[]; projectId: string }) => (
    <div data-testid="typed-timeline">
      {projectId}:{updates.map((update) => update.media.map((media) => media.proxyPath).join(",")).join(";")}
    </div>
  ),
}));
vi.mock("@/components/AllPhotosTab", () => ({
  default: ({ updates }: { updates: ProjectUpdate[] }) => (
    <div data-testid="typed-gallery">{updates.length} typed updates</div>
  ),
}));
vi.mock("@/components/project/FloorplanBoard", () => ({
  FloorplanBoard: ({ availableUpdates }: {
    availableUpdates: Array<{ id: string }>;
  }) => (
    <div data-testid="floorplan-board">
      {availableUpdates.map((update) => update.id).join(",")}
    </div>
  ),
}));
vi.mock("@/components/RequestAccessCard", () => ({
  default: ({ projectId }: { projectId: string }) => <div data-testid="private-access">privé {projectId}</div>,
}));
vi.mock("@/components/AddStepDialog", () => ({
  default: () => <div role="dialog">Nieuwe update</div>,
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const UPDATE_ID = "33333333-3333-4333-8333-333333333333";
const MEDIA_ID = "44444444-4444-4444-8444-444444444444";

const project: ProjectOverview = {
  id: PROJECT_ID,
  slug: "ons-huis",
  title: "Ons huis",
  description: "Een veilige verbouwing.",
  projectType: "Renovatie",
  visibility: "private",
  progressPercentage: 42,
  version: 7,
  updatedAt: "2026-08-04T12:00:00.000Z",
  publishedAt: null,
  updateCount: 1,
  lastUpdateAt: "2026-08-04T12:00:00.000Z",
  owner: { id: OWNER_ID, displayName: "Noor", slug: "noor-bouwt" },
  cover: {
    id: MEDIA_ID,
    contentType: "image/jpeg",
    width: 1600,
    height: 1200,
    proxyPath: `/api/media/${MEDIA_ID}`,
  },
  startDate: "2026-08-01",
  expectedEndDate: "2026-08-31",
  contentRevision: 2,
  followerCount: 3,
  viewerAccess: "owner",
  canEdit: true,
  phases: [],
};

const update: ProjectUpdate = {
  id: UPDATE_ID,
  projectId: PROJECT_ID,
  phase: null,
  title: "Keuken gestript",
  room: "Keuken",
  description: "De eerste dag zit erop.",
  updateDate: "2026-08-04",
  status: "published",
  isMilestone: true,
  sortOrder: 0,
  contentRevision: 1,
  version: 1,
  publishedAt: "2026-08-04T12:00:00.000Z",
  updatedAt: "2026-08-04T12:00:00.000Z",
  media: [{
    id: MEDIA_ID,
    contentType: "image/jpeg",
    width: 1600,
    height: 1200,
    proxyPath: `/api/media/${MEDIA_ID}`,
    role: "gallery",
    sortOrder: 0,
    caption: null,
  }],
};

function mockReadflow(input: {
  overview?: ProjectOverview;
  overviewPending?: boolean;
  overviewError?: Error | null;
  timelineError?: Error | null;
} = {}) {
  const overview = input.overview ?? project;
  vi.mocked(useProject).mockReturnValue({
    overviewQuery: {
      data: input.overviewPending || input.overviewError ? undefined : overview,
      error: input.overviewError ?? null,
      isPending: input.overviewPending ?? false,
      isError: Boolean(input.overviewError),
      refetch: vi.fn().mockResolvedValue(undefined),
    },
    timelineQuery: {
      data: input.timelineError ? undefined : {
        pages: [{ projectId: PROJECT_ID, items: [update], nextCursor: null }],
        pageParams: [undefined],
      },
      error: input.timelineError ?? null,
      isPending: false,
      isError: Boolean(input.timelineError),
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn().mockResolvedValue(undefined),
      refetch: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as ReturnType<typeof useProject>);
}

describe("TripDetail typed project-readflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", `/project/${PROJECT_ID}`);
    mockReadflow();
  });

  afterEach(cleanup);

  it("leidt ownerrechten uit het readmodel af en gebruikt alleen proxy-media", () => {
    render(<TripDetail />);

    expect(screen.getByRole("heading", { name: "Ons huis" })).toBeInTheDocument();
    expect(screen.getByLabelText("Eigenaarsweergave")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Bouwboek/i })).toHaveAttribute(
      "href",
      `/project/${PROJECT_ID}/bouwboek`,
    );
    expect(screen.getByRole("button", { name: "Update toevoegen" })).toBeInTheDocument();
    expect(screen.getByTestId("typed-timeline")).toHaveTextContent(`/api/media/${MEDIA_ID}`);
    expect(screen.queryByRole("button", { name: /update bewerken|update verwijderen/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("progress-control")).toHaveTextContent("versie 7");
  });

  it("voedt de typed planning- en galerijweergaven met canonieke IDs", async () => {
    render(<TripDetail />);

    fireEvent.mouseDown(screen.getByRole("tab", { name: /Plattegrond/i }), { button: 0 });
    expect(await screen.findByTestId("floorplan-board")).toHaveTextContent(UPDATE_ID);

    fireEvent.mouseDown(screen.getByRole("tab", { name: /Alle foto's/i }), { button: 0 });
    expect(await screen.findByTestId("typed-gallery")).toHaveTextContent("1 typed updates");
  });

  it("toont een toegankelijke loadingstate zonder projectmetadata", () => {
    mockReadflow({ overviewPending: true });
    render(<TripDetail />);

    expect(screen.getByRole("status")).toHaveTextContent("Project laden");
    expect(screen.queryByText("Ons huis")).not.toBeInTheDocument();
  });

  it("faalt de hele pagina gesloten zodra overview of timeline toegang weigert", () => {
    mockReadflow({
      timelineError: new ApiClientError({
        code: "NOT_FOUND",
        message: "Niet gevonden.",
        status: 404,
      }),
    });
    render(<TripDetail />);

    expect(screen.getByTestId("private-access")).toHaveTextContent(`privé ${PROJECT_ID}`);
    expect(screen.queryByText("Ons huis")).not.toBeInTheDocument();
  });

  it("biedt bij een tijdelijk overviewprobleem een herhaalactie", () => {
    mockReadflow({
      overviewError: new ApiClientError({
        code: "INTERNAL_ERROR",
        message: "Tijdelijk mislukt.",
        status: 503,
      }),
    });
    render(<TripDetail />);

    expect(screen.getByRole("alert")).toHaveTextContent("Project kon niet worden geladen");
    expect(screen.getByRole("button", { name: /Opnieuw proberen/i })).toBeInTheDocument();
  });

  it("normaliseert historische step-deeplinks naar de update-query", () => {
    window.history.replaceState(null, "", `/project/${PROJECT_ID}?step=${UPDATE_ID}#update-${UPDATE_ID}`);
    render(<TripDetail />);

    expect(screen.getByTestId("route-normalization")).toHaveTextContent(
      `/project/${PROJECT_ID}?update=${UPDATE_ID}#update-${UPDATE_ID}`,
    );
  });

  it("verwijdert een oude step-query zonder een canonieke update te overschrijven", () => {
    const canonicalUpdateId = "55555555-5555-4555-8555-555555555555";
    window.history.replaceState(
      null,
      "",
      `/project/${PROJECT_ID}?step=${UPDATE_ID}&update=${canonicalUpdateId}`,
    );
    render(<TripDetail />);

    expect(screen.getByTestId("route-normalization")).toHaveTextContent(
      `/project/${PROJECT_ID}?update=${canonicalUpdateId}`,
    );
  });
});
