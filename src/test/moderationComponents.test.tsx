// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTENT_POLICY_VERSION,
  SUPPORT_PRIVACY_NOTICE_VERSION,
} from "../../shared/contracts/moderation";
import ReportDialog from "@/components/moderation/ReportDialog";
import SupportForm from "@/components/moderation/SupportForm";
import {
  useSubmitFeedbackMutation,
  useSubmitModerationReportMutation,
  useSubmitSupportMutation,
} from "@/hooks/useModeration";

vi.mock("@/hooks/useModeration", () => ({
  useSubmitFeedbackMutation: vi.fn(),
  useSubmitModerationReportMutation: vi.fn(),
  useSubmitSupportMutation: vi.fn(),
}));
vi.mock("@/lib/clientIdempotency", () => ({
  createClientIdempotencyKey: () => "community-ui-key-0001",
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const TARGET_ID = "11111111-1111-4111-8111-111111111111";

function mutationResult(mutateAsync: ReturnType<typeof vi.fn>) {
  return {
    data: undefined,
    isError: false,
    isPending: false,
    mutateAsync,
  };
}

describe("community safety forms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/project/22222222-2222-4222-8222-222222222222");
    vi.mocked(useSubmitFeedbackMutation).mockReturnValue(
      mutationResult(vi.fn()) as unknown as ReturnType<typeof useSubmitFeedbackMutation>,
    );
  });

  afterEach(cleanup);

  it("requires policy acknowledgement and submits only the typed target report", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      id: TARGET_ID,
      receiptCode: "MELD-11111111",
      status: "received",
      submittedAt: "2026-08-04T12:00:00.000Z",
      replayed: false,
    });
    vi.mocked(useSubmitModerationReportMutation).mockReturnValue(
      mutationResult(mutateAsync) as unknown as ReturnType<typeof useSubmitModerationReportMutation>,
    );
    vi.mocked(useSubmitSupportMutation).mockReturnValue(
      mutationResult(vi.fn()) as unknown as ReturnType<typeof useSubmitSupportMutation>,
    );

    render(
      <ReportDialog
        targetType="comment"
        targetId={TARGET_ID}
        targetLabel="Reactie van Noor"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Melden" }));

    const submit = screen.getByRole("button", { name: "Melding versturen" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Toelichting/), {
      target: { value: "Deze reactie bevat privégegevens." },
    });
    fireEvent.change(screen.getByLabelText(/E-mail voor eventueel contact/), {
      target: { value: "melder@example.test" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Ik heb het contentbeleid gelezen" }));
    fireEvent.click(submit);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledOnce());
    expect(mutateAsync).toHaveBeenCalledWith({
      idempotencyKey: "community-ui-key-0001",
      targetType: "comment",
      targetId: TARGET_ID,
      reason: "privacy",
      details: "Deze reactie bevat privégegevens.",
      contactEmail: "melder@example.test",
      route: "/project/22222222-2222-4222-8222-222222222222",
      policyVersion: CONTENT_POLICY_VERSION,
      website: "",
    });
  });

  it("makes a reply address and explicit privacy acknowledgement mandatory for third-party requests", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      id: TARGET_ID,
      receiptCode: "HELP-11111111",
      kind: "third_party_request",
      status: "received",
      submittedAt: "2026-08-04T12:00:00.000Z",
      replayed: false,
    });
    vi.mocked(useSubmitSupportMutation).mockReturnValue(
      mutationResult(mutateAsync) as unknown as ReturnType<typeof useSubmitSupportMutation>,
    );
    vi.mocked(useSubmitModerationReportMutation).mockReturnValue(
      mutationResult(vi.fn()) as unknown as ReturnType<typeof useSubmitModerationReportMutation>,
    );
    window.history.replaceState(null, "", "/support");

    render(<SupportForm initialKind="third_party_request" />);
    const submit = screen.getByRole("button", { name: "Bericht versturen" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Onderwerp"), { target: { value: "privacy" } });
    fireEvent.change(screen.getByLabelText("E-mailadres"), {
      target: { value: "betrokkene@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Je bericht"), {
      target: { value: "Ik sta herkenbaar op een foto en wil verwijdering aanvragen." },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Ik ga akkoord met verwerking voor mijn verzoek" }));
    fireEvent.click(submit);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledOnce());
    expect(mutateAsync).toHaveBeenCalledWith({
      idempotencyKey: "community-ui-key-0001",
      kind: "third_party_request",
      category: "privacy",
      message: "Ik sta herkenbaar op een foto en wil verwijdering aanvragen.",
      contactEmail: "betrokkene@example.test",
      route: "/support",
      privacyNoticeVersion: SUPPORT_PRIVACY_NOTICE_VERSION,
      website: "",
    });
  });
});
