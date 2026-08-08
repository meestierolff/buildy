import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ProjectAccessManager from "@/components/ProjectAccessManager";
import {
  useRevokeProjectAccessMutation,
  useSocialProjectAccess,
  useSocialRequestDecisionMutation,
} from "@/hooks/useSocial";

vi.mock("@/hooks/useSocial", () => ({
  useRevokeProjectAccessMutation: vi.fn(),
  useSocialProjectAccess: vi.fn(),
  useSocialRequestDecisionMutation: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const REQUESTER_ID = "22222222-2222-4222-8222-222222222222";

describe("ProjectAccessManager typed API states", () => {
  const decide = vi.fn();
  const revoke = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSocialRequestDecisionMutation).mockReturnValue({ mutateAsync: decide } as unknown as ReturnType<typeof useSocialRequestDecisionMutation>);
    vi.mocked(useRevokeProjectAccessMutation).mockReturnValue({ mutateAsync: revoke } as unknown as ReturnType<typeof useRevokeProjectAccessMutation>);
  });

  it("lets the owner accept a pending request without client-supplied ownership", async () => {
    vi.mocked(useSocialProjectAccess).mockReturnValue({
      data: {
        projectId: PROJECT_ID,
        items: [{
          requesterId: REQUESTER_ID,
          displayName: "Sam",
          avatar: null,
          status: "pending",
          requestedAt: "2026-08-04T10:00:00.000Z",
          updatedAt: "2026-08-04T10:00:00.000Z",
        }],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSocialProjectAccess>);
    decide.mockResolvedValue({ replayed: false, state: "accepted" });

    render(<ProjectAccessManager projectId={PROJECT_ID} enabled />);
    fireEvent.click(screen.getByRole("button", { name: "Geef Sam toegang" }));

    await waitFor(() => expect(decide).toHaveBeenCalledWith({
      actorId: REQUESTER_ID,
      decision: "accept",
      kind: "project",
      projectId: PROJECT_ID,
    }));
  });

  it("shows a fail-closed retry state when owner access cannot be verified", () => {
    vi.mocked(useSocialProjectAccess).mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSocialProjectAccess>);

    render(<ProjectAccessManager projectId={PROJECT_ID} enabled />);
    expect(screen.getByRole("alert")).toHaveTextContent("niet veilig worden geladen");
    expect(screen.queryByText("Sam")).not.toBeInTheDocument();
  });
});
