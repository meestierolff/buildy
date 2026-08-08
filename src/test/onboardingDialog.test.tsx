import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OnboardingDialog from "@/components/app/OnboardingDialog";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  navigate: vi.fn(),
  ownProfile: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/hooks/useProfiles", () => ({
  useOwnProfile: (...arguments_: unknown[]) => mocks.ownProfile(...arguments_),
  useUpdateOwnProfileMutation: () => ({
    isPending: false,
    mutateAsync: mocks.mutateAsync,
  }),
}));

vi.mock("@/lib/router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

function profile(onboardedAt: string | null = null) {
  return {
    id: PROFILE_ID,
    displayName: "Ada Bouwer",
    slug: "ada-bouwer",
    bio: null,
    location: null,
    isPrivate: true,
    isPro: false,
    avatar: null,
    onboardedAt,
    version: 3,
    updatedAt: "2026-08-04T12:00:00.000Z",
  };
}

describe("privacy-first onboarding", () => {
  beforeEach(() => {
    mocks.mutateAsync.mockReset().mockResolvedValue({ id: PROFILE_ID, version: 4, replayed: false });
    mocks.navigate.mockReset();
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.ownProfile.mockReset().mockReturnValue({ data: profile() });
  });

  it("opent alleen voor een ingelogd profiel dat onboarding nog niet voltooide", () => {
    const { rerender } = render(<OnboardingDialog enabled={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(<OnboardingDialog enabled />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Privéprofiel" })).toBeChecked();
  });

  it("blijft weg zodra de server een voltooid tijdstip teruggeeft", () => {
    mocks.ownProfile.mockReturnValue({ data: profile("2026-08-04T12:05:00.000Z") });
    render(<OnboardingDialog enabled />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("schrijft alleen expliciete profielkeuzes en de server-owned completion-intentie", async () => {
    render(<OnboardingDialog enabled />);
    fireEvent.change(screen.getByLabelText("Naam op je profiel"), { target: { value: "  Ada Renovatie  " } });
    fireEvent.click(screen.getByRole("switch", { name: "Privéprofiel" }));
    fireEvent.click(screen.getByRole("button", { name: "Later een project maken" }));

    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledOnce());
    expect(mocks.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 3,
      displayName: "Ada Renovatie",
      isPrivate: false,
      onboardingCompleted: true,
    }));
    const command = mocks.mutateAsync.mock.calls[0]?.[0];
    expect(command.idempotencyKey).toMatch(/^profile-onboarding:[0-9a-f-]{36}$/i);
    expect(command).not.toHaveProperty("userId");
    expect(command).not.toHaveProperty("onboardedAt");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("navigeert pas na een bevestigde mutation naar het nieuwe project", async () => {
    render(<OnboardingDialog enabled />);
    fireEvent.click(screen.getByRole("button", { name: "Start mijn eerste project" }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/project/nieuw"));
    expect(mocks.mutateAsync).toHaveBeenCalledOnce();
  });
});
