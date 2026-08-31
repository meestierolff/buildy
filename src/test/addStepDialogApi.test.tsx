import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import AddStepDialog from "@/components/AddStepDialog";

const mocks = vi.hoisted(() => ({
  createUpdate: vi.fn(),
  mediaUpload: vi.fn(),
  refetchProject: vi.fn(),
  onClose: vi.fn(),
  onAdded: vi.fn(),
  loadDraft: vi.fn(),
  saveDraft: vi.fn(),
  deleteDraft: vi.fn(),
  loadLandingPhoto: vi.fn(),
  deleteLandingPhoto: vi.fn(),
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

const project = {
  id: PROJECT_ID,
  version: 4,
  canEdit: true,
  phases: [],
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
  useCreateProjectUpdateMutation: () => ({ mutateAsync: mocks.createUpdate }),
  useCreateProjectPhaseMutation: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/usePrivateMediaUpload", () => ({
  usePrivateMediaUpload: () => ({ mutateAsync: mocks.mediaUpload }),
}));

vi.mock("@/lib/appFeatures", () => ({
  useAppFeatures: () => ({ mediaFeaturesEnabled: true }),
}));

vi.mock("@/lib/updateComposerDraftStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/updateComposerDraftStore")>()),
  loadUpdateComposerDraft: mocks.loadDraft,
  saveUpdateComposerDraft: mocks.saveDraft,
  deleteUpdateComposerDraft: mocks.deleteDraft,
}));

vi.mock("@/lib/landingPhotoHandoffStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/landingPhotoHandoffStore")>()),
  loadLandingPhotoHandoff: mocks.loadLandingPhoto,
  deleteLandingPhotoHandoff: mocks.deleteLandingPhoto,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe("AddStepDialog typed API retry", () => {
  const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:buildy-composer-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    if (originalCreateObjectUrl) Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl);
    else Reflect.deleteProperty(URL, "createObjectURL");
    if (originalRevokeObjectUrl) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl);
    else Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refetchProject.mockResolvedValue({ data: project });
    mocks.loadDraft.mockResolvedValue(null);
    mocks.saveDraft.mockResolvedValue(undefined);
    mocks.deleteDraft.mockResolvedValue(undefined);
    mocks.loadLandingPhoto.mockResolvedValue(null);
    mocks.deleteLandingPhoto.mockResolvedValue(undefined);
    mocks.createUpdate
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce({
        update: { id: "22222222-2222-4222-8222-222222222222" },
        replayed: true,
      });
  });

  it("locks the draft after an ambiguous response and retries the exact command once", async () => {
    render(<AddStepDialog projectId={PROJECT_ID} onClose={mocks.onClose} onAdded={mocks.onAdded} />);

    const title = screen.getByLabelText(/Korte titel of bijschrift/);
    fireEvent.change(title, { target: { value: "De eerste muur is open" } });
    fireEvent.click(screen.getByRole("button", { name: "Bouwmoment plaatsen" }));

    await screen.findByText(/serverbevestiging ontbreekt nog/i);
    expect(title).toBeDisabled();
    expect(mocks.createUpdate).toHaveBeenCalledTimes(1);
    const firstCommand = mocks.createUpdate.mock.calls[0]?.[0];

    const retry = screen.getByRole("button", { name: "Opnieuw proberen" });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);

    await waitFor(() => expect(mocks.onClose).toHaveBeenCalledTimes(1));
    expect(mocks.onAdded).toHaveBeenCalledTimes(1);
    expect(mocks.createUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.createUpdate.mock.calls[1]?.[0]).toBe(firstCommand);
    expect(mocks.refetchProject).toHaveBeenCalledTimes(1);
    expect(firstCommand).not.toHaveProperty("userId");
    expect(firstCommand).not.toHaveProperty("user_id");
  });

  it("herstelt een apparaatconcept en kan het bewust bewaren en sluiten", async () => {
    mocks.loadDraft.mockResolvedValue({
      version: 1,
      title: "Herstelde update",
      phaseId: "",
      isMilestone: false,
      description: "Dit concept stond al op dit apparaat.",
      updateDate: "2026-08-05",
      files: [],
      updateIdempotencyKey: "update-create:cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      pendingCommand: null,
      savedAt: "2026-08-05T09:00:00.000Z",
    });

    render(<AddStepDialog projectId={PROJECT_ID} onClose={mocks.onClose} onAdded={mocks.onAdded} />);

    expect(await screen.findByDisplayValue("Herstelde update")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Annuleren" }));
    fireEvent.click(await screen.findByRole("button", { name: "Bewaren en sluiten" }));

    await waitFor(() => expect(mocks.onClose).toHaveBeenCalledTimes(1));
    expect(mocks.saveDraft).toHaveBeenCalledWith(
      "browser-session-user",
      PROJECT_ID,
      expect.objectContaining({
        title: "Herstelde update",
        updateIdempotencyKey: "update-create:cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      }),
    );
  });

  it("neemt de lokale startfoto over zonder upload en wist de overdracht na conceptimport", async () => {
    mocks.loadLandingPhoto.mockResolvedValue({
      version: 1,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      contentType: "image/png",
      bytes: new Blob(["synthetic-photo"], { type: "image/png" }),
      savedAt: "2026-08-23T10:00:00.000Z",
    });

    render(
      <AddStepDialog
        projectId={PROJECT_ID}
        importLandingPhoto
        onClose={mocks.onClose}
        onAdded={mocks.onAdded}
      />,
    );

    expect(await screen.findByAltText("Voorvertoning 1")).toBeInTheDocument();
    expect(screen.getByText(/alleen vanaf dit apparaat overgenomen/i)).toBeInTheDocument();
    expect(screen.getByText("eerste-bouwmoment.png")).toBeInTheDocument();
    expect(mocks.mediaUpload).not.toHaveBeenCalled();

    await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledWith(
      "browser-session-user",
      PROJECT_ID,
      expect.objectContaining({
        files: [expect.objectContaining({
          id: "media-upload:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          name: "eerste-bouwmoment.png",
          contentType: "image/png",
        })],
      }),
    ));
    await waitFor(() => expect(mocks.deleteLandingPhoto).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ));
  });

  it("biedt mobiel een camera en bibliotheek en accepteert desktop-drop", async () => {
    render(<AddStepDialog projectId={PROJECT_ID} onClose={mocks.onClose} onAdded={mocks.onAdded} />);

    const cameraInput = screen.getByLabelText("Maak een foto");
    const libraryInput = screen.getByLabelText("Kies foto's uit je bibliotheek");
    expect(cameraInput).toHaveAttribute("capture", "environment");
    expect(cameraInput).not.toHaveAttribute("multiple");
    expect(libraryInput).toHaveAttribute("multiple");

    const droppedPhoto = new File(["photo"], "keuken-drop.jpg", { type: "image/jpeg" });
    fireEvent.drop(screen.getByRole("group", { name: "Foto's toevoegen" }), {
      dataTransfer: { files: [droppedPhoto] },
    });

    expect(await screen.findByText("keuken-drop.jpg")).toBeInTheDocument();
    expect(screen.getByAltText("Voorvertoning 1")).toHaveAttribute("src", "blob:buildy-composer-preview");

    fireEvent.drop(screen.getByRole("group", { name: "Foto's toevoegen" }), {
      dataTransfer: { files: [droppedPhoto] },
    });
    expect(screen.getAllByAltText(/Voorvertoning/)).toHaveLength(1);
  });

  it("laat alleen de mislukte foto afzonderlijk opnieuw verwerken", async () => {
    mocks.mediaUpload
      .mockRejectedValueOnce(new TypeError("blob response lost"))
      .mockResolvedValueOnce({
        id: "77777777-7777-4777-8777-777777777777",
        projectId: PROJECT_ID,
        status: "ready",
      });
    render(<AddStepDialog projectId={PROJECT_ID} onClose={mocks.onClose} onAdded={mocks.onAdded} />);

    const photo = new File(["photo"], "keuken-retry.jpg", {
      type: "image/jpeg",
      lastModified: 1_777_000_000_000,
    });
    fireEvent.drop(screen.getByRole("group", { name: "Foto's toevoegen" }), {
      dataTransfer: { files: [photo] },
    });
    await screen.findByText("keuken-retry.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Bouwmoment plaatsen" }));

    const retry = await screen.findByRole("button", { name: "keuken-retry.jpg opnieuw uploaden" });
    expect(mocks.createUpdate).not.toHaveBeenCalled();
    fireEvent.click(retry);

    expect(await screen.findByText("Privé verwerkt")).toBeInTheDocument();
    expect(mocks.mediaUpload).toHaveBeenCalledTimes(2);
    expect(mocks.createUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Bouwmoment plaatsen" })).toBeEnabled();
  });
});
