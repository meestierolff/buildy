import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter, Route, Routes } from "@/lib/router";
import AccountSettings from "@/pages/AccountSettings";
import Friends from "@/pages/Friends";
import Profile from "@/pages/Profile";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  adminSession: vi.fn(),
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
  prepareImage: vi.fn(),
  uploadAvatar: vi.fn(),
  ownProfile: vi.fn(),
  profileProjects: vi.fn(),
  projectDashboard: vi.fn(),
  publicProfile: vi.fn(),
  revokeSessionMutation: {
    isPending: false,
    mutateAsync: vi.fn(),
    variables: undefined as string | undefined,
  },
  socialProfile: vi.fn(),
  socialProfiles: vi.fn(),
  socialConnections: vi.fn(),
  requestDecision: vi.fn(),
  updateMutation: {
    isPending: false,
    mutateAsync: vi.fn(),
  },
  user: {
    email: "ada@example.test",
    id: "session-auth-user",
  } as { email: string; id: string } | null,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    loading: false,
    signOut: vi.fn(),
    user: mocks.user,
  }),
}));

vi.mock("@/lib/privateMediaApi", () => ({
  preparePrivateProjectImage: (...args: unknown[]) => mocks.prepareImage(...args),
  uploadProfileImage: (...args: unknown[]) => mocks.uploadAvatar(...args),
}));

vi.mock("@/lib/appFeatures", () => ({ useAppFeatures: () => ({ accountLifecycleEnabled: true, mediaFeaturesEnabled: true, photobooksEnabled: true, passwordSignInEnabled: true }) }));

vi.mock("@/hooks/useModeration", () => ({ useModerationAdminSession: () => mocks.adminSession() }));

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
  useInfiniteSocialConnections: (...arguments_: unknown[]) => mocks.socialConnections(...arguments_),
  useInfiniteSocialProfiles: (...arguments_: unknown[]) => mocks.socialProfiles(...arguments_),
  useProfileBlockMutation: () => mocks.blockMutation,
  useProfileFollowMutation: () => mocks.followMutation,
  useRemoveProfileFollowerMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useSocialRequestDecisionMutation: () => ({ isPending: false, mutateAsync: mocks.requestDecision }),
  useSocialProfile: (...arguments_: unknown[]) => mocks.socialProfile(...arguments_),
  useProfileProjects: (...arguments_: unknown[]) => mocks.profileProjects(...arguments_),
}));

vi.mock("@/hooks/useProjectApi", () => ({
  useProjectDashboard: (...arguments_: unknown[]) => mocks.projectDashboard(...arguments_),
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

function projectCard() {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Ons klushuis",
    projectType: "Woning",
    visibility: "public",
    progressPercentage: 40,
    updateCount: 3,
    cover: null,
  };
}

describe("profile browser flow", () => {
  beforeEach(() => {
    mocks.adminSession.mockReturnValue({ isSuccess: false });
    mocks.user = { email: "ada@example.test", id: "session-auth-user" };
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
    mocks.socialProfiles.mockReset().mockReturnValue({
      data: { pages: [{ items: [{ ...socialProfile(), viewerFollowStatus: "following" }] }] },
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    });
    const emptyProjects = { data: { pages: [{ items: [], nextCursor: null }] }, isPending: false, isError: false, refetch: vi.fn() };
    mocks.profileProjects.mockReset().mockReturnValue(emptyProjects);
    mocks.projectDashboard.mockReset().mockReturnValue(emptyProjects);
    mocks.socialConnections.mockReset().mockReturnValue({ data: { pages: [{ items: [], total: 0 }] }, isPending: false, isError: false });
    mocks.requestDecision.mockReset().mockResolvedValue({ state: "following", replayed: false });
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
    expect(mocks.socialProfile).not.toHaveBeenCalledWith("session-auth-user", true);
    expect(screen.getByRole("link", { name: "Bouwers" })).toHaveAttribute("href", "/connecties");
    expect(mocks.profileProjects).toHaveBeenCalledWith(PROFILE_ID, true);
    expect(screen.getByRole("button", { name: "Volgen" })).toBeInTheDocument();
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
    expect(within(dialog).getByText(/jullie volgen elkaar daarna niet meer/i)).toBeInTheDocument();
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
    expect(mocks.profileProjects).toHaveBeenLastCalledWith(PROFILE_ID, false);
    expect(screen.queryByRole("link", { name: /Log in om te verbinden/i })).not.toBeInTheDocument();
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

  it("toont de toegankelijke projectkaartjes op een bouwersprofiel en laadt volgende pagina's", () => {
    const fetchNextPage = vi.fn();
    mocks.profileProjects.mockReturnValue({
      data: { pages: [{ items: [projectCard()], nextCursor: "next" }] },
      isPending: false, isError: false, hasNextPage: true, isFetchingNextPage: false, fetchNextPage,
    });
    window.history.replaceState({}, "", "/profiel/ada-bouwer");
    render(<BrowserRouter><Routes><Route path="/profiel/:profileKey" element={<Profile />} /></Routes></BrowserRouter>);

    expect(screen.getByRole("link", { name: /Ons klushuis bekijken/ })).toHaveAttribute("href", "/project/22222222-2222-4222-8222-222222222222");
    fireEvent.click(screen.getByRole("button", { name: "Meer verbouwingen" }));
    expect(fetchNextPage).toHaveBeenCalledOnce();
  });

  it("gebruikt op het eigen profiel het private dashboard en verwijst voor bewerken naar instellingen", () => {
    mocks.socialProfile.mockReturnValue({ data: { ...socialProfile(), viewerFollowStatus: "self", viewerAccess: "owner" }, isPending: false, isError: false });
    mocks.projectDashboard.mockReturnValue({ data: { pages: [{ items: [{ ...projectCard(), visibility: "private" }] }] }, isPending: false, isError: false });
    window.history.replaceState({}, "", "/profiel");
    render(<BrowserRouter><Profile /></BrowserRouter>);

    expect(mocks.ownProfile).toHaveBeenCalledWith(true);
    expect(mocks.projectDashboard).toHaveBeenCalledWith(true);
    expect(mocks.profileProjects).toHaveBeenCalledWith(PROFILE_ID, false);
    expect(screen.getByRole("heading", { name: "Mijn verbouwingen" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Profiel bewerken" })).toHaveAttribute("href", "/account");
    expect(screen.getByRole("link", { name: /Ons klushuis bekijken/ })).toBeInTheDocument();
  });

  it("toont geen projectdata zolang een privéprofiel alleen om toegang kan worden gevraagd", () => {
    mocks.socialProfile.mockReturnValue({ data: { ...socialProfile(), viewerAccess: "requestable", isPrivate: true }, isPending: false, isError: false });
    mocks.profileProjects.mockReturnValue({ data: { pages: [{ items: [projectCard()] }] }, isPending: false, isError: false });
    window.history.replaceState({}, "", `/profiel/${PROFILE_ID}`);
    render(<BrowserRouter><Routes><Route path="/profiel/:profileKey" element={<Profile />} /></Routes></BrowserRouter>);

    expect(mocks.profileProjects).toHaveBeenCalledWith(PROFILE_ID, false);
    expect(screen.queryByRole("link", { name: /Ons klushuis/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Een privéverhaal" })).toBeInTheDocument();
  });

  it("verwerkt inkomende volgverzoeken onder Verzoeken met het bestaande contract", async () => {
    mocks.socialConnections.mockImplementation((view) => ({
      data: { pages: [{ items: view === "incoming" ? [socialProfile()] : [], total: view === "incoming" ? 1 : 0 }] },
      isPending: false, isError: false,
    }));
    window.history.replaceState({}, "", "/connecties?view=incoming");
    render(<BrowserRouter><Friends /></BrowserRouter>);

    expect(screen.getByRole("tab", { name: /Verzoeken/ })).toHaveAttribute("data-state", "active");
    fireEvent.click(screen.getByRole("button", { name: "Accepteren" }));
    await waitFor(() => expect(mocks.requestDecision).toHaveBeenCalledWith({ actorId: PROFILE_ID, decision: "accept", kind: "profile" }));
  });

  it("zoekt pas vanaf twee tekens en laat een bestaande bouwer ontvolgen", async () => {
    mocks.followMutation.mutateAsync.mockResolvedValue({ state: "cancelled", replayed: false });
    window.history.replaceState({}, "", "/connecties");
    render(<BrowserRouter><Friends /></BrowserRouter>);

    expect(mocks.socialProfiles).toHaveBeenLastCalledWith("", false);
    expect(screen.queryByText("Ada Bouwer")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Zoek bouwers op naam of gebruikersnaam" }), { target: { value: "Ada" } });
    fireEvent.click(await screen.findByRole("button", { name: "Ontvolgen" }));
    expect(mocks.socialProfiles).toHaveBeenLastCalledWith("Ada", true);

    await waitFor(() => expect(mocks.followMutation.mutateAsync).toHaveBeenCalledWith({
      action: "remove",
      profileId: PROFILE_ID,
    }));
  });

  it("bewaart een nieuwe profielfoto pas samen met profielwijzigingen", async () => {
    window.history.replaceState({}, "", "/account");
    const file = new File(["avatar"], "avatar.jpg", { type: "image/jpeg" });
    const prepared = { file, contentType: "image/jpeg", sizeBytes: file.size, checksumSha256Base64: "checksum" };
    mocks.prepareImage.mockResolvedValue(prepared);
    mocks.uploadAvatar.mockResolvedValue({ id: "22222222-2222-4222-8222-222222222222" });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:avatar-preview") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    render(<BrowserRouter><AccountSettings /></BrowserRouter>);
    fireEvent.change(screen.getByLabelText(/Profielfoto/), { target: { files: [file] } });
    expect(mocks.uploadAvatar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Profiel opslaan" }));
    await waitFor(() => expect(mocks.updateMutation.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 3, avatarAssetId: "22222222-2222-4222-8222-222222222222",
    })));
    expect(mocks.uploadAvatar).toHaveBeenCalledWith({ idempotencyKey: expect.stringMatching(/^avatar-upload:/), prepared });
    const command = mocks.updateMutation.mutateAsync.mock.calls[0][0];
    expect(command).not.toHaveProperty("slug");
    expect(command).not.toHaveProperty("displayName");
    expect(command).not.toHaveProperty("username");
  });

  it("vergrendelt profielvelden zolang de profielfoto nog wordt verwerkt", async () => {
    const file = new File(["avatar"], "avatar.jpg", { type: "image/jpeg" });
    let finishUpload: (asset: { id: string }) => void = () => undefined;
    mocks.prepareImage.mockResolvedValue({ file });
    mocks.uploadAvatar.mockReturnValue(new Promise((resolve) => { finishUpload = resolve; }));
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:avatar-preview") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    render(<BrowserRouter><AccountSettings /></BrowserRouter>);
    fireEvent.change(screen.getByLabelText(/Profielfoto/), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Profiel opslaan" }));
    await waitFor(() => expect(screen.getByLabelText("Profielnaam")).toBeDisabled());
    expect(mocks.updateMutation.mutateAsync).not.toHaveBeenCalled();
    finishUpload({ id: "22222222-2222-4222-8222-222222222222" });
    await waitFor(() => expect(screen.getByLabelText("Profielnaam")).not.toBeDisabled());
  });

  it.each(["admin", "moderator", undefined])("toont boekbeheer alleen bij een bevestigde beheerrol (%s)", (role) => {
    mocks.adminSession.mockReturnValue({ isSuccess: Boolean(role), data: role ? { role } : undefined });
    render(<BrowserRouter><AccountSettings /></BrowserRouter>);
    const link = screen.queryByRole("link", { name: "Boekbestellingen beheren" });
    if (role === "admin") expect(link).toHaveAttribute("href", "/admin/boeken");
    else expect(link).not.toBeInTheDocument();
  });

  it("houdt accountverwijdering beschikbaar achter een compacte gesloten sectie", () => {
    window.history.replaceState({}, "", "/account");
    render(<BrowserRouter><AccountSettings /></BrowserRouter>);
    const disclosure = screen.getByText("Account verwijderen", { selector: "summary" });
    expect(disclosure.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(disclosure);
    expect(screen.getByRole("button", { name: "Account verwijderen", hidden: true })).toHaveClass("text-destructive");
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
