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

vi.mock("@/lib/updateComposerDraftStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/updateComposerDraftStore")>()),
  loadUpdateComposerDraft: mocks.loadDraft,
  saveUpdateComposerDraft: mocks.saveDraft,
  deleteUpdateComposerDraft: mocks.deleteDraft,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe("AddStepDialog typed API retry", () => {
  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  });

  afterAll(() => vi.unstubAllGlobals());

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refetchProject.mockResolvedValue({ data: project });
    mocks.loadDraft.mockResolvedValue(null);
    mocks.saveDraft.mockResolvedValue(undefined);
    mocks.deleteDraft.mockResolvedValue(undefined);
    mocks.createUpdate
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce({
        update: { id: "22222222-2222-4222-8222-222222222222" },
        replayed: true,
      });
  });

  it("locks the draft after an ambiguous response and retries the exact command once", async () => {
    render(<AddStepDialog projectId={PROJECT_ID} onClose={mocks.onClose} onAdded={mocks.onAdded} />);

    const title = screen.getByLabelText("Titel *");
    fireEvent.change(title, { target: { value: "De eerste muur is open" } });
    fireEvent.click(screen.getByRole("button", { name: "Update plaatsen" }));

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
});
