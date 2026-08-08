import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Hammer,
  ImagePlus,
  Loader2,
  Move,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type {
  Floorplan,
  FloorplanPin,
  PlanningMutationResult,
} from "../../../shared/contracts/planning";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useCreateFloorplan,
  useCreateFloorplanPin,
  useDeleteFloorplan,
  useDeleteFloorplanPin,
  useFloorplanBoard,
  useUpdateFloorplan,
  useUpdateFloorplanPin,
} from "@/hooks/usePlanning";
import { ApiClientError } from "@/lib/apiClient";
import { createClientIdempotencyKey } from "@/lib/clientIdempotency";
import { createPlanningIdempotencyKey } from "@/lib/planningApi";
import {
  preparePrivateProjectImage,
  uploadFloorplanImage,
  type PreparedProjectImage,
  type ProjectMediaUploadStage,
} from "@/lib/privateMediaApi";
import { cn } from "@/lib/utils";
import type { MutateOptions } from "@tanstack/react-query";
import { toast } from "sonner";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEYBOARD_PIN_STEP = 0.01;

export type FloorplanUpdateOption = {
  id: string;
  label: string;
};

export interface FloorplanBoardProps {
  projectId: string;
  availableUpdates?: readonly FloorplanUpdateOption[];
  className?: string;
}

type FloorplanUploadStage = "idle" | "preparing" | ProjectMediaUploadStage | "error";

type FloorplanUploadDraft = {
  file: File;
  idempotencyKey: string;
  prepared?: PreparedProjectImage;
};

type RetryState = {
  message: string;
  retry: () => void;
  retryLabel: string;
};

type MutationLike<TVariables> = {
  mutate: (
    variables: TVariables,
    options?: MutateOptions<PlanningMutationResult, Error, TVariables>,
  ) => void;
};

type DragState = {
  pin: FloorplanPin;
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
};

function clampCoordinate(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100_000) / 100_000;
}

function parseCoordinate(value: string): number | null {
  if (!/^\d+(?:[.,]\d{1,5})?$/.test(value.trim())) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? clampCoordinate(parsed)
    : null;
}

function planningErrorMessage(error: Error): string {
  if (error instanceof ApiClientError && error.status === 409) {
    return "De plattegrond is intussen gewijzigd. Haal de nieuwste versie op en probeer opnieuw.";
  }
  return error.message || "De wijziging kon niet worden opgeslagen.";
}

function floorLabel(floorplan: Floorplan): string {
  return floorplan.floorNumber === null
    ? floorplan.name
    : `${floorplan.name} · verdieping ${floorplan.floorNumber}`;
}

function floorplanUploadStatus(stage: FloorplanUploadStage): { label: string; progress: number } {
  switch (stage) {
    case "preparing":
      return { label: "Afbeelding veilig voorbereiden…", progress: 15 };
    case "uploading":
      return { label: "Plattegrond privé uploaden…", progress: 45 };
    case "processing":
      return { label: "Plattegrond veilig verwerken…", progress: 80 };
    case "ready":
      return { label: "Plattegrond is klaar om toe te voegen", progress: 100 };
    case "error":
      return { label: "Upload onderbroken", progress: 0 };
    default:
      return { label: "Kies een afbeelding van je plattegrond", progress: 0 };
  }
}

export function FloorplanBoard({
  projectId,
  availableUpdates = [],
  className,
}: FloorplanBoardProps) {
  const boardQuery = useFloorplanBoard(projectId);
  const createFloorplanMutation = useCreateFloorplan(projectId);
  const updateFloorplanMutation = useUpdateFloorplan(projectId);
  const deleteFloorplanMutation = useDeleteFloorplan(projectId);
  const createPinMutation = useCreateFloorplanPin(projectId);
  const updatePinMutation = useUpdateFloorplanPin(projectId);
  const deletePinMutation = useDeleteFloorplanPin(projectId);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const floorplanUploadRef = useRef<FloorplanUploadDraft | null>(null);
  const floorplanUploadAbortRef = useRef<AbortController | null>(null);
  const floorplanUploadAttemptRef = useRef(0);
  const [activeFloorplanId, setActiveFloorplanId] = useState<string | null>(null);
  const [showCreateFloorplan, setShowCreateFloorplan] = useState(false);
  const [mediaAssetId, setMediaAssetId] = useState("");
  const [floorplanName, setFloorplanName] = useState("");
  const [floorNumber, setFloorNumber] = useState("");
  const [editingFloorplan, setEditingFloorplan] = useState(false);
  const [editName, setEditName] = useState("");
  const [editFloorNumber, setEditFloorNumber] = useState("");
  const [placementUpdateId, setPlacementUpdateId] = useState("");
  const [placementLabel, setPlacementLabel] = useState("");
  const [coordinateX, setCoordinateX] = useState("0,50");
  const [coordinateY, setCoordinateY] = useState("0,50");
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [selectedPinLabel, setSelectedPinLabel] = useState("");
  const [drag, setDrag] = useState<DragState | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [retryState, setRetryState] = useState<RetryState | null>(null);
  const [floorplanUploadStage, setFloorplanUploadStage] = useState<FloorplanUploadStage>("idle");
  const [floorplanUploadError, setFloorplanUploadError] = useState<string | null>(null);
  const [floorplanFileName, setFloorplanFileName] = useState<string | null>(null);

  const board = boardQuery.data;
  const floorplans = board?.floorplans ?? [];
  const activeFloorplan = floorplans.find((floorplan) => floorplan.id === activeFloorplanId)
    ?? floorplans[0]
    ?? null;
  const selectedPin = activeFloorplan?.pins.find((pin) => pin.id === selectedPinId) ?? null;
  const pinnedUpdateIds = useMemo(
    () => new Set(activeFloorplan?.pins.map((pin) => pin.updateId) ?? []),
    [activeFloorplan],
  );
  const availableUnpinnedUpdates = availableUpdates.filter(
    (update) => !pinnedUpdateIds.has(update.id),
  );
  const mutationPending = createFloorplanMutation.isPending
    || updateFloorplanMutation.isPending
    || deleteFloorplanMutation.isPending
    || createPinMutation.isPending
    || updatePinMutation.isPending
    || deletePinMutation.isPending;
  const floorplanUploadBusy = ["preparing", "uploading", "processing"].includes(
    floorplanUploadStage,
  );
  const uploadStatus = floorplanUploadStatus(floorplanUploadStage);

  useEffect(() => () => {
    floorplanUploadAttemptRef.current += 1;
    floorplanUploadAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!activeFloorplan) {
      setActiveFloorplanId(null);
      return;
    }
    if (activeFloorplan.id !== activeFloorplanId) setActiveFloorplanId(activeFloorplan.id);
  }, [activeFloorplan, activeFloorplanId]);

  useEffect(() => {
    if (!selectedPin) {
      setSelectedPinLabel("");
      return;
    }
    setSelectedPinLabel(selectedPin.label ?? "");
  }, [selectedPin]);

  const runMutation = <TVariables,>(
    mutation: MutationLike<TVariables>,
    variables: TVariables,
    successMessage: string,
    onSuccess?: () => void,
  ) => {
    const execute = () => mutation.mutate(variables, {
      onSuccess: () => {
        setRetryState(null);
        setValidationError(null);
        toast.success(successMessage);
        onSuccess?.();
      },
      onError: (error) => {
        console.error("Planning mutation failed", error);
        const message = planningErrorMessage(error);
        const isConflict = error instanceof ApiClientError && error.status === 409;
        setRetryState({
          message,
          retry: isConflict ? () => void boardQuery.refetch() : execute,
          retryLabel: isConflict ? "Nieuwste versie ophalen" : "Zelfde aanvraag opnieuw proberen",
        });
        toast.error(message);
      },
    });
    execute();
  };

  const resetFloorplanUpload = () => {
    floorplanUploadAttemptRef.current += 1;
    floorplanUploadAbortRef.current?.abort();
    floorplanUploadAbortRef.current = null;
    floorplanUploadRef.current = null;
    setFloorplanUploadStage("idle");
    setFloorplanUploadError(null);
    setFloorplanFileName(null);
    setMediaAssetId("");
  };

  const runFloorplanUpload = async (draft: FloorplanUploadDraft) => {
    floorplanUploadAbortRef.current?.abort();
    const controller = new AbortController();
    const attempt = floorplanUploadAttemptRef.current + 1;
    floorplanUploadAttemptRef.current = attempt;
    floorplanUploadAbortRef.current = controller;
    floorplanUploadRef.current = draft;
    setFloorplanUploadError(null);
    setMediaAssetId("");

    try {
      setFloorplanUploadStage("preparing");
      const prepared = draft.prepared ?? await preparePrivateProjectImage(draft.file);
      if (attempt !== floorplanUploadAttemptRef.current || controller.signal.aborted) return;
      const preparedDraft = { ...draft, prepared };
      floorplanUploadRef.current = preparedDraft;
      const asset = await uploadFloorplanImage({
        projectId,
        idempotencyKey: preparedDraft.idempotencyKey,
        prepared,
        signal: controller.signal,
        onStage: (stage) => {
          if (attempt === floorplanUploadAttemptRef.current) setFloorplanUploadStage(stage);
        },
      });
      if (attempt !== floorplanUploadAttemptRef.current || controller.signal.aborted) return;
      setMediaAssetId(asset.id);
      setFloorplanUploadStage("ready");
    } catch (error) {
      if (attempt !== floorplanUploadAttemptRef.current || controller.signal.aborted) return;
      console.error("Floorplan private-media upload failed", {
        code: error instanceof Error ? error.name : "UNKNOWN",
      });
      const message = error instanceof Error && error.message
        ? error.message
        : "De plattegrond kon niet veilig worden geüpload.";
      setFloorplanUploadStage("error");
      setFloorplanUploadError(message);
      toast.error(message);
    }
  };

  const selectFloorplanFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || floorplanUploadBusy || mutationPending) return;
    try {
      const draft: FloorplanUploadDraft = {
        file,
        idempotencyKey: createClientIdempotencyKey("floorplan-upload"),
      };
      setFloorplanFileName(file.name);
      setValidationError(null);
      void runFloorplanUpload(draft);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Deze browser kan geen veilige uploadopdracht maken.";
      setFloorplanUploadStage("error");
      setFloorplanUploadError(message);
      toast.error(message);
    }
  };

  const retryFloorplanUpload = () => {
    const draft = floorplanUploadRef.current;
    if (!draft || floorplanUploadBusy) return;
    void runFloorplanUpload(draft);
  };

  const createNewFloorplan = (event: FormEvent) => {
    event.preventDefault();
    const normalizedName = floorplanName.trim();
    const parsedFloor = floorNumber.trim() === "" ? null : Number(floorNumber);
    if (floorplanUploadStage !== "ready" || !UUID.test(mediaAssetId.trim())) {
      setValidationError("Kies een plattegrondafbeelding en wacht tot de verwerking klaar is.");
      return;
    }
    if (!normalizedName) {
      setValidationError("Geef de plattegrond een naam.");
      return;
    }
    if (parsedFloor !== null && (!Number.isInteger(parsedFloor) || parsedFloor < -20 || parsedFloor > 200)) {
      setValidationError("Het verdiepingsnummer moet tussen -20 en 200 liggen.");
      return;
    }
    const variables = {
      projectId,
      input: {
        idempotencyKey: createPlanningIdempotencyKey("floorplan-create"),
        mediaAssetId: mediaAssetId.trim(),
        name: normalizedName,
        floorNumber: parsedFloor,
        sortOrder: Math.max(-1, ...floorplans.map((floorplan) => floorplan.sortOrder)) + 1,
      },
    };
    runMutation(createFloorplanMutation, variables, "Plattegrond toegevoegd", () => {
      resetFloorplanUpload();
      setFloorplanName("");
      setFloorNumber("");
      setShowCreateFloorplan(false);
    });
  };

  const startEditingFloorplan = () => {
    if (!activeFloorplan) return;
    setEditName(activeFloorplan.name);
    setEditFloorNumber(activeFloorplan.floorNumber?.toString() ?? "");
    setEditingFloorplan(true);
  };

  const saveFloorplan = (event: FormEvent) => {
    event.preventDefault();
    if (!activeFloorplan) return;
    const parsedFloor = editFloorNumber.trim() === "" ? null : Number(editFloorNumber);
    if (!editName.trim()) {
      setValidationError("Geef de plattegrond een naam.");
      return;
    }
    if (parsedFloor !== null && (!Number.isInteger(parsedFloor) || parsedFloor < -20 || parsedFloor > 200)) {
      setValidationError("Het verdiepingsnummer moet tussen -20 en 200 liggen.");
      return;
    }
    runMutation(updateFloorplanMutation, {
      projectId,
      floorplanId: activeFloorplan.id,
      input: {
        idempotencyKey: createPlanningIdempotencyKey("floorplan-update"),
        expectedVersion: activeFloorplan.version,
        name: editName.trim(),
        floorNumber: parsedFloor,
      },
    }, "Plattegrond bijgewerkt", () => setEditingFloorplan(false));
  };

  const removeActiveFloorplan = () => {
    if (!activeFloorplan) return;
    runMutation(deleteFloorplanMutation, {
      projectId,
      floorplanId: activeFloorplan.id,
      input: {
        idempotencyKey: createPlanningIdempotencyKey("floorplan-delete"),
        expectedVersion: activeFloorplan.version,
      },
    }, "Plattegrond verwijderd", () => {
      setActiveFloorplanId(null);
      setSelectedPinId(null);
    });
  };

  const createPinAt = (x: number, y: number) => {
    if (!activeFloorplan || !UUID.test(placementUpdateId)) {
      setValidationError("Kies een geldige update voordat je een pin plaatst.");
      return;
    }
    runMutation(createPinMutation, {
      projectId,
      floorplanId: activeFloorplan.id,
      input: {
        idempotencyKey: createPlanningIdempotencyKey("pin-create"),
        updateId: placementUpdateId,
        x: clampCoordinate(x),
        y: clampCoordinate(y),
        label: placementLabel.trim() || undefined,
      },
    }, "Pin geplaatst", () => {
      setPlacementUpdateId("");
      setPlacementLabel("");
    });
  };

  const placePinWithKeyboard = (event: FormEvent) => {
    event.preventDefault();
    const x = parseCoordinate(coordinateX);
    const y = parseCoordinate(coordinateY);
    if (x === null || y === null) {
      setValidationError("Gebruik coördinaten tussen 0 en 1 met maximaal vijf decimalen.");
      return;
    }
    createPinAt(x, y);
  };

  const positionFromPointer = (event: ReactPointerEvent): { x: number; y: number } | null => {
    const container = imageContainerRef.current;
    if (!container) return null;
    const bounds = container.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    return {
      x: clampCoordinate((event.clientX - bounds.left) / bounds.width),
      y: clampCoordinate((event.clientY - bounds.top) / bounds.height),
    };
  };

  const placePinFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!board?.canEdit || !placementUpdateId || drag) return;
    const position = positionFromPointer(event);
    if (position) createPinAt(position.x, position.y);
  };

  const startDraggingPin = (event: ReactPointerEvent<HTMLButtonElement>, pin: FloorplanPin) => {
    if (!board?.canEdit) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedPinId(pin.id);
    setDrag({ pin, pointerId: event.pointerId, x: pin.x, y: pin.y, moved: false });
  };

  const moveDraggingPin = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const position = positionFromPointer(event);
    if (!position) return;
    setDrag({ ...drag, ...position, moved: true });
  };

  const finishDraggingPin = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag || drag.pointerId !== event.pointerId || !activeFloorplan) return;
    event.stopPropagation();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const completed = drag;
    setDrag(null);
    if (!completed.moved) return;
    runMutation(updatePinMutation, {
      projectId,
      floorplanId: activeFloorplan.id,
      pinId: completed.pin.id,
      input: {
        idempotencyKey: createPlanningIdempotencyKey("pin-update"),
        expectedVersion: completed.pin.version,
        x: completed.x,
        y: completed.y,
      },
    }, "Pin verplaatst");
  };

  const moveSelectedPin = (deltaX: number, deltaY: number) => {
    if (!activeFloorplan || !selectedPin) return;
    runMutation(updatePinMutation, {
      projectId,
      floorplanId: activeFloorplan.id,
      pinId: selectedPin.id,
      input: {
        idempotencyKey: createPlanningIdempotencyKey("pin-update"),
        expectedVersion: selectedPin.version,
        x: clampCoordinate(selectedPin.x + deltaX),
        y: clampCoordinate(selectedPin.y + deltaY),
      },
    }, "Pin verplaatst");
  };

  const saveSelectedPinLabel = () => {
    if (!activeFloorplan || !selectedPin) return;
    runMutation(updatePinMutation, {
      projectId,
      floorplanId: activeFloorplan.id,
      pinId: selectedPin.id,
      input: {
        idempotencyKey: createPlanningIdempotencyKey("pin-update"),
        expectedVersion: selectedPin.version,
        label: selectedPinLabel.trim() || null,
      },
    }, "Pinlabel bijgewerkt");
  };

  const removeSelectedPin = () => {
    if (!activeFloorplan || !selectedPin) return;
    runMutation(deletePinMutation, {
      projectId,
      floorplanId: activeFloorplan.id,
      pinId: selectedPin.id,
      input: {
        idempotencyKey: createPlanningIdempotencyKey("pin-delete"),
        expectedVersion: selectedPin.version,
      },
    }, "Pin verwijderd", () => setSelectedPinId(null));
  };

  if (boardQuery.isLoading) {
    return (
      <section className={cn("flex min-h-64 items-center justify-center gap-3 rounded-xl border border-border", className)} aria-label="Plattegronden" aria-busy="true">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Plattegronden laden</span>
      </section>
    );
  }

  if (boardQuery.error || !board) {
    return (
      <Alert variant="destructive" className={className}>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Plattegronden niet beschikbaar</AlertTitle>
        <AlertDescription>
          <p>{boardQuery.error?.message || "Dit project bestaat niet of is niet toegankelijk."}</p>
          <Button type="button" variant="outline" className="mt-4" onClick={() => boardQuery.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Opnieuw proberen
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <section className={cn("space-y-6", className)} aria-labelledby="floorplan-board-title">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">Plattegronden</p>
          <h2 id="floorplan-board-title" className="font-serif text-3xl italic">Updates op hun plek.</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {board.canEdit
              ? "Plaats pins met de muis, aanraking of exacte toetsenbordcoördinaten."
              : "Bekijk waar de gepubliceerde updates in het project plaatsvinden."}
          </p>
        </div>
        {boardQuery.isFetching && (
          <span role="status" className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Vernieuwen
          </span>
        )}
      </header>

      {floorplans.length > 0 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Verdiepingen">
          {floorplans.map((floorplan) => {
            const active = floorplan.id === activeFloorplan?.id;
            return (
              <button
                key={floorplan.id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`floorplan-panel-${floorplan.id}`}
                onClick={() => {
                  setActiveFloorplanId(floorplan.id);
                  setSelectedPinId(null);
                  setPlacementUpdateId("");
                  setEditingFloorplan(false);
                }}
                className={cn(
                  "min-h-11 rounded-full border px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background hover:border-foreground",
                )}
              >
                {floorLabel(floorplan)}
              </button>
            );
          })}
        </div>
      )}

      {board.canEdit && (
        <div>
          {!showCreateFloorplan ? (
            <Button type="button" variant="outline" onClick={() => setShowCreateFloorplan(true)}>
              <ImagePlus className="mr-2 h-4 w-4" /> Plattegrond toevoegen
            </Button>
          ) : (
            <form onSubmit={createNewFloorplan} className="grid gap-4 rounded-xl border border-border bg-muted/30 p-5" aria-label="Plattegrond toevoegen">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="floorplan-file">Afbeelding van de plattegrond</Label>
                  <Input
                    id="floorplan-file"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"
                    capture="environment"
                    onChange={selectFloorplanFile}
                    disabled={floorplanUploadBusy || mutationPending}
                  />
                  <p className="text-xs text-muted-foreground">
                    Maak een foto of kies JPG, PNG, WebP, AVIF, HEIC of HEIF. Het bestand blijft privé en wordt eerst veilig verwerkt.
                  </p>
                  {floorplanFileName && (
                    <p className="break-all text-sm font-medium">{floorplanFileName}</p>
                  )}
                  {floorplanUploadStage !== "idle" && (
                    <div className="space-y-2" aria-live="polite">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span role="status" className="inline-flex items-center gap-2">
                          {floorplanUploadBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                          {floorplanUploadStage === "ready" && <Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" />}
                          {uploadStatus.label}
                        </span>
                        <span className="tabular-nums">{uploadStatus.progress}%</span>
                      </div>
                      <div
                        role="progressbar"
                        aria-label="Voortgang plattegrondupload"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={uploadStatus.progress}
                        className="h-1.5 overflow-hidden rounded-full bg-muted"
                      >
                        <div
                          className="h-full rounded-full bg-accent transition-[width] duration-300"
                          style={{ width: `${uploadStatus.progress}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {floorplanUploadError && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Upload niet voltooid</AlertTitle>
                      <AlertDescription className="space-y-3">
                        <p>{floorplanUploadError}</p>
                        {floorplanUploadRef.current && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={retryFloorplanUpload}
                            disabled={floorplanUploadBusy || mutationPending}
                          >
                            <RefreshCw className="mr-2 h-3.5 w-3.5" /> Zelfde upload opnieuw proberen
                          </Button>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="floorplan-number">Verdieping, optioneel</Label>
                  <Input
                    id="floorplan-number"
                    type="number"
                    min={-20}
                    max={200}
                    value={floorNumber}
                    onChange={(event) => setFloorNumber(event.target.value)}
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="floorplan-name">Naam</Label>
                <Input
                  id="floorplan-name"
                  value={floorplanName}
                  onChange={(event) => setFloorplanName(event.target.value)}
                  placeholder="Bijv. Begane grond"
                  maxLength={80}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  disabled={mutationPending || floorplanUploadBusy || floorplanUploadStage !== "ready"}
                >
                  {createFloorplanMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  Toevoegen
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    resetFloorplanUpload();
                    setShowCreateFloorplan(false);
                  }}
                  disabled={mutationPending}
                >
                  Annuleren
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {activeFloorplan ? (
        <div
          id={`floorplan-panel-${activeFloorplan.id}`}
          role="tabpanel"
          className="space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-medium">{floorLabel(activeFloorplan)}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {activeFloorplan.pins.length} {activeFloorplan.pins.length === 1 ? "pin" : "pins"}
              </p>
            </div>
            {board.canEdit && !editingFloorplan && (
              <div className="flex gap-1">
                <Button type="button" size="sm" variant="ghost" onClick={startEditingFloorplan}>
                  <Pencil className="mr-1.5 h-3.5 w-3.5" /> Bewerk
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Verwijder
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Plattegrond verwijderen?</AlertDialogTitle>
                      <AlertDialogDescription>
                        “{activeFloorplan.name}” en alle pins op deze plattegrond worden verwijderd.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Annuleren</AlertDialogCancel>
                      <AlertDialogAction onClick={removeActiveFloorplan} disabled={deleteFloorplanMutation.isPending}>
                        Verwijderen
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </div>

          {editingFloorplan && (
            <form onSubmit={saveFloorplan} className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-[1fr_10rem_auto]" aria-label="Plattegrond bewerken">
              <div className="space-y-2">
                <Label htmlFor="edit-floorplan-name">Naam</Label>
                <Input id="edit-floorplan-name" value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={80} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-floorplan-number">Verdieping</Label>
                <Input id="edit-floorplan-number" type="number" min={-20} max={200} value={editFloorNumber} onChange={(event) => setEditFloorNumber(event.target.value)} />
              </div>
              <div className="flex items-end gap-1">
                <Button type="submit" size="icon" aria-label="Plattegrond opslaan" disabled={updateFloorplanMutation.isPending}>
                  {updateFloorplanMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                </Button>
                <Button type="button" size="icon" variant="ghost" aria-label="Bewerken annuleren" onClick={() => setEditingFloorplan(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </form>
          )}

          <div
            ref={imageContainerRef}
            className={cn(
              "relative overflow-hidden rounded-xl border-2 bg-muted",
              board.canEdit && placementUpdateId ? "cursor-crosshair border-accent" : "border-border",
            )}
            onPointerDown={placePinFromPointer}
          >
            <img
              src={activeFloorplan.media.proxyPath}
              alt={`Plattegrond ${activeFloorplan.name}`}
              className="block h-auto w-full select-none"
              draggable={false}
            />
            {activeFloorplan.pins.map((pin) => {
              const dragged = drag?.pin.id === pin.id;
              const x = dragged ? drag.x : pin.x;
              const y = dragged ? drag.y : pin.y;
              const selected = selectedPinId === pin.id;
              return (
                <button
                  key={pin.id}
                  type="button"
                  aria-label={`${pin.label || pin.update.title || "Updatepin"} selecteren`}
                  aria-pressed={selected}
                  onPointerDown={(event) => startDraggingPin(event, pin)}
                  onPointerMove={moveDraggingPin}
                  onPointerUp={finishDraggingPin}
                  onPointerCancel={() => setDrag(null)}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedPinId(selected ? null : pin.id);
                  }}
                  className={cn(
                    "absolute -translate-x-1/2 -translate-y-1/2 touch-none rounded-full bg-accent p-2 text-accent-foreground shadow-lg transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    board.canEdit && "cursor-grab active:cursor-grabbing",
                    (selected || dragged) && "z-20 scale-125 ring-2 ring-accent/40",
                  )}
                  style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
                >
                  <Hammer className="h-4 w-4" />
                </button>
              );
            })}
          </div>

          {board.canEdit && (
            <form onSubmit={placePinWithKeyboard} className="rounded-xl border border-border p-5" aria-labelledby="place-pin-title">
              <div className="flex items-start gap-3">
                <Move className="mt-0.5 h-5 w-5 text-muted-foreground" />
                <div>
                  <h4 id="place-pin-title" className="font-medium">Pin plaatsen</h4>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Kies een update en klik op de afbeelding, of vul voor toetsenbordbediening exacte coördinaten tussen 0 en 1 in.
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pin-update-id">Update</Label>
                  <Input
                    id="pin-update-id"
                    list="floorplan-update-options"
                    value={placementUpdateId}
                    onChange={(event) => setPlacementUpdateId(event.target.value)}
                    placeholder="Kies of plak een update-ID"
                    autoComplete="off"
                  />
                  <datalist id="floorplan-update-options">
                    {availableUnpinnedUpdates.map((update) => <option key={update.id} value={update.id}>{update.label}</option>)}
                  </datalist>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pin-label">Label, optioneel</Label>
                  <Input id="pin-label" value={placementLabel} onChange={(event) => setPlacementLabel(event.target.value)} maxLength={80} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pin-x">Horizontale positie (0–1)</Label>
                  <Input id="pin-x" value={coordinateX} onChange={(event) => setCoordinateX(event.target.value)} inputMode="decimal" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pin-y">Verticale positie (0–1)</Label>
                  <Input id="pin-y" value={coordinateY} onChange={(event) => setCoordinateY(event.target.value)} inputMode="decimal" />
                </div>
              </div>
              <Button type="submit" className="mt-4" disabled={createPinMutation.isPending || !placementUpdateId}>
                {createPinMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Pin plaatsen met coördinaten
              </Button>
            </form>
          )}

          {selectedPin && (
            <div className="rounded-xl border border-accent/40 bg-accent/5 p-5" aria-live="polite">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="font-medium">{selectedPin.label || selectedPin.update.title || "Geselecteerde pin"}</h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedPin.update.status === "published" ? "Gepubliceerde update" : "Conceptupdate"} · {selectedPin.x.toFixed(2)}, {selectedPin.y.toFixed(2)}
                  </p>
                </div>
                <Button type="button" size="icon" variant="ghost" aria-label="Pinselectie sluiten" onClick={() => setSelectedPinId(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {board.canEdit && (
                <div className="mt-5 grid gap-5 md:grid-cols-[auto_1fr_auto] md:items-end">
                  <fieldset>
                    <legend className="mb-2 text-xs font-medium text-muted-foreground">Verplaats met toetsenbord</legend>
                    <div className="grid w-fit grid-cols-3 gap-1">
                      <span />
                      <Button type="button" size="icon" variant="outline" aria-label="Pin omhoog" onClick={() => moveSelectedPin(0, -KEYBOARD_PIN_STEP)} disabled={mutationPending}>
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <span />
                      <Button type="button" size="icon" variant="outline" aria-label="Pin naar links" onClick={() => moveSelectedPin(-KEYBOARD_PIN_STEP, 0)} disabled={mutationPending}>
                        <ArrowLeft className="h-4 w-4" />
                      </Button>
                      <Button type="button" size="icon" variant="outline" aria-label="Pin omlaag" onClick={() => moveSelectedPin(0, KEYBOARD_PIN_STEP)} disabled={mutationPending}>
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button type="button" size="icon" variant="outline" aria-label="Pin naar rechts" onClick={() => moveSelectedPin(KEYBOARD_PIN_STEP, 0)} disabled={mutationPending}>
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </fieldset>
                  <div className="space-y-2">
                    <Label htmlFor={`selected-pin-label-${selectedPin.id}`}>Pinlabel</Label>
                    <Input
                      id={`selected-pin-label-${selectedPin.id}`}
                      value={selectedPinLabel}
                      onChange={(event) => setSelectedPinLabel(event.target.value)}
                      maxLength={80}
                    />
                    <Button type="button" size="sm" variant="outline" onClick={saveSelectedPinLabel} disabled={mutationPending}>
                      Label opslaan
                    </Button>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="ghost" className="text-destructive hover:text-destructive">
                        <Trash2 className="mr-2 h-4 w-4" /> Pin verwijderen
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Pin verwijderen?</AlertDialogTitle>
                        <AlertDialogDescription>De gekoppelde update zelf blijft behouden.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Annuleren</AlertDialogCancel>
                        <AlertDialogAction onClick={removeSelectedPin} disabled={deletePinMutation.isPending}>
                          Pin verwijderen
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
          <ImagePlus className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">Nog geen plattegrond</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {board.canEdit
              ? "Voeg een afbeelding toe om updates op de juiste plek te zetten."
              : "De eigenaar heeft nog geen zichtbare plattegrond toegevoegd."}
          </p>
        </div>
      )}

      {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
      {retryState && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Wijziging niet opgeslagen</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{retryState.message}</span>
            <Button type="button" size="sm" variant="outline" onClick={retryState.retry} disabled={mutationPending}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> {retryState.retryLabel}
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}

export default FloorplanBoard;
