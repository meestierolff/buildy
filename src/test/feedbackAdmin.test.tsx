// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/hooks/useAuth";
import {
  useFeedbackAdminDetail,
  useFeedbackAdminSession,
  useFeedbackAdminStatusMutation,
  useInfiniteFeedbackAdminQueue,
} from "@/hooks/useFeedbackAdmin";
import { ApiClientError } from "@/lib/apiClient";
import { BrowserRouter, Route } from "@/lib/router";
import FeedbackAdmin from "@/pages/FeedbackAdmin";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useFeedbackAdmin", () => ({
  useFeedbackAdminDetail: vi.fn(),
  useFeedbackAdminSession: vi.fn(),
  useFeedbackAdminStatusMutation: vi.fn(),
  useInfiniteFeedbackAdminQueue: vi.fn(),
}));
vi.mock("@/lib/clientIdempotency", () => ({
  createClientIdempotencyKey: () => "feedback-ui-command-0001",
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const SUBMISSION_ID = "22222222-2222-4222-8222-222222222222";

function authenticatedAdmin() {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: ADMIN_ID },
    loading: false,
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(useFeedbackAdminSession).mockReturnValue({
    data: { appUserId: ADMIN_ID, role: "admin", grantExpiresAt: null },
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useFeedbackAdminSession>);
}

function queueResult(overrides: Record<string, unknown> = {}) {
  vi.mocked(useInfiniteFeedbackAdminQueue).mockReturnValue({
    data: { pages: [{ items: [], nextCursor: null }] },
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useInfiniteFeedbackAdminQueue>);
}

function detailResult(overrides: Record<string, unknown> = {}) {
  vi.mocked(useFeedbackAdminDetail).mockReturnValue({
    data: {
      id: SUBMISSION_ID,
      receiptCode: "HELP-22222222",
      kind: "support",
      category: "privacy",
      status: "new",
      version: 1,
      hasContact: true,
      authenticated: false,
      createdAt: "2026-08-23T12:00:00.000Z",
      updatedAt: "2026-08-23T12:00:00.000Z",
      resolvedAt: null,
      message: "Help mij met mijn privacyverzoek.",
      contactEmail: "private-contact@example.test",
      reviews: [],
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useFeedbackAdminDetail>);
}

describe("feedback admin UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticatedAdmin();
    queueResult();
    detailResult();
    vi.mocked(useFeedbackAdminStatusMutation).mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn().mockResolvedValue({}),
    } as unknown as ReturnType<typeof useFeedbackAdminStatusMutation>);
    window.history.replaceState(null, "", "/beheer/feedback");
  });

  afterEach(cleanup);

  it("shows a denial state without rendering queue metadata", () => {
    vi.mocked(useFeedbackAdminSession).mockReturnValue({
      isPending: false,
      isError: true,
      error: new ApiClientError({
        code: "FORBIDDEN",
        message: "Beheerrol vereist.",
        status: 403,
      }),
    } as unknown as ReturnType<typeof useFeedbackAdminSession>);

    render(<BrowserRouter><FeedbackAdmin /></BrowserRouter>);
    expect(screen.getByRole("heading", { name: "Geen toegang" })).toBeInTheDocument();
    expect(screen.queryByText("Feedback & support")).not.toBeInTheDocument();
  });

  it("renders useful loading, error and empty queue states", () => {
    queueResult({ data: undefined, isPending: true });
    const view = render(<BrowserRouter><FeedbackAdmin /></BrowserRouter>);
    expect(screen.getByRole("status")).toHaveTextContent("Inzendingen laden");

    const refetch = vi.fn();
    queueResult({ data: undefined, isPending: false, isError: true, refetch });
    view.rerender(<BrowserRouter><FeedbackAdmin /></BrowserRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
    expect(refetch).toHaveBeenCalledOnce();

    queueResult();
    view.rerender(<BrowserRouter><FeedbackAdmin /></BrowserRouter>);
    expect(screen.getByRole("heading", { name: "Geen inzendingen in deze wachtrij" })).toBeInTheDocument();
  });

  it("renders only metadata in queue rows and links by opaque UUID", () => {
    queueResult({
      data: {
        pages: [{
          items: [{
            id: SUBMISSION_ID,
            receiptCode: "HELP-22222222",
            kind: "support",
            category: "privacy",
            status: "new",
            version: 1,
            hasContact: true,
            authenticated: false,
            createdAt: "2026-08-23T12:00:00.000Z",
            updatedAt: "2026-08-23T12:00:00.000Z",
          }],
          nextCursor: null,
        }],
      },
    });

    render(<BrowserRouter><FeedbackAdmin /></BrowserRouter>);
    expect(screen.getByLabelText("Status")).toBeInstanceOf(HTMLSelectElement);
    expect(screen.getByLabelText("Type")).toBeInstanceOf(HTMLSelectElement);
    expect(screen.queryByText("private-contact@example.test")).not.toBeInTheDocument();
    expect(screen.queryByText("Help mij met mijn privacyverzoek.")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open inzending/ }))
      .toHaveAttribute("href", `/beheer/feedback/${SUBMISSION_ID}`);
  });

  it("reveals decrypted fields only on detail and submits expectedVersion idempotently", async () => {
    window.history.replaceState(null, "", `/beheer/feedback/${SUBMISSION_ID}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    const mutateAsync = vi.fn().mockResolvedValue({});
    vi.mocked(useFeedbackAdminStatusMutation).mockReturnValue({
      isPending: false,
      mutateAsync,
    } as unknown as ReturnType<typeof useFeedbackAdminStatusMutation>);

    render(
      <BrowserRouter>
        <Route path="/beheer/feedback/:submissionId" element={<FeedbackAdmin />} />
      </BrowserRouter>,
    );
    expect(screen.getByText("Help mij met mijn privacyverzoek.")).toBeInTheDocument();
    expect(screen.getByText("private-contact@example.test")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nieuwe status"), { target: { value: "triaged" } });
    fireEvent.click(screen.getByRole("button", { name: "Status bevestigen" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({
      idempotencyKey: "feedback-ui-command-0001",
      expectedVersion: 1,
      status: "triaged",
    }));
  });
});
