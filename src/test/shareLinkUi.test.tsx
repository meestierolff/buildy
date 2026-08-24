// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShareLinkDialog } from "@/components/project/ShareLinkDialog";
import { ApiClientError } from "@/lib/apiClient";
import ShareLinkRedeem from "@/pages/ShareLinkRedeem";
import {
  useCreateProjectShareLink,
  useProjectShareLink,
  useRevokeProjectShareLink,
  useRotateProjectShareLink,
} from "@/hooks/useProjectShares";
import { redeemProjectShareLink } from "@/lib/projectShareApi";
import {
  forgetPendingProjectShareToken,
  pendingProjectShareTokenValue,
} from "@/lib/projectShareFragment";

vi.mock("@/hooks/useProjectShares", () => ({
  useProjectShareLink: vi.fn(),
  useCreateProjectShareLink: vi.fn(),
  useRotateProjectShareLink: vi.fn(),
  useRevokeProjectShareLink: vi.fn(),
}));
vi.mock("@/lib/projectShareApi", () => ({ redeemProjectShareLink: vi.fn() }));
vi.mock("@/lib/projectShareFragment", () => ({
  pendingProjectShareTokenValue: vi.fn(),
  forgetPendingProjectShareToken: vi.fn(),
}));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: vi.fn() }));
vi.mock("@/lib/clientIdempotency", () => ({
  createClientIdempotencyKey: (namespace: string) => `${namespace}:ui-test-0001`,
}));
vi.mock("@/lib/router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const LINK_ID = "22222222-2222-4222-8222-222222222222";
const RAW = "a".repeat(43);
const SHARE_URL = `https://buildy.example/delen#toegang=${RAW}`;
const link = {
  id: LINK_ID,
  projectId: PROJECT_ID,
  expiresAt: "2026-08-30T10:00:00.000Z",
  createdAt: "2026-08-23T10:00:00.000Z",
  version: 1,
  state: "active" as const,
};

function mutation(mutateAsync: ReturnType<typeof vi.fn>) {
  return { isPending: false, mutateAsync, reset: vi.fn() };
}

describe("project share owner UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useProjectShareLink).mockReturnValue({
      data: { projectId: PROJECT_ID, link: null },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProjectShareLink>);
    vi.mocked(useCreateProjectShareLink).mockReturnValue(mutation(vi.fn().mockResolvedValue({
      link,
      shareUrl: SHARE_URL,
      replayed: false,
    })) as unknown as ReturnType<typeof useCreateProjectShareLink>);
    vi.mocked(useRotateProjectShareLink).mockReturnValue(mutation(vi.fn()) as unknown as ReturnType<typeof useRotateProjectShareLink>);
    vi.mocked(useRevokeProjectShareLink).mockReturnValue(mutation(vi.fn()) as unknown as ReturnType<typeof useRevokeProjectShareLink>);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(cleanup);

  it("creates and copies the fragment link without exposing it as a project URL", async () => {
    const onCopied = vi.fn();
    render(<ShareLinkDialog open onOpenChange={vi.fn()} onCopied={onCopied} projectId={PROJECT_ID} projectTitle="Ons huis" />);

    fireEvent.click(screen.getByRole("button", { name: "Deellink maken" }));
    expect(await screen.findByText("Je nieuwe link staat klaar")).toBeInTheDocument();
    expect(screen.queryByText(RAW)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Veilige link kopiëren" }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(SHARE_URL));
    expect(onCopied).toHaveBeenCalledOnce();
  });

  it("offers rotate and revoke for an existing grant and explains that the old secret is unrecoverable", async () => {
    const rotate = vi.fn().mockResolvedValue({ link: { ...link, version: 2 }, shareUrl: SHARE_URL, replayed: false });
    const revoke = vi.fn().mockResolvedValue({ projectId: PROJECT_ID, linkId: LINK_ID, version: 2, revoked: true, replayed: false });
    vi.mocked(useProjectShareLink).mockReturnValue({
      data: { projectId: PROJECT_ID, link },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProjectShareLink>);
    vi.mocked(useRotateProjectShareLink).mockReturnValue(mutation(rotate) as unknown as ReturnType<typeof useRotateProjectShareLink>);
    vi.mocked(useRevokeProjectShareLink).mockReturnValue(mutation(revoke) as unknown as ReturnType<typeof useRevokeProjectShareLink>);

    render(<ShareLinkDialog open onOpenChange={vi.fn()} projectId={PROJECT_ID} projectTitle="Ons huis" />);
    expect(screen.getByText(/bewaart de geheime link niet/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Nieuwe link maken" }));
    await waitFor(() => expect(rotate).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 1 })));
    fireEvent.click(screen.getByRole("button", { name: "Link intrekken" }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 1 })));
  });
});

describe("share-link redemption UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pendingProjectShareTokenValue).mockReturnValue(RAW);
  });

  afterEach(cleanup);

  it("shows a useful expired state and forgets the transient bearer", async () => {
    vi.mocked(redeemProjectShareLink).mockRejectedValue(new ApiClientError({
      code: "NOT_FOUND",
      message: "Verlopen.",
      status: 410,
    }));

    render(<ShareLinkRedeem />);

    expect(await screen.findByRole("heading", { name: "Deze deellink is verlopen." })).toBeInTheDocument();
    expect(screen.getByText(/vraag de maker/i)).toBeInTheDocument();
    expect(forgetPendingProjectShareToken).toHaveBeenCalledOnce();
    expect(screen.queryByText(RAW)).not.toBeInTheDocument();
  });

  it("distinguishes a revoked or private link from a temporary network problem", async () => {
    vi.mocked(redeemProjectShareLink).mockRejectedValue(new ApiClientError({
      code: "NOT_FOUND",
      message: "Niet beschikbaar.",
      status: 404,
    }));
    const { unmount } = render(<ShareLinkRedeem />);
    expect(await screen.findByRole("heading", { name: "Deze deellink werkt niet meer." })).toBeInTheDocument();
    unmount();

    vi.mocked(redeemProjectShareLink).mockRejectedValue(new TypeError("offline"));
    render(<ShareLinkRedeem />);
    expect(await screen.findByRole("button", { name: "Opnieuw controleren" })).toBeInTheDocument();
  });
});
