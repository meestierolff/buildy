import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OnboardingDialog from "@/components/app/OnboardingDialog";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  navigate: vi.fn(),
  ownProfile: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock("@/hooks/useProfiles", () => ({
  useOwnProfile: (...arguments_: unknown[]) => mocks.ownProfile(...arguments_),
  useUpdateOwnProfileMutation: () => ({
    isPending: false,
    mutateAsync: mocks.updateProfile,
  }),
}));

vi.mock("@/hooks/useProjectApi", () => ({
  useCreateProjectMutation: () => ({
    isPending: false,
    mutateAsync: mocks.createProject,
  }),
}));

vi.mock("@/lib/router", () => ({
  useLocation: () => ({ pathname: "/projecten", search: "", hash: "", state: undefined }),
  useNavigate: () => mocks.navigate,
}));
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

describe("private project onboarding", () => {
  beforeEach(() => {
    mocks.createProject.mockReset().mockResolvedValue({
      project: { id: PROJECT_ID },
      replayed: false,
    });
    mocks.updateProfile.mockReset().mockResolvedValue({ id: PROFILE_ID, version: 4, replayed: false });
    mocks.navigate.mockReset();
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.ownProfile.mockReset().mockReturnValue({ data: profile() });
  });

  it("opent alleen voor een profiel dat onboarding nog niet voltooide", () => {
    const { rerender } = render(<OnboardingDialog enabled={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(<OnboardingDialog enabled />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Hoe heet je verbouwing?" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Wat verbouw je/ })).toBeInTheDocument();
    expect(screen.getByText(/Je begint privé/)).toBeInTheDocument();
  });

  it("blijft weg zodra de server een voltooid tijdstip teruggeeft", () => {
    mocks.ownProfile.mockReturnValue({ data: profile("2026-08-04T12:05:00.000Z") });
    render(<OnboardingDialog enabled />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("maakt privé aan, voltooit daarna het profiel en opent de composer", async () => {
    render(<OnboardingDialog enabled />);
    fireEvent.change(screen.getByRole("textbox", { name: "Hoe heet je verbouwing?" }), {
      target: { value: "  Ada Renovatie  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verbouwing starten" }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(
      `/project/${PROJECT_ID}?update=nieuw`,
      { replace: true },
    ));
    expect(mocks.createProject).toHaveBeenCalledWith(expect.objectContaining({
      visibility: "private",
      input: expect.objectContaining({ title: "Ada Renovatie" }),
    }));
    expect(mocks.updateProfile).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 3,
      onboardingCompleted: true,
    }));
    expect(mocks.createProject.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateProfile.mock.invocationCallOrder[0],
    );
    expect(mocks.createProject.mock.calls[0]?.[0].input.idempotencyKey).toMatch(/^project-onboarding:[0-9a-f-]{36}$/i);
    expect(mocks.updateProfile.mock.calls[0]?.[0].idempotencyKey).toMatch(/^profile-onboarding:[0-9a-f-]{36}$/i);
  });

  it("maakt geen tweede verbouwing wanneer er al een actieve verbouwing is", async () => {
    render(<OnboardingDialog enabled activeProjectId={PROJECT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Bouwmoment toevoegen" }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(
      `/project/${PROJECT_ID}?update=nieuw`,
      { replace: true },
    ));
    expect(mocks.createProject).not.toHaveBeenCalled();
    expect(mocks.updateProfile).toHaveBeenCalledOnce();
  });
});
