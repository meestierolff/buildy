// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/hooks/useAuth";
import {
  useInfiniteModerationAdminQueue,
  useModerationAdminActionMutation,
  useModerationAdminReport,
  useModerationAdminSession,
} from "@/hooks/useModeration";
import { ApiClientError } from "@/lib/apiClient";
import { BrowserRouter, Route } from "@/lib/router";
import ModerationAdmin from "@/pages/ModerationAdmin";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useModeration", () => ({
  useInfiniteModerationAdminQueue: vi.fn(),
  useModerationAdminActionMutation: vi.fn(),
  useModerationAdminReport: vi.fn(),
  useModerationAdminSession: vi.fn(),
}));
vi.mock("@/lib/clientIdempotency", () => ({
  createClientIdempotencyKey: () => "moderation-ui-key-0001",
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const REPORT_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";

function authenticatedUser() {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: TARGET_ID },
    loading: false,
  } as unknown as ReturnType<typeof useAuth>);
}

function adminSession() {
  vi.mocked(useModerationAdminSession).mockReturnValue({
    data: { appUserId: TARGET_ID, role: "moderator", grantExpiresAt: null },
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useModerationAdminSession>);
}

function queueResult(overrides: Record<string, unknown> = {}) {
  vi.mocked(useInfiniteModerationAdminQueue).mockReturnValue({
    data: { pages: [{ items: [], nextCursor: null }] },
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useInfiniteModerationAdminQueue>);
}

describe("moderation admin UI states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticatedUser();
    adminSession();
    queueResult();
    vi.mocked(useModerationAdminReport).mockReturnValue({
      isPending: false,
      isError: true,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useModerationAdminReport>);
    vi.mocked(useModerationAdminActionMutation).mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    } as unknown as ReturnType<typeof useModerationAdminActionMutation>);
    window.history.replaceState(null, "", "/beheer/moderatie");
  });

  afterEach(cleanup);

  it("shows a non-enumerating access state to ordinary users", () => {
    vi.mocked(useModerationAdminSession).mockReturnValue({
      isPending: false,
      isError: true,
      error: new ApiClientError({
        code: "FORBIDDEN",
        message: "Je hebt geen actieve moderatierol.",
        status: 403,
      }),
    } as unknown as ReturnType<typeof useModerationAdminSession>);

    render(<BrowserRouter><ModerationAdmin /></BrowserRouter>);
    expect(screen.getByRole("heading", { name: "Geen toegang" })).toBeInTheDocument();
    expect(screen.queryByText("Moderatiewachtrij")).not.toBeInTheDocument();
  });

  it("renders loading, error and empty queue states with retry controls", () => {
    queueResult({ data: undefined, isPending: true });
    const view = render(<BrowserRouter><ModerationAdmin /></BrowserRouter>);
    expect(screen.getByRole("status")).toHaveTextContent("Meldingen laden");

    const refetch = vi.fn();
    queueResult({ data: undefined, isPending: false, isError: true, refetch });
    view.rerender(<BrowserRouter><ModerationAdmin /></BrowserRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
    expect(refetch).toHaveBeenCalledOnce();

    queueResult();
    view.rerender(<BrowserRouter><ModerationAdmin /></BrowserRouter>);
    expect(screen.getByRole("heading", { name: "Geen meldingen in deze wachtrij" })).toBeInTheDocument();
  });

  it("uses native keyboard-focusable links and labelled queue filters", () => {
    queueResult({
      data: {
        pages: [{
          items: [{
            id: REPORT_ID,
            receiptCode: "MELD-11111111",
            targetType: "profile",
            targetId: TARGET_ID,
            reason: "privacy",
            urgency: "high",
            status: "open",
            version: 1,
            targetHidden: false,
            createdAt: "2026-08-04T12:00:00.000Z",
            updatedAt: "2026-08-04T12:00:00.000Z",
          }],
          nextCursor: null,
        }],
      },
    });

    render(<BrowserRouter><ModerationAdmin /></BrowserRouter>);
    expect(screen.getByLabelText("Status")).toBeInstanceOf(HTMLSelectElement);
    expect(screen.getByLabelText("Urgentie")).toBeInstanceOf(HTMLSelectElement);
    expect(screen.getByLabelText("Type inhoud")).toBeInstanceOf(HTMLSelectElement);
    const link = screen.getByRole("link", { name: /Open melding/ });
    expect(link).toHaveAttribute("href", `/beheer/moderatie/${REPORT_ID}`);
    link.focus();
    expect(link).toHaveFocus();
  });

  it("does not offer admin-only suspension or block actions to a moderator", () => {
    window.history.replaceState(null, "", `/beheer/moderatie/${REPORT_ID}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    vi.mocked(useModerationAdminReport).mockReturnValue({
      data: {
        id: REPORT_ID,
        receiptCode: "MELD-11111111",
        targetType: "profile",
        targetId: TARGET_ID,
        reason: "privacy",
        urgency: "high",
        status: "open",
        version: 1,
        targetHidden: false,
        createdAt: "2026-08-04T12:00:00.000Z",
        updatedAt: "2026-08-04T12:00:00.000Z",
        details: null,
        targetSnapshot: { schemaVersion: 1 },
        actions: [],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useModerationAdminReport>);

    render(
      <BrowserRouter>
        <Route path="/beheer/moderatie/:reportId" element={<ModerationAdmin />} />
      </BrowserRouter>,
    );
    const actionSelect = screen.getByLabelText("Actie");
    expect(actionSelect).not.toHaveTextContent("Account schorsen");
    expect(actionSelect).not.toHaveTextContent("Account blokkeren");
    expect(screen.getByLabelText("Motivering")).toBeRequired();
  });
});
