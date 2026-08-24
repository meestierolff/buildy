import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FloorplanBoard as FloorplanBoardData } from "../../shared/contracts/planning";

const hooks = vi.hoisted(() => {
  const mutation = () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
    variables: undefined,
  });
  return {
    useFloorplanBoard: vi.fn(),
    createFloorplan: mutation(),
    updateFloorplan: mutation(),
    deleteFloorplan: mutation(),
    createPin: mutation(),
    updatePin: mutation(),
    deletePin: mutation(),
  };
});

const mediaClient = vi.hoisted(() => ({
  prepare: vi.fn(),
  uploadFloorplan: vi.fn(),
}));

vi.mock("@/hooks/usePlanning", () => ({
  useFloorplanBoard: hooks.useFloorplanBoard,
  useCreateFloorplan: () => hooks.createFloorplan,
  useUpdateFloorplan: () => hooks.updateFloorplan,
  useDeleteFloorplan: () => hooks.deleteFloorplan,
  useCreateFloorplanPin: () => hooks.createPin,
  useUpdateFloorplanPin: () => hooks.updatePin,
  useDeleteFloorplanPin: () => hooks.deletePin,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/privateMediaApi", () => ({
  preparePrivateProjectImage: mediaClient.prepare,
  uploadFloorplanImage: mediaClient.uploadFloorplan,
}));

import FloorplanBoard from "@/components/project/FloorplanBoard";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const FLOORPLAN_ID = "22222222-2222-4222-8222-222222222222";
const MEDIA_ID = "33333333-3333-4333-8333-333333333333";
const UPLOADED_MEDIA_ID = "77777777-7777-4777-8777-777777777777";
const PIN_ID = "44444444-4444-4444-8444-444444444444";
const PINNED_UPDATE_ID = "55555555-5555-4555-8555-555555555555";
const NEW_UPDATE_ID = "66666666-6666-4666-8666-666666666666";

const board: FloorplanBoardData = {
  projectId: PROJECT_ID,
  viewerAccess: "owner",
  canEdit: true,
  floorplans: [{
    id: FLOORPLAN_ID,
    name: "Begane grond",
    floorNumber: 0,
    sortOrder: 0,
    version: 6,
    media: {
      id: MEDIA_ID,
      status: "ready",
      contentType: "image/webp",
      width: 1200,
      height: 800,
      proxyPath: `/api/media/${MEDIA_ID}`,
    },
    pins: [{
      id: PIN_ID,
      updateId: PINNED_UPDATE_ID,
      x: 0.25,
      y: 0.5,
      label: "Keuken",
      version: 4,
      update: {
        title: "Keuken geplaatst",
        updateDate: "2026-08-01",
        status: "published",
      },
    }],
  }],
};

const mutationMocks = [
  hooks.createFloorplan,
  hooks.updateFloorplan,
  hooks.deleteFloorplan,
  hooks.createPin,
  hooks.updatePin,
  hooks.deletePin,
];

type FloorplanUploadCall = {
  projectId: string;
  idempotencyKey: string;
  prepared: {
    file: File;
    contentType: "image/png";
    sizeBytes: number;
    checksumSha256Base64: string;
  };
  signal?: AbortSignal;
  onStage?: (stage: "uploading" | "processing" | "ready") => void;
};

function readyUploadedAsset() {
  return {
    id: UPLOADED_MEDIA_ID,
    projectId: PROJECT_ID,
    purpose: "floorplan" as const,
    status: "ready" as const,
  };
}

function renderBoard(data: FloorplanBoardData = board) {
  hooks.useFloorplanBoard.mockReturnValue({
    data,
    error: null,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  });
  return render(
    <FloorplanBoard
      projectId={PROJECT_ID}
      availableUpdates={[
        { id: PINNED_UPDATE_ID, label: "Keuken geplaatst" },
        { id: NEW_UPDATE_ID, label: "Badkamer gereed" },
      ]}
    />,
  );
}

describe("FloorplanBoard", () => {
  beforeEach(() => {
    hooks.useFloorplanBoard.mockReset();
    mutationMocks.forEach((mutation) => mutation.mutate.mockReset());
    mediaClient.prepare.mockReset().mockImplementation(async (file: File) => ({
      file,
      contentType: "image/png" as const,
      sizeBytes: file.size,
      checksumSha256Base64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    }));
    mediaClient.uploadFloorplan.mockReset().mockImplementation(async (input: FloorplanUploadCall) => {
      input.onStage?.("uploading");
      input.onStage?.("processing");
      input.onStage?.("ready");
      return readyUploadedAsset();
    });
  });

  it("verplaatst een geselecteerde pin met toetsenbordknoppen en optimistic versioning", () => {
    renderBoard();

    fireEvent.click(screen.getByRole("button", { name: "Keuken selecteren" }));
    fireEvent.click(screen.getByRole("button", { name: "Pin naar rechts" }));

    expect(hooks.updatePin.mutate).toHaveBeenCalledOnce();
    const variables = hooks.updatePin.mutate.mock.calls[0]?.[0];
    expect(variables).toMatchObject({
      projectId: PROJECT_ID,
      floorplanId: FLOORPLAN_ID,
      pinId: PIN_ID,
      input: {
        expectedVersion: 4,
        x: 0.26,
        y: 0.5,
      },
    });
    expect(variables.input.idempotencyKey).toMatch(/^planning:pin-update:/);
  });

  it("herhaalt een transportfout met exact dezelfde idempotente aanvraag", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Keuken selecteren" }));
    fireEvent.click(screen.getByRole("button", { name: "Pin naar rechts" }));
    const [variables, options] = hooks.updatePin.mutate.mock.calls[0];

    act(() => options.onError(new Error("Verbinding verbroken.")));
    fireEvent.click(screen.getByRole("button", { name: "Zelfde aanvraag opnieuw proberen" }));

    expect(hooks.updatePin.mutate).toHaveBeenCalledTimes(2);
    expect(hooks.updatePin.mutate.mock.calls[1]?.[0]).toBe(variables);
    expect(hooks.updatePin.mutate.mock.calls[1]?.[0].input.idempotencyKey).toBe(
      variables.input.idempotencyKey,
    );
  });

  it("plaatst een pin met exacte toetsenbordcoördinaten", () => {
    renderBoard();

    fireEvent.change(screen.getByLabelText("Bouwmoment"), { target: { value: NEW_UPDATE_ID } });
    fireEvent.change(screen.getByLabelText("Horizontale positie (0–1)"), {
      target: { value: "0,125" },
    });
    fireEvent.change(screen.getByLabelText("Verticale positie (0–1)"), {
      target: { value: "0.875" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pin plaatsen met coördinaten" }));

    expect(hooks.createPin.mutate).toHaveBeenCalledOnce();
    expect(hooks.createPin.mutate.mock.calls[0]?.[0]).toMatchObject({
      projectId: PROJECT_ID,
      floorplanId: FLOORPLAN_ID,
      input: {
        updateId: NEW_UPDATE_ID,
        x: 0.125,
        y: 0.875,
      },
    });
  });

  it("normaliseert een pointerpositie binnen de afbeelding naar coördinaten tussen nul en één", () => {
    renderBoard();
    fireEvent.change(screen.getByLabelText("Bouwmoment"), { target: { value: NEW_UPDATE_ID } });
    const image = screen.getByRole("img", { name: "Plattegrond Begane grond" });
    const container = image.parentElement;
    expect(container).not.toBeNull();
    Object.defineProperty(container, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 120,
        height: 100,
        left: 10,
        right: 210,
        top: 20,
        width: 200,
        x: 10,
        y: 20,
        toJSON: () => ({}),
      }),
    });

    fireEvent.pointerDown(container as HTMLDivElement, { clientX: 60, clientY: 45, pointerId: 1 });

    expect(hooks.createPin.mutate).toHaveBeenCalledOnce();
    expect(hooks.createPin.mutate.mock.calls[0]?.[0]).toMatchObject({
      input: { updateId: NEW_UPDATE_ID, x: 0.25, y: 0.25 },
    });
  });

  it("uploadt een gekozen/camera-afbeelding privé en koppelt alleen het ready floorplan-asset", async () => {
    renderBoard();

    fireEvent.click(screen.getByRole("button", { name: "Plattegrond toevoegen" }));
    const fileInput = screen.getByLabelText("Afbeelding van de plattegrond");
    expect(fileInput).toHaveAttribute(
      "accept",
      "image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif",
    );
    expect(fileInput).toHaveAttribute("capture", "environment");
    const file = new File(["floorplan"], "begane-grond.png", { type: "image/png" });
    fireEvent.change(fileInput, {
      target: { files: [file] },
    });
    expect(await screen.findByRole("status")).toHaveTextContent("klaar om toe te voegen");
    expect(screen.getByRole("progressbar", { name: "Voortgang plattegrondupload" }))
      .toHaveAttribute("aria-valuenow", "100");
    fireEvent.change(screen.getByLabelText("Naam"), { target: { value: "Eerste verdieping" } });
    fireEvent.change(screen.getByLabelText("Verdieping, optioneel"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Toevoegen" }));

    expect(mediaClient.uploadFloorplan).toHaveBeenCalledOnce();
    const uploadInput = mediaClient.uploadFloorplan.mock.calls[0]?.[0] as FloorplanUploadCall;
    expect(uploadInput).toMatchObject({ projectId: PROJECT_ID, prepared: { file } });
    expect(uploadInput).not.toHaveProperty("purpose");
    expect(hooks.createFloorplan.mutate).toHaveBeenCalledOnce();
    expect(hooks.createFloorplan.mutate.mock.calls[0]?.[0]).toMatchObject({
      projectId: PROJECT_ID,
      input: {
        mediaAssetId: UPLOADED_MEDIA_ID,
        name: "Eerste verdieping",
        floorNumber: 1,
        sortOrder: 1,
      },
    });
  });

  it("toont de processingstatus en blokkeert koppelen totdat media ready is", async () => {
    let resolveUpload: ((asset: ReturnType<typeof readyUploadedAsset>) => void) | undefined;
    mediaClient.uploadFloorplan.mockImplementationOnce((input: FloorplanUploadCall) => {
      input.onStage?.("uploading");
      input.onStage?.("processing");
      return new Promise((resolve) => { resolveUpload = resolve; });
    });
    renderBoard();

    fireEvent.click(screen.getByRole("button", { name: "Plattegrond toevoegen" }));
    fireEvent.change(screen.getByLabelText("Afbeelding van de plattegrond"), {
      target: { files: [new File(["floorplan"], "verdieping.png", { type: "image/png" })] },
    });

    expect(await screen.findByRole("status")).toHaveTextContent("veilig verwerken");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "80");
    expect(screen.getByRole("button", { name: "Toevoegen" })).toBeDisabled();

    await act(async () => resolveUpload?.(readyUploadedAsset()));
    await waitFor(() => expect(screen.getByRole("button", { name: "Toevoegen" })).toBeEnabled());
  });

  it("herprobeert een mislukte upload met exact dezelfde idempotency-key en voorbereide bytes", async () => {
    mediaClient.uploadFloorplan
      .mockRejectedValueOnce(new Error("Opslag tijdelijk niet bereikbaar."))
      .mockImplementationOnce(async (input: FloorplanUploadCall) => {
        input.onStage?.("uploading");
        input.onStage?.("processing");
        input.onStage?.("ready");
        return readyUploadedAsset();
      });
    renderBoard();

    fireEvent.click(screen.getByRole("button", { name: "Plattegrond toevoegen" }));
    fireEvent.change(screen.getByLabelText("Afbeelding van de plattegrond"), {
      target: { files: [new File(["floorplan"], "zolder.png", { type: "image/png" })] },
    });

    expect(await screen.findByText("Opslag tijdelijk niet bereikbaar.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zelfde upload opnieuw proberen" }));
    expect(await screen.findByRole("status")).toHaveTextContent("klaar om toe te voegen");

    expect(mediaClient.uploadFloorplan).toHaveBeenCalledTimes(2);
    const first = mediaClient.uploadFloorplan.mock.calls[0]?.[0] as FloorplanUploadCall;
    const second = mediaClient.uploadFloorplan.mock.calls[1]?.[0] as FloorplanUploadCall;
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.prepared).toBe(first.prepared);
    expect(mediaClient.prepare).toHaveBeenCalledOnce();
  });

  it("verbergt alle editorcontrols voor een niet-bewerkende viewer", () => {
    renderBoard({ ...board, viewerAccess: "public", canEdit: false });

    expect(screen.getByText(/bekijk waar de gepubliceerde Bouwmomenten/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Plattegrond toevoegen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /pin plaatsen/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bewerk" })).not.toBeInTheDocument();
  });
});
