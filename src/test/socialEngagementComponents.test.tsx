import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReactionBar from "@/components/ReactionBar";
import NotificationBell from "@/components/NotificationBell";
import { useAuth } from "@/hooks/useAuth";
import {
  useInfiniteNotifications,
  useMarkAllNotificationsReadMutation,
  useNotificationMutation,
  useReactionMutation,
  useReactionSummary,
} from "@/hooks/useEngagement";
import {
  useSocialRequestDecisionMutation,
} from "@/hooks/useSocial";
import { BrowserRouter } from "@/lib/router";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useEngagement", () => ({
  useInfiniteNotifications: vi.fn(),
  useMarkAllNotificationsReadMutation: vi.fn(),
  useNotificationMutation: vi.fn(),
  useReactionMutation: vi.fn(),
  useReactionSummary: vi.fn(),
}));
vi.mock("@/hooks/useSocial", () => ({
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

  it("toont aantallen via een deellink zonder reactieknoppen of mutation", () => {
    render(<ReactionBar projectId={PROJECT_ID} updateId={UPDATE_ID} canReact={false} />);

    expect(screen.getByLabelText("Reactie 🔨, 2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reactie/i })).not.toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
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
            orderId: null,
            readAt: null,
            createdAt: new Date().toISOString(),
          }],
          nextCursor: null,
          unreadCount: 12,
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
    const markAllRead = vi.fn().mockResolvedValue({ updatedCount: 12, unreadCount: 0 });
    vi.mocked(useMarkAllNotificationsReadMutation).mockReturnValue({
      mutateAsync: markAllRead,
      isPending: false,
    } as unknown as ReturnType<typeof useMarkAllNotificationsReadMutation>);
    const decide = vi.fn().mockResolvedValue({ replayed: false, state: "following" });
    vi.mocked(useSocialRequestDecisionMutation).mockReturnValue({
      mutateAsync: decide,
    } as unknown as ReturnType<typeof useSocialRequestDecisionMutation>);

    render(
      <BrowserRouter>
        <NotificationBell />
      </BrowserRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Meldingen, 12 ongelezen" }));
    expect(await screen.findByText("Sam wil je volgen")).toBeInTheDocument();
    await waitFor(() => expect(markAllRead).toHaveBeenCalledTimes(1));
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
    expect(notificationMutation).toHaveBeenCalledTimes(1);
  });
});
