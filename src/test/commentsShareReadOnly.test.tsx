import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CommentsSheet from "@/components/CommentsSheet";
import { useAuth } from "@/hooks/useAuth";
import {
  useCreateCommentMutation,
  useDeleteCommentMutation,
  useInfiniteComments,
} from "@/hooks/useEngagement";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: vi.fn(),
}));
vi.mock("@/hooks/useEngagement", () => ({
  useInfiniteComments: vi.fn(),
  useCreateCommentMutation: vi.fn(),
  useDeleteCommentMutation: vi.fn(),
}));
vi.mock("@/components/moderation/ReportDialog", () => ({
  default: ({ targetId }: { targetId: string }) => <button type="button">Meld {targetId}</button>,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const UPDATE_ID = "22222222-2222-4222-8222-222222222222";
const COMMENT_ID = "33333333-3333-4333-8333-333333333333";

describe("share-link comment controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", `/project/${PROJECT_ID}?update=${UPDATE_ID}`);
    vi.mocked(useAuth).mockReturnValue({ user: null } as ReturnType<typeof useAuth>);
  });

  afterEach(cleanup);

  it("houdt een anonieme shareviewer read-only en biedt een duidelijke login", () => {
    const create = vi.fn();
    const remove = vi.fn();
    vi.mocked(useInfiniteComments).mockReturnValue({
      data: {
        pages: [{
          projectId: PROJECT_ID,
          updateId: UPDATE_ID,
          items: [{
            id: COMMENT_ID,
            projectId: PROJECT_ID,
            updateId: UPDATE_ID,
            parentCommentId: null,
            author: {
              id: "44444444-4444-4444-8444-444444444444",
              displayName: "Noor",
              slug: "noor-bouwt",
              avatar: null,
            },
            body: "De keuken wordt prachtig.",
            mentionCount: 0,
            version: 1,
            canDelete: true,
            createdAt: "2026-08-23T10:00:00.000Z",
            updatedAt: "2026-08-23T10:00:00.000Z",
          }],
          nextCursor: null,
        }],
      },
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      refetch: vi.fn(),
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useInfiniteComments>);
    vi.mocked(useCreateCommentMutation).mockReturnValue({
      isPending: false,
      mutateAsync: create,
    } as unknown as ReturnType<typeof useCreateCommentMutation>);
    vi.mocked(useDeleteCommentMutation).mockReturnValue({
      isPending: false,
      mutateAsync: remove,
    } as unknown as ReturnType<typeof useDeleteCommentMutation>);

    render(
      <CommentsSheet
        projectId={PROJECT_ID}
        updateId={UPDATE_ID}
        canComment={false}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText("De keuken wordt prachtig.")).toBeInTheDocument();
    expect(screen.getByText(/Log in om te reageren/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inloggen" })).toHaveAttribute(
      "href",
      `/auth?next=${encodeURIComponent(`/project/${PROJECT_ID}?update=${UPDATE_ID}`)}`,
    );
    expect(screen.queryByRole("button", { name: /antwoord op|verwijderen/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Nieuwe reactie")).not.toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("laat een ingelogde shareviewer reageren en een servergemachtigde reactie verwijderen", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: "provider-user" },
    } as unknown as ReturnType<typeof useAuth>);
    const create = vi.fn().mockResolvedValue({ commentId: COMMENT_ID, replayed: false });
    const remove = vi.fn().mockResolvedValue({ commentId: COMMENT_ID, replayed: false });
    vi.mocked(useInfiniteComments).mockReturnValue({
      data: {
        pages: [{
          projectId: PROJECT_ID,
          updateId: UPDATE_ID,
          items: [{
            id: COMMENT_ID,
            projectId: PROJECT_ID,
            updateId: UPDATE_ID,
            parentCommentId: null,
            author: {
              id: "44444444-4444-4444-8444-444444444444",
              displayName: "Noor",
              slug: "noor-bouwt",
              avatar: null,
            },
            body: "De keuken wordt prachtig.",
            mentionCount: 0,
            version: 1,
            canDelete: true,
            createdAt: "2026-08-23T10:00:00.000Z",
            updatedAt: "2026-08-23T10:00:00.000Z",
          }],
          nextCursor: null,
        }],
      },
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      refetch: vi.fn(),
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useInfiniteComments>);
    vi.mocked(useCreateCommentMutation).mockReturnValue({
      isPending: false,
      mutateAsync: create,
    } as unknown as ReturnType<typeof useCreateCommentMutation>);
    vi.mocked(useDeleteCommentMutation).mockReturnValue({
      isPending: false,
      mutateAsync: remove,
    } as unknown as ReturnType<typeof useDeleteCommentMutation>);

    render(
      <CommentsSheet
        projectId={PROJECT_ID}
        updateId={UPDATE_ID}
        canComment
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Nieuwe reactie")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Antwoord op Noor" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reactie van Noor verwijderen" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith({
      commentId: COMMENT_ID,
      input: expect.objectContaining({ expectedVersion: 1 }),
    }));
  });
});
