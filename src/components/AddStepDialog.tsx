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
import { Switch } from "@/components/ui/switch";
import PhaseSelect, { DEFAULT_PHASES } from "./PhaseSelect";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, ImagePlus, Loader2, Star, X } from "lucide-react";
import DiscardUpdateDraftDialog from "@/components/project/DiscardUpdateDraftDialog";
import { getUpdateComposerCloseIntent } from "@/lib/updateComposerState";
import { ApiClientError } from "@/lib/apiClient";
import { createClientIdempotencyKey } from "@/lib/clientIdempotency";
import {
  isSupportedProjectImageType,
  preparePrivateProjectImage,
  PrivateMediaUploadError,
  type PreparedProjectImage,
} from "@/lib/privateMediaApi";
import { buildCreateUpdateCommand } from "@/lib/projectWriteFlow";
import {
  deleteUpdateComposerDraft,
  loadUpdateComposerDraft,
  saveUpdateComposerDraft,
  type StoredUpdateComposerDraft,
} from "@/lib/updateComposerDraftStore";
import type { CreateProjectPhaseInput, CreateUpdateInput } from "../../shared/contracts/projects";

interface AddStepDialogProps {
  projectId: string;
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

// Re-export so existing imports keep working.
export const PHASES = DEFAULT_PHASES;

const AddStepDialog = ({ projectId, onClose, onAdded }: AddStepDialogProps) => {
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
  const uploadCacheRef = useRef(new Map<string, UploadCacheEntry>());
  const pendingCommandRef = useRef<CreateUpdateInput | null>(null);
  const pendingPhaseCommandRef = useRef<{ name: string; input: CreateProjectPhaseInput } | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [saveStage, setSaveStage] = useState<"idle" | "saving" | "uploading" | "processing">("idle");
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
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

  const formLocked = loading || retryLocked;
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
        throw new UpdateDraftError("Je hebt geen bewerkingsrechten voor dit project.");
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

    void loadUpdateComposerDraft(user.id, projectId)
      .then((draft) => {
        if (!active || !draft) return;
        const restoredFiles = draft.files.map((stored) => {
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
        });
        setTitle(draft.title);
        setPhaseId(draft.phaseId);
        setIsMilestone(draft.isMilestone);
        setDescription(draft.description);
        setUpdateDate(draft.updateDate);
        initialDateRef.current = draft.updateDate;
        setFiles(restoredFiles);
        setHasRestoredDraft(true);
        updateIdempotencyKeyRef.current = draft.updateIdempotencyKey;
        pendingCommandRef.current = draft.pendingCommand;
        if (draft.pendingCommand) {
          setRetryLocked(true);
          setSaveError("Deze opdracht wacht nog op serverbevestiging. Probeer haar ongewijzigd opnieuw.");
        }
      })
      .catch((error) => {
        console.error("Restore update draft failed", error);
        if (active) setDraftPersistenceError("Dit apparaat kon je vorige concept niet herstellen.");
      })
      .finally(() => {
        if (active) setDraftHydrated(true);
      });

    return () => { active = false; };
  }, [projectId, user?.id]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || formLocked) return;

    const selected = Array.from(event.target.files);
    const supported = selected.filter((file) => isSupportedProjectImageType(file.type));
    const remaining = Math.max(0, 50 - files.length);
    const accepted = supported.slice(0, remaining);

    if (supported.length !== selected.length) {
      toast.error("Gebruik alleen JPG-, PNG-, WebP-, AVIF-, HEIC- of HEIF-foto's.");
    }
    if (supported.length > remaining) {
      toast.error("Je kunt maximaal 50 foto's aan één update toevoegen.");
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
    } finally {
      event.target.value = "";
    }
  };

  const removeFile = (id: string) => {
    if (formLocked) return;
    const removed = files.find((upload) => upload.id === id);
    if (removed) {
      URL.revokeObjectURL(removed.previewUrl);
      previewUrlsRef.current = previewUrlsRef.current.filter((url) => url !== removed.previewUrl);
    }
    uploadCacheRef.current.delete(id);
    setFiles((previous) => previous.filter((upload) => upload.id !== id));
  };

  const setCompareRole = (id: string, role: CompareRole) => {
    if (formLocked) return;
    setFiles((previous) =>
      previous.map((upload) => {
        if (upload.id === id) {
          return { ...upload, compareRole: upload.compareRole === role ? null : role };
        }
        if (upload.compareRole === role) {
          return { ...upload, compareRole: null };
        }
        return upload;
      }),
    );
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
    setDraftPersistenceError(null);
  };

  useEffect(() => {
    if (!draftHydrated || !user?.id || (!isDirty && !pendingCommandRef.current)) return;
    const timer = globalThis.setTimeout(() => {
      void persistDraft().catch((error) => {
        console.error("Persist update draft failed", error);
        setDraftPersistenceError("Concept kon niet op dit apparaat worden bewaard.");
      });
    }, 350);
    return () => globalThis.clearTimeout(timer);
  // `persistDraft` intentionally snapshots every listed state value after the debounce.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [description, draftHydrated, files, isDirty, isMilestone, phaseId, projectId, title, updateDate, user?.id]);

  const requestClose = () => {
    const intent = getUpdateComposerCloseIntent({ isDirty, isSaving: loading });
    if (intent === "ignore") return;
    if (intent === "confirm-discard") {
      setShowDiscardPrompt(true);
      return;
    }
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || submitGuardRef.current || !title.trim()) return;

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
          throw new UpdateDraftError("Je hebt geen bewerkingsrechten voor dit project.");
        }

        const readyMedia: Array<{ assetId: string; compareRole: CompareRole | null }> = [];
        if (files.length > 0) {
          setSaveStage("uploading");
          setUploadProgress({ current: 0, total: files.length });
        }

        for (const [index, upload] of files.entries()) {
          setUploadProgress({ current: index + 1, total: files.length });
          const cache = uploadCacheRef.current.get(upload.id) ?? {};
          cache.prepared ??= await preparePrivateProjectImage(upload.file);
          uploadCacheRef.current.set(upload.id, cache);

          if (!cache.assetId) {
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
              throw new UpdateDraftError("De server bevestigde de foto niet voor dit project.");
            }
            cache.assetId = asset.id;
            setFiles((previous) => previous.map((item) => (
              item.id === upload.id ? { ...item, assetId: asset.id } : item
            )));
          }

          readyMedia.push({ assetId: cache.assetId, compareRole: upload.compareRole });
        }

        const latestProject = await projectQuery.refetch({ throwOnError: true });
        if (!latestProject.data?.canEdit) {
          throw new UpdateDraftError("Je hebt geen bewerkingsrechten voor dit project.");
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
        toast.error("We konden de update nog niet bevestigen. Probeer opnieuw.");
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
        toast.error("Kon update niet toevoegen. Je concept is bewaard.");
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
        } catch (error) {
          console.error("Clear saved update draft failed", error);
        }
      }
      onAdded();
      onClose();
      toast.success("Update toegevoegd!");
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
      setDraftPersistenceError("Concept bewaren lukte niet. Blijf in dit scherm en probeer opnieuw.");
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
        ? "Update opslaan…"
        : saveError;

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}>
        <DialogContent
          className="z-[1000] h-[100dvh] w-screen max-w-none overflow-y-auto overscroll-contain rounded-none p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] [&>button]:flex [&>button]:h-11 [&>button]:w-11 [&>button]:items-center [&>button]:justify-center sm:h-auto sm:max-h-[90dvh] sm:max-w-2xl sm:rounded-lg sm:p-6"
          aria-busy={loading}
        >
          <DialogHeader className="pr-8 text-left">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">Nieuwe projectupdate</p>
            <DialogTitle className="font-sans text-2xl">Wat is er veranderd?</DialogTitle>
            <DialogDescription>Begin met beeld. De praktische details kun je daarna rustig aanvullen.</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="mt-2 space-y-7">
            <section aria-labelledby="update-media-title">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <Label id="update-media-title" className="text-base font-semibold">Foto's</Label>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">De eerste foto wordt het openingsbeeld. Sleep of gebruik de pijlen om te ordenen.</p>
                </div>
                {files.length > 0 && <span className="text-xs tabular-nums text-muted-foreground">{files.length}/50</span>}
              </div>
              <label className={`mt-3 flex min-h-24 items-center justify-center gap-3 border border-dashed border-border bg-secondary/25 px-4 py-5 text-center transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ${formLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-accent"}`}>
                <ImagePlus className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
                <span className="text-sm"><strong>Voeg foto's toe</strong><span className="block text-xs text-muted-foreground">JPG, PNG, WebP, AVIF, HEIC of HEIF</span></span>
                <input type="file" multiple accept=".jpg,.jpeg,.png,.webp,.avif,.heic,.heif,image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif" className="sr-only" onChange={handleFileChange} disabled={formLocked || files.length >= 50} />
              </label>

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
                          <img src={upload.previewUrl} alt={`Voorvertoning ${index + 1}`} draggable={false} className="h-full w-full object-cover" />
                          {upload.compareRole && <span className="absolute left-2 top-2 bg-accent px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-accent-foreground">{upload.compareRole === "before" ? "Voor" : "Na"}</span>}
                          <button type="button" onClick={() => removeFile(upload.id)} className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center bg-background/90 text-foreground hover:text-destructive" aria-label={`${file.name} verwijderen`} disabled={formLocked}>
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <p className="mt-2 truncate text-xs text-muted-foreground">{file.name}</p>
                        <div className="mt-2 grid grid-cols-2 gap-1">
                          <button type="button" onClick={() => moveUpload(upload.id, -1)} disabled={index === 0 || formLocked} className="flex min-h-11 items-center justify-center border text-muted-foreground disabled:opacity-30" aria-label={`${file.name} naar voren`}><ArrowLeft className="h-4 w-4" /></button>
                          <button type="button" onClick={() => moveUpload(upload.id, 1)} disabled={index === files.length - 1 || formLocked} className="flex min-h-11 items-center justify-center border text-muted-foreground disabled:opacity-30" aria-label={`${file.name} naar achteren`}><ArrowRight className="h-4 w-4" /></button>
                        </div>
                        <div className="mt-1 grid grid-cols-2 gap-1">
                          {(["before", "after"] as const).map((role) => (
                            <button key={role} type="button" aria-pressed={upload.compareRole === role} onClick={() => setCompareRole(upload.id, role)} className={`min-h-11 border text-xs font-semibold ${upload.compareRole === role ? "border-accent bg-accent text-accent-foreground" : "border-border"}`} disabled={formLocked}>{role === "before" ? "Voor" : "Na"}</button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="space-y-4 border-t border-border pt-6" aria-labelledby="update-story-title">
              <h3 id="update-story-title" className="font-sans text-base font-semibold">Het verhaal</h3>
              <div className="space-y-2">
                <Label htmlFor="update-title">Titel <span className="text-accent">*</span></Label>
                <Input id="update-title" value={title} onChange={(changeEvent) => setTitle(changeEvent.target.value)} required maxLength={120} placeholder="Bijv. De oude keuken is eruit" className="min-h-11" disabled={formLocked} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="update-description">Vertel wat je wilt onthouden</Label>
                <Textarea id="update-description" value={description} onChange={(changeEvent) => setDescription(changeEvent.target.value)} maxLength={10000} placeholder="Wat is er gedaan, welke keuze maakte je en wat kwam je tegen?" rows={5} className="min-h-32 resize-y" disabled={formLocked} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>Fase</Label><PhaseSelect value={phaseId} onChange={setPhaseId} options={phaseOptions} onAddCustom={addCustomPhase} disabled={formLocked || projectQuery.isLoading || projectQuery.isError} /></div>
                <div className="space-y-2"><Label htmlFor="update-date">Datum <span className="text-accent">*</span></Label><Input id="update-date" type="date" value={updateDate} onChange={(changeEvent) => setUpdateDate(changeEvent.target.value)} required className="min-h-11" disabled={formLocked} /></div>
              </div>
              <div className="flex min-h-11 items-center justify-between gap-4 border-y border-border py-2">
                <Label htmlFor="milestone" className="flex cursor-pointer items-center gap-2"><Star className="h-4 w-4 text-accent" />Markeren als mijlpaal</Label>
                <Switch id="milestone" checked={isMilestone} onCheckedChange={setIsMilestone} disabled={formLocked} />
              </div>
            </section>

            {/* SECURITY: update-level contractor and budget fields stay hidden until typed,
                transactional server contracts exist; there is deliberately no browser-side provider fallback. */}

            {projectQuery.isError && <p role="alert" className="text-sm text-destructive">Projectgegevens konden niet veilig worden geladen. Probeer de update opnieuw te plaatsen.</p>}
            {saveStatus && <p role="status" aria-live="polite" className={`text-sm ${saveError ? "text-destructive" : "text-muted-foreground"}`}>{saveStatus}</p>}
            {draftPersistenceError && <p role="alert" className="text-sm text-destructive">{draftPersistenceError}</p>}

            <div className="sticky bottom-0 -mx-5 flex gap-3 border-t border-border bg-background px-5 py-4 sm:-mx-6 sm:px-6">
              <Button type="button" variant="ghost" onClick={requestClose} className="min-h-11 flex-1" disabled={loading}>Annuleren</Button>
              <Button
                type="submit"
                className="min-h-11 flex-[2] bg-accent text-accent-foreground hover:bg-accent/90"
                disabled={
                  loading ||
                  title.trim().length === 0 ||
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
                    : "Update plaatsen"}
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
