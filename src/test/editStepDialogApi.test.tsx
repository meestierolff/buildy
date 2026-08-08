import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import EditStepDialog from "@/components/EditStepDialog";
import type { ProjectOverview, ProjectUpdate } from "../../shared/contracts/projects";

const mocks = vi.hoisted(() => ({
  editUpdate: vi.fn(),
  deleteUpdate: vi.fn(),
  createPhase: vi.fn(),
  uploadMedia: vi.fn(),
  refetchProject: vi.fn(),
  onClose: vi.fn(),
  onUpdated: vi.fn(),
  onDeleted: vi.fn(),
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const UPDATE_ID = "22222222-2222-4222-8222-222222222222";
const FIRST_MEDIA_ID = "33333333-3333-4333-8333-333333333333";
const SECOND_MEDIA_ID = "44444444-4444-4444-8444-444444444444";

const project: ProjectOverview = {
  id: PROJECT_ID,
  slug: "keuken",
  title: "Keuken",
  description: null,
  projectType: "Keuken",
  visibility: "private",
  progressPercentage: 25,
  version: 4,
  updatedAt: "2026-08-04T12:00:00.000Z",
  publishedAt: null,
  updateCount: 1,
  lastUpdateAt: "2026-08-04T12:00:00.000Z",
  owner: { id: "55555555-5555-4555-8555-555555555555", displayName: "Ada", slug: "ada" },
  cover: null,
  startDate: "2026-08-01",
  expectedEndDate: null,
  contentRevision: 4,
  followerCount: 0,
  viewerAccess: "owner",
  canEdit: true,
  phases: [{
    id: "66666666-6666-4666-8666-666666666666",
    name: "Sloopwerk",
    sortOrder: 1,
    isCustom: false,
  }],
};

const update: ProjectUpdate = {
  id: UPDATE_ID,
  projectId: PROJECT_ID,
  phase: project.phases[0]!,
  title: "Oude keuken eruit",
  room: "Keuken",
  description: "Alles is gestript.",
  updateDate: "2026-08-04",
  status: "published",
  isMilestone: false,
  sortOrder: 0,
  contentRevision: 3,
  version: 3,
  publishedAt: "2026-08-04T12:00:00.000Z",
  updatedAt: "2026-08-04T12:00:00.000Z",
  media: [
    {
      id: FIRST_MEDIA_ID,
      contentType: "image/jpeg",
      width: 1600,
      height: 1200,
      proxyPath: `/api/media/${FIRST_MEDIA_ID}`,
      role: "before",
      sortOrder: 0,
      caption: null,
    },
    {
      id: SECOND_MEDIA_ID,
      contentType: "image/jpeg",
      width: 1600,
      height: 1200,
      proxyPath: `/api/media/${SECOND_MEDIA_ID}`,
      role: "after",
      sortOrder: 1,
      caption: "Na",
    },
  ],
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "browser-session-user" } }),
}));

vi.mock("@/hooks/useProjectApi", () => ({
  useProjectOverview: () => ({
    data: project,
    isLoading: false,
    isError: false,
    refetch: mocks.refetchProject,
  }),
  useEditProjectUpdateMutation: () => ({ mutateAsync: mocks.editUpdate }),
  useDeleteProjectUpdateMutation: () => ({
    mutateAsync: mocks.deleteUpdate,
    isPending: false,
  }),
  useCreateProjectPhaseMutation: () => ({ mutateAsync: mocks.createPhase }),
}));

vi.mock("@/hooks/usePrivateMediaUpload", () => ({
  usePrivateMediaUpload: () => ({ mutateAsync: mocks.uploadMedia }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe("EditStepDialog typed update mutations", () => {
  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  });

  afterAll(() => vi.unstubAllGlobals());

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.refetchProject.mockResolvedValue({ data: project });
    mocks.editUpdate.mockResolvedValue({
      update: { ...update, media: [update.media[1]], version: 4 },
      replayed: false,
    });
    mocks.deleteUpdate.mockResolvedValue({
      project: { ...project, version: 5 },
      updateId: UPDATE_ID,
      deleted: true,
      replayed: false,
    });
  });

  it("detaches media and sends one contiguous full manifest without storage deletion", async () => {
    render(
      <EditStepDialog
        projectId={PROJECT_ID}
        update={update}
        onClose={mocks.onClose}
        onUpdated={mocks.onUpdated}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Media 1 uit update halen" }));
    fireEvent.click(screen.getByRole("button", { name: "Wijzigingen opslaan" }));

    await waitFor(() => expect(mocks.editUpdate).toHaveBeenCalledOnce());
    expect(mocks.editUpdate.mock.calls[0]?.[0]).toMatchObject({
      expectedVersion: 3,
      media: [{
        assetId: SECOND_MEDIA_ID,
        role: "after",
        sortOrder: 0,
        caption: "Na",
      }],
    });
    expect(mocks.editUpdate.mock.calls[0]?.[0]).not.toHaveProperty("userId");
    expect(mocks.uploadMedia).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.onClose).toHaveBeenCalledOnce());
  });

  it("requires a second confirmed action before sending the soft-delete command", async () => {
    render(
      <EditStepDialog
        projectId={PROJECT_ID}
        update={update}
        onClose={mocks.onClose}
        onDeleted={mocks.onDeleted}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Update verwijderen" }));
    expect(mocks.deleteUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ja, update verwijderen" }));

    await waitFor(() => expect(mocks.deleteUpdate).toHaveBeenCalledOnce());
    expect(mocks.deleteUpdate.mock.calls[0]?.[0]).toMatchObject({
      expectedVersion: 3,
      confirmation: "delete-update",
    });
    expect(mocks.onDeleted).toHaveBeenCalledWith(UPDATE_ID);
    expect(mocks.onClose).toHaveBeenCalledOnce();
  });

  it("locks an ambiguous edit and retries the exact same version-bound command", async () => {
    mocks.editUpdate
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce({ update: { ...update, title: "Nieuwe titel", version: 4 }, replayed: true });
    render(
      <EditStepDialog
        projectId={PROJECT_ID}
        update={update}
        onClose={mocks.onClose}
        onUpdated={mocks.onUpdated}
      />,
    );

    const title = screen.getByLabelText("Titel");
    fireEvent.change(title, { target: { value: "Nieuwe titel" } });
    fireEvent.click(screen.getByRole("button", { name: "Wijzigingen opslaan" }));

    await screen.findByText(/serverbevestiging ontbreekt/i);
    expect(title).toBeDisabled();
    const firstCommand = mocks.editUpdate.mock.calls[0]?.[0];
    fireEvent.click(screen.getByRole("button", { name: "Zelfde wijziging opnieuw" }));

    await waitFor(() => expect(mocks.editUpdate).toHaveBeenCalledTimes(2));
    expect(mocks.editUpdate.mock.calls[1]?.[0]).toBe(firstCommand);
    await waitFor(() => expect(mocks.onClose).toHaveBeenCalledOnce());
  });
});
