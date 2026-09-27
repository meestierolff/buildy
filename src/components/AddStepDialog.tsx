import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  useCreateProjectPhaseMutation,
  useCreateProjectUpdateMutation,
  useProjectOverview,
} from "@/hooks/useProjectApi";
import { usePrivateMediaUpload } from "@/hooks/usePrivateMediaUpload";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import PhaseSelect, { DEFAULT_PHASES } from "./PhaseSelect";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Loader2, X } from "lucide-react";
import DiscardUpdateDraftDialog from "@/components/project/DiscardUpdateDraftDialog";
import ProjectImagePicker from "@/components/project/ProjectImagePicker";
import { ResilientImage } from "@/components/ResilientMedia";
import { getUpdateComposerCloseIntent } from "@/lib/updateComposerState";
import { ApiClientError } from "@/lib/apiClient";
import { createClientIdempotencyKey } from "@/lib/clientIdempotency";
import {
  isSupportedProjectImageType,
  preparePrivateProjectImage,
  PrivateMediaUploadError,
  type PreparedProjectImage,
} from "@/lib/privateMediaApi";
import { useAppFeatures } from "@/lib/appFeatures";
import { buildCreateUpdateCommand } from "@/lib/projectWriteFlow";
import { selectUniqueLocalFiles } from "@/lib/projectImageSelection";
import {
  deleteLandingPhotoHandoff,
  landingPhotoHandoffFile,
  loadLandingPhotoHandoff,
} from "@/lib/landingPhotoHandoffStore";
import {
  deleteUpdateComposerDraft,
  loadUpdateComposerDraft,
  saveUpdateComposerDraft,
  type StoredUpdateComposerDraft,
} from "@/lib/updateComposerDraftStore";
import type { CreateProjectPhaseInput, CreateUpdateInput } from "../../shared/contracts/projects";

interface AddStepDialogProps {
  projectId: string;
  importLandingPhoto?: boolean;
  onClose: () => void;
  onAdded: () => void;
}

type CompareRole = "before" | "after";

interface PendingUpload {
  id: string;
  file: File;
  previewUrl: string;
  compareRole: CompareRole | null;
  assetId?: string;
}

interface UploadCacheEntry {
  prepared?: PreparedProjectImage;
  assetId?: string;
}

class UpdateDraftError extends Error {}
class LandingPhotoCleanupError extends Error {}

// Re-export so existing imports keep working.
export const PHASES = DEFAULT_PHASES;

const AddStepDialog = ({
  projectId,
  importLandingPhoto = false,
  onClose,
  onAdded,
}: AddStepDialogProps) => {
  const appFeatures = useAppFeatures();
  const mediaFeaturesEnabled = appFeatures.mediaFeaturesEnabled;
  const { user } = useAuth();
  const projectQuery = useProjectOverview(projectId, Boolean(user));
  const createUpdate = useCreateProjectUpdateMutation(projectId);
  const createPhase = useCreateProjectPhaseMutation(projectId);
  const mediaUpload = usePrivateMediaUpload();
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [phaseId, setPhaseId] = useState("");
  const [isMilestone, setIsMilestone] = useState(false);
  const [description, setDescription] = useState("");
  const [updateDate, setUpdateDate] = useState(new Date().toISOString().split("T")[0]);
  const [files, setFiles] = useState<PendingUpload[]>([]);
  const previewUrlsRef = useRef<string[]>([]);
  const landingHandoffUploadIdRef = useRef<string | null>(null);
  const landingHandoffIdRef = useRef<string | null>(null);
  const landingHandoffNeedsCleanupRef = useRef(false);
  const uploadCacheRef = useRef(new Map<string, UploadCacheEntry>());
  const pendingCommandRef = useRef<CreateUpdateInput | null>(null);
  const pendingPhaseCommandRef = useRef<{ name: string; input: CreateProjectPhaseInput } | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [saveStage, setSaveStage] = useState<"idle" | "saving" | "uploading" | "processing">("idle");
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [activeUploadId, setActiveUploadId] = useState<string | null>(null);
  const [failedUploadId, setFailedUploadId] = useState<string | null>(null);
  const [retryingUploadId, setRetryingUploadId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [retryLocked, setRetryLocked] = useState(false);
  const [showDiscardPrompt, setShowDiscardPrompt] = useState(false);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [hasRestoredDraft, setHasRestoredDraft] = useState(false);
  const [draftPersistenceError, setDraftPersistenceError] = useState<string | null>(null);
  const [closingDraft, setClosingDraft] = useState(false);
  const submitGuardRef = useRef(false);
  const initialDateRef = useRef(updateDate);
  const updateIdempotencyKeyRef = useRef(createClientIdempotencyKey("update-create"));

  const formLocked = loading || retryLocked || retryingUploadId !== null;
  const phaseOptions = projectQuery.data?.phases.map((phase) => ({
    value: phase.id,
    label: phase.name,
  })) ?? [];

  const addCustomPhase = async (name: string): Promise<string> => {
    const normalizedName = name.trim();
    let pending = pendingPhaseCommandRef.current;
    if (!pending || pending.name.toLocaleLowerCase("nl-NL") !== normalizedName.toLocaleLowerCase("nl-NL")) {
      const latest = await projectQuery.refetch({ throwOnError: true });
      if (!latest.data?.canEdit) {
        throw new UpdateDraftError("Je hebt geen bewerkingsrechten voor deze verbouwing.");
      }
      pending = {
        name: normalizedName,
        input: {
          idempotencyKey: createClientIdempotencyKey("project-phase"),
          expectedProjectVersion: latest.data.version,
          name: normalizedName,
        },
      };
      pendingPhaseCommandRef.current = pending;
    }

    try {
      const result = await createPhase.mutateAsync(pending.input);
      pendingPhaseCommandRef.current = null;
      return result.phase.id;
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409) {
        const latest = await projectQuery.refetch({ throwOnError: true });
        const existing = latest.data?.phases.find((phase) => (
          phase.name.trim().toLocaleLowerCase("nl-NL") === normalizedName.toLocaleLowerCase("nl-NL")
        ));
        pendingPhaseCommandRef.current = null;
        if (existing) return existing.id;
      }
      throw error;
    }
  };

  const reorderUploads = (draggedId: string, targetId: string) => {
    if (formLocked || !draggedId || !targetId || draggedId === targetId) return;
    setFiles((previous) => {
      const next = [...previous];
      const from = next.findIndex((item) => item.id === draggedId);
      const to = next.findIndex((item) => item.id === targetId);
      if (from < 0 || to < 0) return previous;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const moveUpload = (id: string, direction: -1 | 1) => {
    if (formLocked) return;
    setFiles((previous) => {
      const from = previous.findIndex((upload) => upload.id === id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= previous.length) return previous;
      const next = [...previous];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current = [];
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!user?.id) {
      setDraftHydrated(true);
      return () => { active = false; };
    }

    const hydrateDraft = async () => {
      let draft: StoredUpdateComposerDraft | null = null;
      try {
        draft = await loadUpdateComposerDraft(user.id, projectId);
      } catch (error) {
        console.error("Restore update draft failed", error);
        if (active) setDraftPersistenceError("Dit apparaat kon je vorige concept niet herstellen.");
      }

      let landingPhoto = null;
      if (importLandingPhoto && mediaFeaturesEnabled) {
        try {
          landingPhoto = await loadLandingPhotoHandoff();
        } catch (error) {
          console.error("Restore landing photo handoff failed", error);
          if (active) {
            setDraftPersistenceError("De lokale foto kon niet worden overgenomen. Hij is niet geüpload en blijft op dit apparaat staan.");
          }
        }
      } else if (importLandingPhoto && active) {
        setDraftPersistenceError("Foto's toevoegen is nu niet beschikbaar. De lokale foto blijft op dit apparaat staan.");
      }

      if (!active) return;
      const restoredFiles = draft?.files.map((stored) => {
        const file = new File([stored.bytes], stored.name, {
          type: stored.contentType,
          lastModified: stored.lastModified,
        });
        const previewUrl = URL.createObjectURL(file);
        previewUrlsRef.current.push(previewUrl);
        uploadCacheRef.current.set(stored.id, stored.assetId ? { assetId: stored.assetId } : {});
        return {
          id: stored.id,
          file,
          previewUrl,
          compareRole: stored.compareRole,
          ...(stored.assetId ? { assetId: stored.assetId } : {}),
        } satisfies PendingUpload;
      }) ?? [];

      if (draft) {
        setTitle(draft.title);
        setPhaseId(draft.phaseId);
        setIsMilestone(draft.isMilestone);
        setDescription(draft.description);
        setUpdateDate(draft.updateDate);
        initialDateRef.current = draft.updateDate;
        updateIdempotencyKeyRef.current = draft.updateIdempotencyKey;
        pendingCommandRef.current = draft.pendingCommand;
        if (draft.pendingCommand) {
          setRetryLocked(true);
          setSaveError("Deze opdracht wacht nog op serverbevestiging. Probeer haar ongewijzigd opnieuw.");
        }
      }

      if (landingPhoto) {
        const uploadId = `media-upload:${landingPhoto.id}`;
        landingHandoffUploadIdRef.current = uploadId;
        landingHandoffIdRef.current = landingPhoto.id;
        landingHandoffNeedsCleanupRef.current = true;
        if (!restoredFiles.some((upload) => upload.id === uploadId)) {
          const file = landingPhotoHandoffFile(landingPhoto);
          const previewUrl = URL.createObjectURL(file);
          previewUrlsRef.current.push(previewUrl);
          restoredFiles.unshift({
            id: uploadId,
            file,
            previewUrl,
            compareRole: null,
          });
        }
      }

      setFiles((currentFiles) => {
        if (currentFiles.length === 0) return restoredFiles;
        const restoredIds = new Set(restoredFiles.map((upload) => upload.id));
        return [...restoredFiles, ...currentFiles.filter((upload) => !restoredIds.has(upload.id))];
      });
      setHasRestoredDraft(Boolean(draft || landingPhoto));
      setDraftHydrated(true);
    };

    void hydrateDraft();

    return () => { active = false; };
  }, [importLandingPhoto, mediaFeaturesEnabled, projectId, user?.id]);

  const addSelectedFiles = (selected: File[]) => {
    if (formLocked) return;
    const supported = selected.filter((file) => isSupportedProjectImageType(file.type));
    const uniqueSelection = selectUniqueLocalFiles(files.map((upload) => upload.file), supported);
    const remaining = Math.max(0, 50 - files.length);
    const accepted = uniqueSelection.files.slice(0, remaining);

    if (supported.length !== selected.length) {
      toast.error("Gebruik alleen JPG-, PNG-, WebP-, AVIF-, HEIC- of HEIF-foto's.");
    }
    if (uniqueSelection.duplicateCount > 0) {
      toast.error(uniqueSelection.duplicateCount === 1
        ? "Deze foto staat al in dit Bouwmoment."
        : `${uniqueSelection.duplicateCount} foto's stonden al in dit Bouwmoment.`);
    }
    if (uniqueSelection.files.length > remaining) {
      toast.error("Je kunt maximaal 50 foto's aan één Bouwmoment toevoegen.");
    }

    try {
      const nextUploads = accepted.map((file) => {
        const previewUrl = URL.createObjectURL(file);
        previewUrlsRef.current.push(previewUrl);
        return {
          id: createClientIdempotencyKey("media-upload"),
          file,
          previewUrl,
          compareRole: null,
        } satisfies PendingUpload;
      });
      setFiles((previous) => [...previous, ...nextUploads]);
    } catch (error) {
      console.error("Create secure upload identifier failed", error);
      toast.error("Deze browser kan geen veilige uploadopdracht maken.");
    }
  };

  const readyUpload = async (upload: PendingUpload): Promise<string> => {
    const cache = uploadCacheRef.current.get(upload.id) ?? {};
    if (cache.assetId) return cache.assetId;

    setActiveUploadId(upload.id);
    setFailedUploadId((current) => current === upload.id ? null : current);
    try {
      cache.prepared ??= await preparePrivateProjectImage(upload.file);
      uploadCacheRef.current.set(upload.id, cache);
      const asset = await mediaUpload.mutateAsync({
        projectId,
        idempotencyKey: upload.id,
        prepared: cache.prepared,
        onStage: (stage) => {
          if (stage === "processing") setSaveStage("processing");
          if (stage === "uploading") setSaveStage("uploading");
        },
      });
      if (asset.projectId !== projectId || asset.status !== "ready") {
        throw new UpdateDraftError("De server bevestigde de foto niet voor deze verbouwing.");
      }
      cache.assetId = asset.id;
      setFiles((previous) => previous.map((item) => (
        item.id === upload.id ? { ...item, assetId: asset.id } : item
      )));
      return asset.id;
    } catch (error) {
      setFailedUploadId(upload.id);
      throw error;
    } finally {
      setActiveUploadId((current) => current === upload.id ? null : current);
    }
  };

  const retryUpload = async (uploadId: string) => {
    if (formLocked) return;
    const upload = files.find((item) => item.id === uploadId);
    if (!upload || upload.assetId) return;

    setRetryingUploadId(uploadId);
    setSaveError(null);
    setSaveStage("uploading");
    setUploadProgress({ current: 1, total: 1 });
    try {
      await readyUpload(upload);
      toast.success("De foto is privé verwerkt. Plaats het Bouwmoment wanneer je klaar bent.");
    } catch (error) {
      const message = error instanceof PrivateMediaUploadError || error instanceof UpdateDraftError
        ? error.message
        : "Deze foto kon niet veilig worden verwerkt. Probeer haar opnieuw.";
      setSaveError(message);
      toast.error("De foto kon niet worden verwerkt.");
    } finally {
      setRetryingUploadId(null);
      setSaveStage("idle");
    }
  };

  const clearLandingPhotoHandoff = async (): Promise<void> => {
    if (!landingHandoffNeedsCleanupRef.current) return;
    const photoId = landingHandoffIdRef.current;
    if (!photoId) return;
    await deleteLandingPhotoHandoff(photoId);
    landingHandoffNeedsCleanupRef.current = false;
  };

  const removeFile = (id: string) => {
    if (formLocked) return;
    const removed = files.find((upload) => upload.id === id);
    if (removed) {
      URL.revokeObjectURL(removed.previewUrl);
      previewUrlsRef.current = previewUrlsRef.current.filter((url) => url !== removed.previewUrl);
    }
    uploadCacheRef.current.delete(id);
    setFailedUploadId((current) => current === id ? null : current);
    setFiles((previous) => previous.filter((upload) => upload.id !== id));
    if (id === landingHandoffUploadIdRef.current) {
      void clearLandingPhotoHandoff().catch((error) => {
        console.error("Clear removed landing photo handoff failed", error);
        setDraftPersistenceError("De verwijderde startfoto kon nog niet uit de lokale overdracht worden gewist. Probeer het opnieuw.");
      });
    }
  };

  const isDirty = Boolean(
    hasRestoredDraft || title.trim() || phaseId || isMilestone || description.trim() ||
    updateDate !== initialDateRef.current || files.length,
  );

  const draftSnapshot = (): StoredUpdateComposerDraft => ({
    version: 1,
    title,
    phaseId,
    isMilestone,
    description,
    updateDate,
    files: files.map((upload) => ({
      id: upload.id,
      name: upload.file.name,
      contentType: upload.file.type,
      lastModified: upload.file.lastModified,
      bytes: upload.file,
      compareRole: upload.compareRole,
      ...(upload.assetId || uploadCacheRef.current.get(upload.id)?.assetId
        ? { assetId: upload.assetId ?? uploadCacheRef.current.get(upload.id)?.assetId }
        : {}),
    })),
    updateIdempotencyKey: updateIdempotencyKeyRef.current,
    pendingCommand: pendingCommandRef.current,
    savedAt: new Date().toISOString(),
  });

  const persistDraft = async (): Promise<void> => {
    if (!user?.id) throw new UpdateDraftError("Log opnieuw in om dit concept veilig te bewaren.");
    await saveUpdateComposerDraft(user.id, projectId, draftSnapshot());
    try {
      await clearLandingPhotoHandoff();
    } catch (cause) {
      throw new LandingPhotoCleanupError(
        "De foto staat veilig in dit concept, maar de tijdelijke lokale overdracht kon nog niet worden gewist.",
        { cause },
      );
    }
    setDraftPersistenceError(null);
  };

  useEffect(() => {
    if (!draftHydrated || !user?.id || (!isDirty && !pendingCommandRef.current)) return;
    const timer = globalThis.setTimeout(() => {
      void persistDraft().catch((error) => {
        console.error("Persist update draft failed", error);
        setDraftPersistenceError(error instanceof LandingPhotoCleanupError
          ? error.message
          : "Concept kon niet op dit apparaat worden bewaard.");
      });
    }, 350);
    return () => globalThis.clearTimeout(timer);
  // `persistDraft` intentionally snapshots every listed state value after the debounce.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [description, draftHydrated, files, isDirty, isMilestone, phaseId, projectId, title, updateDate, user?.id]);

  const requestClose = () => {
    const intent = getUpdateComposerCloseIntent({
      isDirty,
      isSaving: loading || retryingUploadId !== null,
    });
    if (intent === "ignore") return;
    if (intent === "confirm-discard") {
      setShowDiscardPrompt(true);
      return;
    }
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !user ||
      submitGuardRef.current ||
      !updateDate ||
      (!title.trim() && !description.trim() && files.length === 0)
    ) return;

    submitGuardRef.current = true;
    setLoading(true);
    setSaveError(null);
    let updateRequestStarted = false;
    let saved = false;

    try {
      if (!pendingCommandRef.current) {
        const accessResult = projectQuery.data
          ? projectQuery
          : await projectQuery.refetch({ throwOnError: true });
        if (!accessResult.data?.canEdit) {
          throw new UpdateDraftError("Je hebt geen bewerkingsrechten voor deze verbouwing.");
        }

        const readyMedia: Array<{ assetId: string; compareRole: CompareRole | null }> = [];
        if (files.length > 0) {
          setSaveStage("uploading");
          setUploadProgress({ current: 0, total: files.length });
        }

        for (const [index, upload] of files.entries()) {
          setUploadProgress({ current: index + 1, total: files.length });
          const assetId = upload.assetId ?? await readyUpload(upload);
          readyMedia.push({ assetId, compareRole: upload.compareRole });
        }

        const latestProject = await projectQuery.refetch({ throwOnError: true });
        if (!latestProject.data?.canEdit) {
          throw new UpdateDraftError("Je hebt geen bewerkingsrechten voor deze verbouwing.");
        }
        pendingCommandRef.current = buildCreateUpdateCommand({
          title,
          description,
          updateDate,
          phaseId,
          isMilestone,
          media: readyMedia,
        }, latestProject.data, updateIdempotencyKeyRef.current);
        try {
          await persistDraft();
        } catch (error) {
          console.error("Persist update request before submit failed", error);
          setDraftPersistenceError("De herstelkopie van dit concept kon niet worden bijgewerkt.");
        }
      }

      setSaveStage("saving");
      updateRequestStarted = true;
      await createUpdate.mutateAsync(pendingCommandRef.current);

      pendingCommandRef.current = null;
      setRetryLocked(false);
      saved = true;
    } catch (error) {
      console.error("Add update failed", error);
      const definitiveUpdateRejection =
        updateRequestStarted &&
        error instanceof ApiClientError &&
        error.status < 500 &&
        ![408, 425, 429].includes(error.status);
      const uncertainUpdateOutcome = updateRequestStarted && !definitiveUpdateRejection;

      if (uncertainUpdateOutcome) {
        setRetryLocked(true);
        setSaveError("De serverbevestiging ontbreekt nog. Probeer exact dezelfde opdracht opnieuw; je veilige opdracht-ID blijft behouden.");
        toast.error("We konden het Bouwmoment nog niet bevestigen. Probeer opnieuw.");
      } else {
        if (definitiveUpdateRejection) {
          pendingCommandRef.current = null;
          updateIdempotencyKeyRef.current = createClientIdempotencyKey("update-create");
          void projectQuery.refetch();
        }
        setRetryLocked(false);
        const message = error instanceof ApiClientError ||
          error instanceof PrivateMediaUploadError ||
          error instanceof UpdateDraftError
          ? error.message
          : "Opslaan lukte niet. Je concept staat nog hier; probeer opnieuw.";
        setSaveError(message);
        toast.error("Kon het Bouwmoment niet toevoegen. Je concept is bewaard.");
      }
    } finally {
      submitGuardRef.current = false;
      setLoading(false);
      setSaveStage("idle");
    }

    if (saved) {
      if (user?.id) {
        try {
          await deleteUpdateComposerDraft(user.id, projectId);
          await clearLandingPhotoHandoff();
        } catch (error) {
          console.error("Clear saved update recovery data failed", error);
        }
      }
      onAdded();
      onClose();
      toast.success("Bouwmoment toegevoegd!");
    }
  };

  const keepDraftAndClose = async () => {
    if (closingDraft) return;
    setClosingDraft(true);
    try {
      await persistDraft();
      setShowDiscardPrompt(false);
      onClose();
    } catch (error) {
      console.error("Keep update draft failed", error);
      setDraftPersistenceError(error instanceof LandingPhotoCleanupError
        ? error.message
        : "Concept bewaren lukte niet. Blijf in dit scherm en probeer opnieuw.");
      toast.error("Concept kon niet veilig worden bewaard.");
    } finally {
      setClosingDraft(false);
    }
  };

  const discardDraftAndClose = async () => {
    if (!user?.id || closingDraft) return;
    setClosingDraft(true);
    try {
      await deleteUpdateComposerDraft(user.id, projectId);
      await clearLandingPhotoHandoff();
      setShowDiscardPrompt(false);
      onClose();
    } catch (error) {
      console.error("Discard update draft failed", error);
      setDraftPersistenceError("Het bewaarde concept kon niet worden verwijderd. Probeer opnieuw.");
      toast.error("Concept kon niet veilig worden verwijderd.");
    } finally {
      setClosingDraft(false);
    }
  };

  const saveStatus = saveStage === "uploading"
    ? `Foto ${uploadProgress.current} van ${uploadProgress.total} uploaden…`
    : saveStage === "processing"
      ? `Foto ${uploadProgress.current} van ${uploadProgress.total} veilig verwerken…`
      : saveStage === "saving"
        ? "Bouwmoment opslaan…"
        : saveError;
  const importedLandingPhotoVisible = Boolean(
    landingHandoffUploadIdRef.current
    && files.some((upload) => upload.id === landingHandoffUploadIdRef.current),
  );

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}>
        <DialogContent
          className="z-[1000] h-[100dvh] w-screen max-w-none overflow-y-auto overscroll-contain rounded-none p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] [&>button]:flex [&>button]:h-11 [&>button]:w-11 [&>button]:items-center [&>button]:justify-center sm:h-auto sm:max-h-[90dvh] sm:max-w-2xl sm:rounded-lg sm:p-6"
          aria-busy={loading}
        >
          <DialogHeader className="pr-8 text-left">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">Nieuw Bouwmoment</p>
            <DialogTitle className="font-sans text-2xl">Wat is er veranderd?</DialogTitle>
            <DialogDescription>Begin met beeld. De praktische details kun je daarna rustig aanvullen.</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="mt-2 min-w-0 space-y-7">
            {mediaFeaturesEnabled ? (
            <section aria-labelledby="update-media-title">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <Label id="update-media-title" className="text-base font-semibold">Foto's</Label>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">De eerste foto wordt het openingsbeeld. Sleep of gebruik de pijlen om te ordenen.</p>
                  {importedLandingPhotoVisible ? (
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground" role="status">
                      Je startfoto is alleen vanaf dit apparaat overgenomen. Hij wordt pas privé geüpload wanneer jij dit Bouwmoment plaatst.
                    </p>
                  ) : null}
                </div>
                {files.length > 0 && <span className="text-xs tabular-nums text-muted-foreground">{files.length}/50</span>}
              </div>
              <ProjectImagePicker
                currentCount={files.length}
                disabled={formLocked}
                onFiles={addSelectedFiles}
              />

              {files.length > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {files.map((upload, index) => {
                    const file = upload.file;
                    return (
                      <div
                        key={upload.id}
                        draggable={!formLocked}
                        onDragStart={(dragEvent) => { dragEvent.dataTransfer.effectAllowed = "move"; dragEvent.dataTransfer.setData("text/plain", upload.id); setDragIdx(index); }}
                        onDragOver={(dragEvent) => { dragEvent.preventDefault(); setDragOverIdx(index); }}
                        onDragLeave={() => setDragOverIdx(null)}
                        onDrop={(dragEvent) => { reorderUploads(dragEvent.dataTransfer.getData("text/plain"), upload.id); setDragIdx(null); setDragOverIdx(null); }}
                        onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                        className={`border bg-background p-2 ${dragIdx === index ? "opacity-40" : ""} ${dragOverIdx === index && dragIdx !== index ? "ring-2 ring-accent" : ""}`}
                      >
                        <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                          <ResilientImage src={upload.previewUrl} alt={`Voorvertoning ${index + 1}`} draggable={false} className="h-full w-full object-cover" />
                          <button type="button" onClick={() => removeFile(upload.id)} className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center bg-background/90 text-foreground hover:text-destructive" aria-label={`${file.name} verwijderen`} disabled={formLocked}>
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <p className="mt-2 truncate text-xs text-muted-foreground">{file.name}</p>
                        {upload.assetId ? (
                          <p className="mt-1 text-xs font-medium text-emerald-700" role="status">Privé verwerkt</p>
                        ) : activeUploadId === upload.id ? (
                          <p className="mt-1 text-xs text-muted-foreground" role="status">
                            {saveStage === "processing" ? "Veilig verwerken…" : "Privé uploaden…"}
                          </p>
                        ) : failedUploadId === upload.id ? (
                          <div className="mt-2 border-l-2 border-destructive pl-2">
                            <p className="text-xs leading-5 text-destructive" role="alert">Deze foto kon niet worden bewaard. Je tekst is niet verloren.</p>
                            <button
                              type="button"
                              className="mt-1 min-h-11 text-left text-xs font-semibold text-accent underline underline-offset-4"
                              onClick={() => void retryUpload(upload.id)}
                              disabled={formLocked}
                              aria-label={`${file.name} opnieuw uploaden`}
                            >
                              Deze foto opnieuw
                            </button>
                          </div>
                        ) : null}
                        <div className="mt-2 grid grid-cols-2 gap-1">
                          <button type="button" onClick={() => moveUpload(upload.id, -1)} disabled={index === 0 || formLocked} className="flex min-h-11 items-center justify-center border text-muted-foreground disabled:opacity-30" aria-label={`${file.name} naar voren`}><ArrowLeft className="h-4 w-4" /></button>
                          <button type="button" onClick={() => moveUpload(upload.id, 1)} disabled={index === files.length - 1 || formLocked} className="flex min-h-11 items-center justify-center border text-muted-foreground disabled:opacity-30" aria-label={`${file.name} naar achteren`}><ArrowRight className="h-4 w-4" /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
            ) : null}

            <section className="space-y-4 border-t border-border pt-6" aria-labelledby="update-story-title">
              <h3 id="update-story-title" className="font-sans text-base font-semibold">Het Verhaal</h3>
              <div className="space-y-2">
                <Label htmlFor="update-date">Datum <span className="text-accent">*</span></Label>
                <Input id="update-date" type="date" value={updateDate} onChange={(changeEvent) => setUpdateDate(changeEvent.target.value)} required className="min-h-11" disabled={formLocked} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="update-title">Korte titel of bijschrift <span className="font-normal text-muted-foreground">(optioneel)</span></Label>
                <Input id="update-title" value={title} onChange={(changeEvent) => setTitle(changeEvent.target.value)} maxLength={120} placeholder="Bijv. De oude keuken is eruit" className="min-h-11" disabled={formLocked} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="update-description">Vertel wat je wilt onthouden <span className="font-normal text-muted-foreground">(optioneel)</span></Label>
                <Textarea id="update-description" value={description} onChange={(changeEvent) => setDescription(changeEvent.target.value)} maxLength={10000} placeholder="Wat is er gedaan, welke keuze maakte je en wat kwam je tegen?" rows={5} className="min-h-32 resize-y" disabled={formLocked} />
              </div>
              <div className="space-y-2">
                <Label>Fase <span className="font-normal text-muted-foreground">(optioneel)</span></Label>
                <PhaseSelect value={phaseId} onChange={setPhaseId} options={phaseOptions} onAddCustom={addCustomPhase} disabled={formLocked || projectQuery.isLoading || projectQuery.isError} />
              </div>
            </section>

            {/* SECURITY: update-level contractor and budget fields stay hidden until typed,
                transactional server contracts exist; there is deliberately no browser-side provider fallback. */}

            {projectQuery.isError && <p role="alert" className="text-sm text-destructive">De verbouwing kon niet veilig worden geladen. Probeer het Bouwmoment opnieuw te plaatsen.</p>}
            {saveStatus && <p role="status" aria-live="polite" className={`text-sm ${saveError ? "text-destructive" : "text-muted-foreground"}`}>{saveStatus}</p>}
            {draftPersistenceError && <p role="alert" className="text-sm text-destructive">{draftPersistenceError}</p>}

            <div className="sticky bottom-0 -mx-5 flex flex-col-reverse gap-3 border-t border-border bg-background px-5 py-4 min-[360px]:flex-row sm:-mx-6 sm:px-6">
              <Button type="button" variant="ghost" onClick={requestClose} className="min-h-11 flex-1" disabled={loading}>Annuleren</Button>
              <Button
                type="submit"
                className="min-h-11 flex-[2] bg-accent text-accent-foreground hover:bg-accent/90"
                disabled={
                  loading ||
                  !updateDate ||
                  (!title.trim() && !description.trim() && files.length === 0) ||
                  (!retryLocked && (projectQuery.isLoading || projectQuery.data?.canEdit === false))
                }
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {loading
                  ? saveStage === "uploading" || saveStage === "processing"
                    ? `${uploadProgress.current}/${uploadProgress.total} verwerken`
                    : "Opslaan…"
                  : saveError
                    ? "Opnieuw proberen"
                    : "Bouwmoment plaatsen"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <DiscardUpdateDraftDialog
        open={showDiscardPrompt}
        onOpenChange={setShowDiscardPrompt}
        onDiscard={() => void discardDraftAndClose()}
        onKeep={() => void keepDraftAndClose()}
        busy={closingDraft}
      />
    </>
  );
};

export default AddStepDialog;
