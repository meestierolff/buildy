import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter, Route, Routes } from "@/lib/router";
import AccountSettings from "@/pages/AccountSettings";
import Profile from "@/pages/Profile";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  accountExports: vi.fn(),
  accountSessions: vi.fn(),
  createExportMutation: {
    isPending: false,
    mutateAsync: vi.fn(),
  },
  deletionMutation: {
    isPending: false,
    mutateAsync: vi.fn(),
  },
  followMutation: {
    isPending: false,
    mutateAsync: vi.fn(),
  },
  blockMutation: {
    isPending: false,
    mutateAsync: vi.fn(),
  },
  ownProfile: vi.fn(),
  publicProfile: vi.fn(),
  revokeSessionMutation: {
    isPending: false,
    mutateAsync: vi.fn(),
    variables: undefined as string | undefined,
  },
  socialProfile: vi.fn(),
  updateMutation: {
    isPending: false,
    mutateAsync: vi.fn(),
  },
  user: {
    email: "ada@example.test",
    id: "google-oidc-auth-user",
  } as { email: string; id: string } | null,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    loading: false,
    signOut: vi.fn(),
    user: mocks.user,
  }),
}));

vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: vi.fn() }));

vi.mock("@/hooks/useAccount", () => ({
  useAccountExports: (...arguments_: unknown[]) => mocks.accountExports(...arguments_),
  useAccountSessions: (...arguments_: unknown[]) => mocks.accountSessions(...arguments_),
  useCreateAccountExportMutation: () => mocks.createExportMutation,
  useRequestAccountDeletionMutation: () => mocks.deletionMutation,
  useRevokeAccountSessionMutation: () => mocks.revokeSessionMutation,
}));

vi.mock("@/hooks/useProfiles", () => ({
  useOwnProfile: (...arguments_: unknown[]) => mocks.ownProfile(...arguments_),
  usePublicProfile: (...arguments_: unknown[]) => mocks.publicProfile(...arguments_),
  useUpdateOwnProfileMutation: () => mocks.updateMutation,
}));

vi.mock("@/hooks/useSocial", () => ({
  useProfileBlockMutation: () => mocks.blockMutation,
  useProfileFollowMutation: () => mocks.followMutation,
  useSocialProfile: (...arguments_: unknown[]) => mocks.socialProfile(...arguments_),
}));

vi.mock("@/components/moderation/ReportDialog", () => ({
  default: ({ targetId }: { targetId: string }) => (
    <button type="button">Meld profiel {targetId}</button>
  ),
}));

function ownProfile() {
  return {
    id: PROFILE_ID,
    displayName: "Ada Bouwer",
    slug: "ada-bouwer",
    bio: null,
    location: "Utrecht",
    isPrivate: true,
    isPro: false,
    avatar: null,
    onboardedAt: null,
    version: 3,
    updatedAt: "2026-08-04T12:00:00.000Z",
  };
}

function publicProfile() {
  const { onboardedAt: _onboardedAt, updatedAt: _updatedAt, version: _version, ...profile } = ownProfile();
  return { ...profile, isPrivate: false, viewerAccess: "public" as const };
}

function socialProfile() {
  return {
    ...publicProfile(),
    followerCount: 4,
    followingCount: 2,
    followsViewer: false,
    viewerFollowStatus: "none" as const,
  };
}

describe("profile browser flow", () => {
  beforeEach(() => {
    mocks.user = { email: "ada@example.test", id: "google-oidc-auth-user" };
    mocks.updateMutation.mutateAsync.mockReset().mockResolvedValue({
      id: PROFILE_ID,
      version: 4,
      replayed: false,
    });
    mocks.ownProfile.mockReset().mockReturnValue({
      data: ownProfile(),
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    });
    mocks.publicProfile.mockReset().mockReturnValue({
      data: publicProfile(),
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    });
    mocks.socialProfile.mockReset().mockReturnValue({
      data: socialProfile(),
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    });
    mocks.accountExports.mockReset().mockReturnValue({
      data: [],
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    });
    mocks.accountSessions.mockReset().mockReturnValue({
      data: [],
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    });
    mocks.createExportMutation.mutateAsync.mockReset();
    mocks.deletionMutation.mutateAsync.mockReset();
    mocks.revokeSessionMutation.mutateAsync.mockReset();
    mocks.revokeSessionMutation.variables = undefined;
    mocks.followMutation.mutateAsync.mockReset();
    mocks.blockMutation.mutateAsync.mockReset().mockResolvedValue({
      replayed: false,
      state: "blocked",
    });
  });

  it("resolveert een slug eerst naar het domeinprofiel en gebruikt daarna alleen het app-user-id sociaal", () => {
    window.history.replaceState({}, "", "/profiel/ada-bouwer");

    render(
      <BrowserRouter>
        <Routes>
          <Route path="/profiel/:profileKey" element={<Profile />} />
        </Routes>
      </BrowserRouter>,
    );

    expect(screen.getByRole("heading", { name: "Ada Bouwer" })).toBeInTheDocument();
    expect(mocks.publicProfile).toHaveBeenCalledWith("ada-bouwer", true);
    expect(mocks.socialProfile).toHaveBeenCalledWith(PROFILE_ID, true);
    expect(mocks.socialProfile).not.toHaveBeenCalledWith("google-oidc-auth-user", true);
    expect(screen.queryByRole("link", { name: /connecties|ontdekken/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Terug naar Buildy" })).toHaveAttribute("href", "/");
  });

  it("blokkeert een ander profiel pas na bevestiging en biedt direct deblokkeerherstel", async () => {
    window.history.replaceState({}, "", "/profiel/ada-bouwer");
    render(
      <BrowserRouter>
        <Routes>
          <Route path="/profiel/:profileKey" element={<Profile />} />
        </Routes>
      </BrowserRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Blokkeren" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/bestaande volgrelaties worden ingetrokken/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Blokkeren" }));

    await waitFor(() => expect(mocks.blockMutation.mutateAsync).toHaveBeenCalledWith({
      action: "block",
      profileId: PROFILE_ID,
    }));
    expect(await screen.findByRole("button", { name: "Deblokkeren" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bouwer geblokkeerd" })).toBeInTheDocument();
    expect(screen.getByText(/profielgegevens en verbouwingen zijn verborgen/i)).toBeInTheDocument();
    expect(screen.queryByText("Ada Bouwer")).not.toBeInTheDocument();
    expect(screen.queryByText("Utrecht")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Log in om te volgen/i })).not.toBeInTheDocument();
  });

  it("toont nooit een blokkeeractie op het eigen profiel", () => {
    mocks.socialProfile.mockReturnValue({
      data: { ...socialProfile(), viewerFollowStatus: "self" as const },
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    });
    window.history.replaceState({}, "", "/profiel/ada-bouwer");
    render(
      <BrowserRouter>
        <Routes>
          <Route path="/profiel/:profileKey" element={<Profile />} />
        </Routes>
      </BrowserRouter>,
    );

    expect(screen.queryByRole("button", { name: /blokkeren/i })).not.toBeInTheDocument();
  });

  it("schrijft accountprofielvelden met de geladen serverversie en zonder identityveld", async () => {
    window.history.replaceState({}, "", "/account");
    render(
      <BrowserRouter>
        <AccountSettings />
      </BrowserRouter>,
    );

    const displayName = await screen.findByLabelText("Weergavenaam");
    fireEvent.change(displayName, { target: { value: "  Ada Renovatie  " } });
    fireEvent.click(screen.getByRole("switch", { name: "Privéprofiel" }));
    fireEvent.click(screen.getByRole("button", { name: "Profiel opslaan" }));

    await waitFor(() => expect(mocks.updateMutation.mutateAsync).toHaveBeenCalledOnce());
    const command = mocks.updateMutation.mutateAsync.mock.calls[0]?.[0];
    expect(command).toMatchObject({
      expectedVersion: 3,
      displayName: "Ada Renovatie",
      isPrivate: false,
    });
    expect(command.idempotencyKey).toMatch(/^profile-update:[0-9a-f-]{36}$/i);
    expect(command).not.toHaveProperty("userId");
    expect(command).not.toHaveProperty("isPro");
  });
});
