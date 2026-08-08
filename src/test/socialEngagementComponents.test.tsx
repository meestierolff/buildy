import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReactionBar from "@/components/ReactionBar";
import RequestAccessCard from "@/components/RequestAccessCard";
import NotificationBell from "@/components/NotificationBell";
import { useAuth } from "@/hooks/useAuth";
import {
  useInfiniteNotifications,
  useNotificationMutation,
  useReactionMutation,
  useReactionSummary,
} from "@/hooks/useEngagement";
import {
  useProjectAccessMutation,
  useSocialProjectState,
  useSocialRequestDecisionMutation,
} from "@/hooks/useSocial";
import { BrowserRouter } from "@/lib/router";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useEngagement", () => ({
  useInfiniteNotifications: vi.fn(),
  useNotificationMutation: vi.fn(),
  useReactionMutation: vi.fn(),
  useReactionSummary: vi.fn(),
}));
vi.mock("@/hooks/useSocial", () => ({
  useProjectAccessMutation: vi.fn(),
  useSocialProjectState: vi.fn(),
  useSocialRequestDecisionMutation: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const UPDATE_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_ID = "33333333-3333-4333-8333-333333333333";
const NOTIFICATION_ID = "44444444-4444-4444-8444-444444444444";

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
});

describe("RequestAccessCard via social-API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue(authValue(true));
  });

  it("toont geen projectmetadata en laat een bevestigd pending-verzoek intrekken", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ replayed: false, state: "cancelled" });
    vi.mocked(useSocialProjectState).mockReturnValue({
      data: {
        projectId: PROJECT_ID,
        viewerRole: "viewer",
        followStatus: "none",
        accessStatus: "pending",
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSocialProjectState>);
    vi.mocked(useProjectAccessMutation).mockReturnValue({
      isPending: false,
      mutateAsync,
    } as unknown as ReturnType<typeof useProjectAccessMutation>);

    render(
      <BrowserRouter>
        <RequestAccessCard projectId={PROJECT_ID} />
      </BrowserRouter>,
    );

    expect(screen.getByRole("heading", { name: "Privéproject" })).toBeInTheDocument();
    expect(screen.queryByText(/keuken|badkamer/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Verzoek intrekken" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ action: "cancel", projectId: PROJECT_ID }));
  });
});

describe("NotificationBell via engagement- en social-API", () => {
  it("behandelt een profielverzoek en archiveert daarna de melding", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(true));
    vi.mocked(useInfiniteNotifications).mockReturnValue({
      data: {
        pages: [{
          items: [{
            id: NOTIFICATION_ID,
            type: "profile.follow.requested",
            status: "unread",
            actor: {
              id: PROFILE_ID,
              displayName: "Sam",
              slug: "sam-bouwt",
              avatar: null,
            },
            projectId: null,
            updateId: null,
            commentId: null,
            readAt: null,
            createdAt: new Date().toISOString(),
          }],
          nextCursor: null,
        }],
        pageParams: [undefined],
      },
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      refetch: vi.fn(),
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useInfiniteNotifications>);
    const notificationMutation = vi.fn().mockResolvedValue({
      notificationId: NOTIFICATION_ID,
      status: "read",
      replayed: false,
    });
    vi.mocked(useNotificationMutation).mockReturnValue({
      mutateAsync: notificationMutation,
    } as unknown as ReturnType<typeof useNotificationMutation>);
    const decide = vi.fn().mockResolvedValue({ replayed: false, state: "accepted" });
    vi.mocked(useSocialRequestDecisionMutation).mockReturnValue({
      mutateAsync: decide,
    } as unknown as ReturnType<typeof useSocialRequestDecisionMutation>);

    render(
      <BrowserRouter>
        <NotificationBell />
      </BrowserRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Meldingen, 1 ongelezen" }));
    expect(await screen.findByText("Sam wil je volgen")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Goedkeuren" }));

    await waitFor(() => expect(decide).toHaveBeenCalledWith({
      kind: "profile",
      decision: "accept",
      actorId: PROFILE_ID,
    }));
    await waitFor(() => expect(notificationMutation).toHaveBeenCalledWith({
      action: "archive",
      notificationId: NOTIFICATION_ID,
    }));
    expect(notificationMutation).toHaveBeenCalledWith({
      action: "read",
      notificationId: NOTIFICATION_ID,
    });
  });
});
