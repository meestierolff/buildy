import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectUpdate } from "../../shared/contracts/projects";
import AllPhotosTab from "@/components/AllPhotosTab";
import BlueprintTimeline from "@/components/BlueprintTimeline";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/ReactionBar", () => ({
  default: ({ projectId, updateId, canReact }: {
    projectId: string;
    updateId: string;
    canReact?: boolean;
  }) => (
    <div data-testid="reaction-bar" data-can-react={String(canReact)}>{projectId}:{updateId}</div>
  ),
}));
vi.mock("@/components/CommentsSheet", () => ({
  default: ({ projectId, updateId, open, canComment }: {
    projectId: string;
    updateId: string;
    open: boolean;
    canComment?: boolean;
  }) => (
    <div data-testid="comments-sheet" data-can-comment={String(canComment)}>
      {projectId}:{updateId}:{open ? "open" : "closed"}
    </div>
  ),
}));
vi.mock("@/components/MediaLightbox", () => ({
  default: ({ items }: { items: Array<{ url: string }> }) => (
    <div data-testid="media-lightbox">{items.map((item) => item.url).join(",")}</div>
  ),
}));
vi.mock("@/components/BeforeAfterSlider", () => ({
  default: ({ beforeUrl, afterUrl }: { beforeUrl: string; afterUrl: string }) => (
    <div data-testid="before-after">{beforeUrl}:{afterUrl}</div>
  ),
}));
vi.mock("@/components/moderation/ReportDialog", () => ({
  default: ({ targetType, targetId }: { targetType: string; targetId: string }) => (
    <button type="button" data-testid={`report-${targetType}`}>Meld {targetId}</button>
  ),
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const UPDATE_ID = "22222222-2222-4222-8222-222222222222";
const MEDIA_ID = "33333333-3333-4333-8333-333333333333";

const update: ProjectUpdate = {
  id: UPDATE_ID,
  projectId: PROJECT_ID,
  phase: {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Sloopwerk",
    sortOrder: 0,
    isCustom: false,
  },
  title: "Keuken gestript",
  room: "Keuken",
  description: "De oude keuken is verwijderd.",
  updateDate: "2026-08-04",
  status: "draft",
  isMilestone: true,
  sortOrder: 0,
  contentRevision: 1,
  version: 1,
  publishedAt: null,
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

describe("BlueprintTimeline typed engagement boundary", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", `/project/${PROJECT_ID}`);
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(cleanup);

  it("rendert proxy-media en gebruikt uitsluitend de centrale reaction/comment-controls", () => {
    render(<BlueprintTimeline updates={[update]} projectId={PROJECT_ID} />);

    expect(screen.getByRole("img", { name: "Foto bij Keuken gestript" })).toHaveAttribute(
      "src",
      `/api/media/${MEDIA_ID}`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Keuken gestript uitklappen" }));

    expect(screen.getByTestId("reaction-bar")).toHaveTextContent(`${PROJECT_ID}:${UPDATE_ID}`);
    expect(screen.getByTestId("report-update")).toHaveTextContent(UPDATE_ID);
    expect(screen.getByText("Concept")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /like|bewerken|verwijderen|fotovolgorde/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reacties openen" }));
    expect(screen.getByTestId("comments-sheet")).toHaveTextContent(":open");
  });

  it("toont de bewerkactie uitsluitend binnen een expliciete owner-capability", () => {
    const onEdit = vi.fn();
    const { rerender } = render(
      <BlueprintTimeline updates={[update]} projectId={PROJECT_ID} canEdit={false} onEdit={onEdit} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Keuken gestript uitklappen" }));
    expect(screen.queryByRole("button", { name: "Keuken gestript bewerken" })).not.toBeInTheDocument();

    rerender(
      <BlueprintTimeline updates={[update]} projectId={PROJECT_ID} canEdit onEdit={onEdit} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Keuken gestript bewerken" }));
    expect(onEdit).toHaveBeenCalledWith(update);
  });

  it("houdt een tijdelijke deellink echt alleen-lezen en kopieert geen kale UUID-link", () => {
    render(
      <BlueprintTimeline
        updates={[update]}
        projectId={PROJECT_ID}
        canEngage={false}
        canCopyUpdateLink={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Keuken gestript uitklappen" }));

    expect(screen.queryByRole("button", { name: "Link naar Bouwmoment kopiëren" })).not.toBeInTheDocument();
    expect(screen.getByTestId("reaction-bar")).toHaveAttribute("data-can-react", "false");
    expect(screen.getByTestId("comments-sheet")).toHaveAttribute("data-can-comment", "false");
  });
});

describe("AllPhotosTab typed media boundary", () => {
  afterEach(cleanup);

  it("bouwt de galerij rechtstreeks uit private proxy descriptors", () => {
    render(<AllPhotosTab projectId={PROJECT_ID} updates={[update]} />);

    expect(screen.getByRole("img", { name: "Keuken gestript" })).toHaveAttribute(
      "src",
      `/api/media/${MEDIA_ID}`,
    );
    expect(screen.getByRole("button", { name: "Sloopwerk" })).toHaveAttribute("aria-pressed", "false");
  });
});
