import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReactionBar from "@/components/ReactionBar";
import { useAuth } from "@/hooks/useAuth";
import {
  useReactionMutation,
  useReactionSummary,
} from "@/hooks/useEngagement";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useEngagement", () => ({
  useReactionMutation: vi.fn(),
  useReactionSummary: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const UPDATE_ID = "22222222-2222-4222-8222-222222222222";

function authValue(authenticated: boolean): ReturnType<typeof useAuth> {
  return {
    error: null,
    loading: false,
    refreshing: false,
    refetchSession: vi.fn(),
    session: authenticated
      ? {
          id: "session",
          userId: "provider-user",
          expiresAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      : null,
    signOut: vi.fn(),
    user: authenticated
      ? {
          id: "provider-user",
          name: "Noor",
          email: "noor@example.com",
          username: "test-eigenaar",
          emailVerified: true,
          image: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          user_metadata: { display_name: "Noor", full_name: "Noor" },
        }
      : null,
  };
}

describe("ReactionBar via engagement-API", () => {
  const mutateAsync = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue(authValue(true));
    vi.mocked(useReactionSummary).mockReturnValue({
      data: {
        projectId: PROJECT_ID,
        updateId: UPDATE_ID,
        target: "update",
        commentId: null,
        items: [{ emoji: "🔨", count: 2, viewerReacted: true }],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useReactionSummary>);
    vi.mocked(useReactionMutation).mockReturnValue({
      isPending: false,
      mutateAsync,
    } as unknown as ReturnType<typeof useReactionMutation>);
  });

  it("rendert serveraggregaten en verwijdert alleen de eigen servergemarkeerde reactie", async () => {
    render(<ReactionBar projectId={PROJECT_ID} updateId={UPDATE_ID} />);

    fireEvent.click(screen.getByRole("button", { name: "Verwijder reactie 🔨, 2" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({
      action: "remove",
      input: { target: "update", emoji: "🔨" },
    }));
  });

  it("blijft gesloten wanneer de projectcontext ontbreekt", () => {
    render(<ReactionBar updateId={UPDATE_ID} />);
    expect(screen.getByText("Reacties niet beschikbaar")).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("toont aantallen via een deellink zonder reactieknoppen of mutation", () => {
    vi.mocked(useAuth).mockReturnValue(authValue(false));
    window.history.replaceState(null, "", `/project/${PROJECT_ID}?update=${UPDATE_ID}`);
    render(<ReactionBar projectId={PROJECT_ID} updateId={UPDATE_ID} canReact={false} />);

    expect(screen.getByLabelText("Reactie 🔨, 2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reactie/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inloggen om te reageren" })).toHaveAttribute(
      "href",
      `/auth?next=${encodeURIComponent(`/project/${PROJECT_ID}?update=${UPDATE_ID}`)}`,
    );
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
