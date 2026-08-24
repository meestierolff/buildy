import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "@/hooks/useAuth";
import {
  useInfiniteNotifications,
  useMarkAllNotificationsReadMutation,
  useNotificationMutation,
} from "@/hooks/useEngagement";
import { useSocialRequestDecisionMutation } from "@/hooks/useSocial";
import { BrowserRouter } from "@/lib/router";
import Notifications from "@/pages/Notifications";
import type { EngagementNotification } from "../../shared/contracts/engagement";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: vi.fn() }));
vi.mock("@/hooks/useEngagement", () => ({
  useInfiniteNotifications: vi.fn(),
  useMarkAllNotificationsReadMutation: vi.fn(),
  useNotificationMutation: vi.fn(),
}));
vi.mock("@/hooks/useSocial", () => ({ useSocialRequestDecisionMutation: vi.fn() }));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const UPDATE_ID = "22222222-2222-4222-8222-222222222222";
const NOTIFICATION_ID = "33333333-3333-4333-8333-333333333333";

const notification: EngagementNotification = {
  id: NOTIFICATION_ID,
  type: "comment.created",
  status: "unread",
  actor: {
    id: "44444444-4444-4444-8444-444444444444",
    displayName: "Ada",
    slug: "ada-bouwer",
    avatar: null,
  },
  projectId: PROJECT_ID,
  updateId: UPDATE_ID,
  commentId: "55555555-5555-4555-8555-555555555555",
  orderId: null,
  readAt: null,
  createdAt: "2026-08-04T10:00:00.000Z",
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
          id: "66666666-6666-4666-8666-666666666666",
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

describe("notifications page", () => {
  const mutateAsync = vi.fn().mockResolvedValue({
    notificationId: NOTIFICATION_ID,
    status: "read",
    replayed: false,
  });
  const fetchNextPage = vi.fn();
  const markAllRead = vi.fn().mockResolvedValue({ updatedCount: 31, unreadCount: 0 });

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/notificaties");
    vi.mocked(useNotificationMutation).mockReturnValue({
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useNotificationMutation>);
    vi.mocked(useMarkAllNotificationsReadMutation).mockReturnValue({
      mutateAsync: markAllRead,
      isPending: false,
    } as unknown as ReturnType<typeof useMarkAllNotificationsReadMutation>);
    vi.mocked(useSocialRequestDecisionMutation).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useSocialRequestDecisionMutation>);
    vi.mocked(useInfiniteNotifications).mockReturnValue({
      data: {
        pages: [{ items: [notification], nextCursor: "cursor-2", unreadCount: 31 }],
        pageParams: [undefined],
      },
      isPending: false,
      isError: false,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useInfiniteNotifications>);
  });

  it("uses typed pagination and canonical safe notification links", async () => {
    vi.mocked(useAuth).mockReturnValue(auth(true));
    render(<BrowserRouter><Notifications /></BrowserRouter>);

    expect(screen.getByRole("link", { name: /ada reageerde op je Bouwmoment/i }))
      .toHaveAttribute("href", `/project/${PROJECT_ID}?update=${UPDATE_ID}`);
    fireEvent.click(screen.getByRole("button", { name: "Markeer als gelezen" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({
      action: "read",
      notificationId: NOTIFICATION_ID,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Meer meldingen laden" }));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Alles gelezen" }));
    await waitFor(() => expect(markAllRead).toHaveBeenCalledTimes(1));
  });

  it("requires a cookie-backed authenticated session", async () => {
    vi.mocked(useAuth).mockReturnValue(auth(false));
    render(<BrowserRouter><Notifications /></BrowserRouter>);

    await waitFor(() => expect(window.location.pathname).toBe("/auth"));
    expect(new URLSearchParams(window.location.search).get("next")).toBe("/notificaties");
  });
});
