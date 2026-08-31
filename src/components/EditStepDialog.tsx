import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import PhaseSelect from "@/components/PhaseSelect";
import { ResilientImage, ResilientVideo } from "@/components/ResilientMedia";
import DiscardUpdateDraftDialog from "@/components/project/DiscardUpdateDraftDialog";
import ProjectImagePicker from "@/components/project/ProjectImagePicker";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import {
  useCreateProjectPhaseMutation,
  useDeleteProjectUpdateMutation,
  useEditProjectUpdateMutation,
  useProjectOverview,
} from "@/hooks/useProjectApi";
import { usePrivateMediaUpload } from "@/hooks/usePrivateMediaUpload";
import { ApiClientError } from "@/lib/apiClient";
import { createClientIdempotencyKey } from "@/lib/clientIdempotency";
import {
  isSupportedProjectImageType,
  preparePrivateProjectImage,
  PrivateMediaUploadError,
  type PreparedProjectImage,
} from "@/lib/privateMediaApi";
import {
  buildDeleteUpdateCommand,
  buildEditUpdateCommand,
} from "@/lib/projectWriteFlow";
import { selectUniqueLocalFiles } from "@/lib/projectImageSelection";
import { getUpdateComposerCloseIntent } from "@/lib/updateComposerState";
import type {
  CreateProjectPhaseInput,
  DeleteUpdateInput,
  EditUpdateInput,
  ProjectUpdate,
} from "../../shared/contracts/projects";

type CompareRole = "before" | "after";

type EditorMedia = {
  key: string;
  assetId?: string;
  contentType: string | null;
  previewUrl: string;
  file?: File;
  compareRole: CompareRole | null;
  caption: string | null;
};

type UploadCacheEntry = {
  prepared?: PreparedProjectImage;
  assetId?: string;
};

interface EditStepDialogProps {
  projectId: string;
  update: ProjectUpdate;
  onClose: () => void;
  onUpdated?: (update: ProjectUpdate) => void;
  onDeleted?: (updateId: string) => void;
}

class UpdateEditorError extends Error {}

function initialMedia(update: ProjectUpdate): EditorMedia[] {
  return [...update.media]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((media) => ({
      key: `asset:${media.id}`,
      assetId: media.id,
      contentType: media.contentType,
      previewUrl: media.proxyPath,
      compareRole: media.role === "before" || media.role === "after" ? media.role : null,
      caption: media.caption,
    }));
}

function samePhaseName(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase("nl-NL") === right.trim().toLocaleLowerCase("nl-NL");
}

const EditStepDialog = ({ projectId, update, onClose, onUpdated, onDeleted }: EditStepDialogProps) => {
  const { user } = useAuth();
  const projectQuery = useProjectOverview(projectId, Boolean(user));
  const editMutation = useEditProjectUpdateMutation(projectId, update.id);
  const deleteMutation = useDeleteProjectUpdateMutation(projectId, update.id);
  const createPhaseMutation = useCreateProjectPhaseMutation(projectId);
  const mediaUpload = usePrivateMediaUpload();

  const [title, setTitle] = useState(update.title ?? "");
  const [room] = useState(update.room ?? "");
  const [description, setDescription] = useState(update.description ?? "");
  const [updateDate, setUpdateDate] = useState(update.updateDate);
  const [phaseId, setPhaseId] = useState(update.phase?.id ?? "");
  const [isMilestone] = useState(update.isMilestone);
  const [media, setMedia] = useState<EditorMedia[]>(() => initialMedia(update));
  const [isDirty, setIsDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retryLocked, setRetryLocked] = useState(false);
  const [deleteRetryLocked, setDeleteRetryLocked] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveStage, setSaveStage] = useState<"idle" | "uploading" | "processing" | "saving">("idle");
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [activeUploadKey, setActiveUploadKey] = useState<string | null>(null);
  const [failedUploadKey, setFailedUploadKey] = useState<string | null>(null);
  const [retryingUploadKey, setRetryingUploadKey] = useState<string | null>(null);
  const [showDiscardPrompt, setShowDiscardPrompt] = useState(false);
  const [showDeletePrompt, setShowDeletePrompt] = useState(false);

  const previewUrlsRef = useRef<string[]>([]);
  const uploadCacheRef = useRef(new Map<string, UploadCacheEntry>());
  const pendingEditCommandRef = useRef<EditUpdateInput | null>(null);
  const pendingDeleteCommandRef = useRef<DeleteUpdateInput | null>(null);
  const pendingPhaseCommandRef = useRef<{ name: string; input: CreateProjectPhaseInput } | null>(null);
  const submitGuardRef = useRef(false);

  const formLocked = loading || retryLocked || deleteRetryLocked || deleteMutation.isPending
    || retryingUploadKey !== null;
  const canEdit = projectQuery.data?.viewerAccess === "owner" && projectQuery.data.canEdit;
  const phaseOptions = useMemo(() => projectQuery.data?.phases.map((phase) => ({
    value: phase.id,
    label: phase.name,
  })) ?? [], [projectQuery.data?.phases]);

  useEffect(() => () => {
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrlsRef.current = [];
  }, []);

  const markDirty = () => {
    setIsDirty(true);
    setSaveError(null);
  };

  const requestClose = () => {
    const intent = getUpdateComposerCloseIntent({
      isDirty,
      isSaving: loading || retryLocked || deleteMutation.isPending || deleteRetryLocked
        || retryingUploadKey !== null,
    });
    if (intent === "ignore") return;
    if (intent === "confirm-discard") {
      setShowDiscardPrompt(true);
      return;
    }
    onClose();
  };

  const addCustomPhase = async (name: string): Promise<string> => {
    const normalizedName = name.trim();
    let pending = pendingPhaseCommandRef.current;
    if (!pending || !samePhaseName(pending.name, normalizedName)) {
      const latest = await projectQuery.refetch({ throwOnError: true });
      if (latest.data?.viewerAccess !== "owner" || !latest.data.canEdit) {
        throw new UpdateEditorError("Je hebt geen bewerkingsrechten voor deze verbouwing.");
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
      const result = await createPhaseMutation.mutateAsync(pending.input);
      pendingPhaseCommandRef.current = null;
      markDirty();
      return result.phase.id;
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409) {
        const latest = await projectQuery.refetch({ throwOnError: true });
        const existing = latest.data?.phases.find((phase) => samePhaseName(phase.name, normalizedName));
        pendingPhaseCommandRef.current = null;
        if (existing) {
          markDirty();
          return existing.id;
        }
      }
      throw error;
    }
  };

  const addSelectedFiles = (selected: File[]) => {
    if (formLocked) return;
    const supported = selected.filter((file) => isSupportedProjectImageType(file.type));
    const uniqueSelection = selectUniqueLocalFiles(
      media.flatMap((item) => item.file ? [item.file] : []),
      supported,
    );
    const available = Math.max(0, 50 - media.length);
    const accepted = uniqueSelection.files.slice(0, available);

    if (supported.length !== selected.length) {
      toast.error("Gebruik alleen JPG-, PNG-, WebP-, AVIF-, HEIC- of HEIF-foto's.");
    }
    if (uniqueSelection.duplicateCount > 0) {
      toast.error(uniqueSelection.duplicateCount === 1
        ? "Deze foto staat al in dit Bouwmoment."
        : `${uniqueSelection.duplicateCount} foto's stonden al in dit Bouwmoment.`);
    }
    if (uniqueSelection.files.length > available) {
      toast.error("Je kunt maximaal 50 media-items aan één Bouwmoment koppelen.");
    }

    try {
      const additions = accepted.map((file) => {
        const previewUrl = URL.createObjectURL(file);
        previewUrlsRef.current.push(previewUrl);
        return {
          key: createClientIdempotencyKey("media-upload"),
          contentType: file.type,
          previewUrl,
          file,
          compareRole: null,
          caption: null,
        } satisfies EditorMedia;
      });
      setMedia((current) => [...current, ...additions]);
      if (additions.length > 0) markDirty();
    } catch (error) {
      console.error("Create secure upload identifier failed", error);
      toast.error("Deze browser kan geen veilige uploadopdracht maken.");
    }
  };

  const readyEditorMedia = async (item: EditorMedia): Promise<string> => {
    if (item.assetId) return item.assetId;
    if (!item.file) throw new UpdateEditorError("Een nieuw media-item mist het lokale bestand.");
    const cache = uploadCacheRef.current.get(item.key) ?? {};
    if (cache.assetId) return cache.assetId;

    setActiveUploadKey(item.key);
    setFailedUploadKey((current) => current === item.key ? null : current);
    try {
      cache.prepared ??= await preparePrivateProjectImage(item.file);
      uploadCacheRef.current.set(item.key, cache);
      const asset = await mediaUpload.mutateAsync({
        projectId,
        idempotencyKey: item.key,
        prepared: cache.prepared,
        onStage: (stage) => {
          if (stage === "processing") setSaveStage("processing");
          if (stage === "uploading") setSaveStage("uploading");
        },
      });
      if (asset.projectId !== projectId || asset.status !== "ready") {
        throw new UpdateEditorError("De server bevestigde de foto niet voor deze verbouwing.");
      }
      cache.assetId = asset.id;
      setMedia((current) => current.map((mediaItem) => (
        mediaItem.key === item.key ? { ...mediaItem, assetId: asset.id } : mediaItem
      )));
      return asset.id;
    } catch (error) {
      setFailedUploadKey(item.key);
      throw error;
    } finally {
      setActiveUploadKey((current) => current === item.key ? null : current);
    }
  };

  const retryMediaUpload = async (mediaKey: string) => {
    if (formLocked) return;
    const item = media.find((candidate) => candidate.key === mediaKey);
    if (!item || item.assetId) return;

    setRetryingUploadKey(mediaKey);
    setSaveError(null);
    setSaveStage("uploading");
    setUploadProgress({ current: 1, total: 1 });
    try {
      await readyEditorMedia(item);
      toast.success("De foto is privé verwerkt. Sla je wijzigingen op wanneer je klaar bent.");
    } catch (error) {
      const message = error instanceof PrivateMediaUploadError || error instanceof UpdateEditorError
        ? error.message
        : "Deze foto kon niet veilig worden verwerkt. Probeer haar opnieuw.";
      setSaveError(message);
      toast.error("De foto kon niet worden verwerkt.");
    } finally {
      setRetryingUploadKey(null);
      setSaveStage("idle");
    }
  };

  const removeMedia = (key: string) => {
    if (formLocked) return;
    const removed = media.find((item) => item.key === key);
    if (removed?.file) {
      URL.revokeObjectURL(removed.previewUrl);
      previewUrlsRef.current = previewUrlsRef.current.filter((url) => url !== removed.previewUrl);
      uploadCacheRef.current.delete(key);
    }
    setFailedUploadKey((current) => current === key ? null : current);
    setMedia((current) => current.filter((item) => item.key !== key));
    markDirty();
  };

  const moveMedia = (key: string, direction: -1 | 1) => {
    if (formLocked) return;
    setMedia((current) => {
      const from = current.findIndex((item) => item.key === key);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    markDirty();
  };

  const readyMediaManifest = async () => {
    const manifest: Array<{
      assetId: string;
      compareRole: CompareRole | null;
      caption: string | null;
    }> = [];
    const pendingUploads = media.filter((item) => !item.assetId);
    if (pendingUploads.length > 0) {
      setSaveStage("uploading");
      setUploadProgress({ current: 0, total: pendingUploads.length });
    }

    let uploadIndex = 0;
    for (const item of media) {
      let assetId = item.assetId ?? uploadCacheRef.current.get(item.key)?.assetId;
      if (!assetId) {
        uploadIndex += 1;
        setUploadProgress({ current: uploadIndex, total: pendingUploads.length });
        assetId = await readyEditorMedia(item);
      }
      manifest.push({ assetId, compareRole: item.compareRole, caption: item.caption });
    }
    return manifest;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !isDirty || submitGuardRef.current) return;
    submitGuardRef.current = true;
    setLoading(true);
    setSaveError(null);
    let requestStarted = false;
    let savedUpdate: ProjectUpdate | null = null;

    try {
      if (!pendingEditCommandRef.current) {
        const latest = await projectQuery.refetch({ throwOnError: true });
        if (latest.data?.viewerAccess !== "owner" || !latest.data.canEdit) {
          throw new UpdateEditorError("Je hebt geen bewerkingsrechten voor deze verbouwing.");
        }
        const readyMedia = await readyMediaManifest();
        pendingEditCommandRef.current = buildEditUpdateCommand({
          title,
          room,
          description,
          updateDate,
          phaseId,
          isMilestone,
          media: readyMedia,
        }, update.version, createClientIdempotencyKey("update-edit"));
      }

      setSaveStage("saving");
      requestStarted = true;
      const result = await editMutation.mutateAsync(pendingEditCommandRef.current);
      savedUpdate = result.update;
      pendingEditCommandRef.current = null;
      setRetryLocked(false);
    } catch (error) {
      console.error("Edit update failed", error);
      const definitiveRejection = requestStarted && error instanceof ApiClientError &&
        error.status < 500 && ![408, 425, 429].includes(error.status);
      const uncertainOutcome = requestStarted && !definitiveRejection;
      if (uncertainOutcome) {
        setRetryLocked(true);
        setSaveError("De serverbevestiging ontbreekt. Probeer exact dezelfde wijziging opnieuw; de veilige opdracht-ID blijft behouden.");
        toast.error("We konden de wijziging nog niet bevestigen. Probeer opnieuw.");
      } else {
        if (definitiveRejection) pendingEditCommandRef.current = null;
        setRetryLocked(false);
        const message = error instanceof ApiClientError ||
          error instanceof PrivateMediaUploadError ||
          error instanceof UpdateEditorError
          ? error.message
          : "Opslaan lukte niet. Je wijzigingen staan nog hier.";
        setSaveError(message);
        toast.error("Kon het Bouwmoment niet opslaan.");
      }
    } finally {
      submitGuardRef.current = false;
      setLoading(false);
      setSaveStage("idle");
    }

    if (savedUpdate) {
      setIsDirty(false);
      onUpdated?.(savedUpdate);
      onClose();
      toast.success("Bouwmoment opgeslagen");
    }
  };

  const handleDelete = async () => {
    if (!user || deleteMutation.isPending) return;
    setSaveError(null);
    try {
      const latest = await projectQuery.refetch({ throwOnError: true });
      if (latest.data?.viewerAccess !== "owner" || !latest.data.canEdit) {
        throw new UpdateEditorError("Je hebt geen bewerkingsrechten voor deze verbouwing.");
      }
      pendingDeleteCommandRef.current ??= buildDeleteUpdateCommand(
        update.version,
        createClientIdempotencyKey("update-delete"),
      );
      await deleteMutation.mutateAsync(pendingDeleteCommandRef.current);
      pendingDeleteCommandRef.current = null;
      setDeleteRetryLocked(false);
      setShowDeletePrompt(false);
      onDeleted?.(update.id);
      onClose();
      toast.success("Bouwmoment verwijderd");
    } catch (error) {
      console.error("Delete update failed", error);
      const definitiveRejection = error instanceof ApiClientError &&
        error.status < 500 && ![408, 425, 429].includes(error.status);
      if (definitiveRejection) {
        pendingDeleteCommandRef.current = null;
        setDeleteRetryLocked(false);
      } else {
        setDeleteRetryLocked(true);
      }
      const message = definitiveRejection && error instanceof Error
        ? error.message
        : "De serverbevestiging ontbreekt. Probeer exact dezelfde verwijdering opnieuw.";
      setSaveError(message);
      toast.error("Kon het Bouwmoment niet verwijderen. Probeer opnieuw.");
    }
  };

  const saveStatus = saveStage === "uploading"
    ? `Foto ${uploadProgress.current} van ${uploadProgress.total} uploaden…`
    : saveStage === "processing"
      ? `Foto ${uploadProgress.current} van ${uploadProgress.total} veilig verwerken…`
      : saveStage === "saving"
        ? "Wijzigingen opslaan…"
        : saveError;

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}>
        <DialogContent
          className="z-[1000] h-[100dvh] w-screen max-w-none overflow-y-auto overscroll-contain rounded-none p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] [&>button]:flex [&>button]:h-11 [&>button]:w-11 [&>button]:items-center [&>button]:justify-center sm:h-auto sm:max-h-[90dvh] sm:max-w-2xl sm:rounded-lg sm:p-6"
          aria-busy={loading || deleteMutation.isPending}
        >
          <DialogHeader className="pr-8 text-left">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">Bouwmoment</p>
            <DialogTitle className="font-sans text-2xl">Bouwmoment bewerken</DialogTitle>
            <DialogDescription>
              Wijzig verhaal, fase en media. Losgekoppelde foto&apos;s worden niet uit je opslag verwijderd.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="mt-2 space-y-7">
            <section aria-labelledby="edit-media-title">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <Label id="edit-media-title" className="text-base font-semibold">Media</Label>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    De volgorde hieronder wordt in één keer veilig opgeslagen.
                  </p>
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">{media.length}/50</span>
              </div>
              <ProjectImagePicker
                currentCount={media.length}
                disabled={formLocked}
                onFiles={addSelectedFiles}
              />

              {media.length > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {media.map((item, index) => {
                    return (
                      <div key={item.key} className="border bg-background p-2">
                        <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                          {item.contentType === "application/pdf" ? (
                            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                              <FileText className="h-8 w-8" aria-hidden="true" />
                              <span className="text-xs font-semibold">PDF-document</span>
                            </div>
                          ) : item.contentType?.startsWith("video/") ? (
                            <ResilientVideo src={item.previewUrl} className="h-full w-full object-cover" aria-label={`Video ${index + 1}`} />
                          ) : (
                            <ResilientImage src={item.previewUrl} alt={`Media ${index + 1}`} className="h-full w-full object-cover" />
                          )}
                          <button
                            type="button"
                            onClick={() => removeMedia(item.key)}
                            className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center bg-background/90 hover:text-destructive"
                            aria-label={`Media ${index + 1} uit update halen`}
                            disabled={formLocked}
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                        {item.assetId ? (
                          <p className="mt-2 text-xs font-medium text-emerald-700" role="status">Privé verwerkt</p>
                        ) : activeUploadKey === item.key ? (
                          <p className="mt-2 text-xs text-muted-foreground" role="status">
                            {saveStage === "processing" ? "Veilig verwerken…" : "Privé uploaden…"}
                          </p>
                        ) : failedUploadKey === item.key ? (
                          <div className="mt-2 border-l-2 border-destructive pl-2">
                            <p className="text-xs leading-5 text-destructive" role="alert">Deze foto kon niet worden bewaard. Je tekst is niet verloren.</p>
                            <button
                              type="button"
                              className="mt-1 min-h-11 text-left text-xs font-semibold text-accent underline underline-offset-4"
                              onClick={() => void retryMediaUpload(item.key)}
                              disabled={formLocked}
                              aria-label={`${item.file?.name ?? `Media ${index + 1}`} opnieuw uploaden`}
                            >
                              Deze foto opnieuw
                            </button>
                          </div>
                        ) : null}
                        <div className="mt-2 grid grid-cols-2 gap-1">
                          <button type="button" onClick={() => moveMedia(item.key, -1)} disabled={index === 0 || formLocked} className="flex min-h-11 items-center justify-center border disabled:opacity-30" aria-label={`Media ${index + 1} naar voren`}><ArrowLeft className="h-4 w-4" /></button>
                          <button type="button" onClick={() => moveMedia(item.key, 1)} disabled={index === media.length - 1 || formLocked} className="flex min-h-11 items-center justify-center border disabled:opacity-30" aria-label={`Media ${index + 1} naar achteren`}><ArrowRight className="h-4 w-4" /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="space-y-4 border-t border-border pt-6" aria-labelledby="edit-story-title">
              <h3 id="edit-story-title" className="font-sans text-base font-semibold">Het verhaal</h3>
              <div className="space-y-2">
                <Label htmlFor="edit-update-title">Titel</Label>
                <Input id="edit-update-title" value={title} onChange={(event) => { setTitle(event.target.value); markDirty(); }} maxLength={120} className="min-h-11" disabled={formLocked} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-update-description">Vertel wat je wilt onthouden</Label>
                <Textarea id="edit-update-description" value={description} onChange={(event) => { setDescription(event.target.value); markDirty(); }} maxLength={10000} rows={5} className="min-h-32 resize-y" disabled={formLocked} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Fase</Label>
                  <PhaseSelect
                    value={phaseId}
                    onChange={(value) => { setPhaseId(value); markDirty(); }}
                    options={phaseOptions}
                    onAddCustom={addCustomPhase}
                    disabled={formLocked || projectQuery.isLoading || projectQuery.isError}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-update-date">Datum</Label>
                  <Input id="edit-update-date" type="date" value={updateDate} onChange={(event) => { setUpdateDate(event.target.value); markDirty(); }} required className="min-h-11" disabled={formLocked} />
                </div>
              </div>
            </section>

            {projectQuery.isError && (
              <p role="alert" className="text-sm text-destructive">Rechten voor deze verbouwing konden niet veilig worden gecontroleerd.</p>
            )}
            {saveStatus && (
              <p role={saveError ? "alert" : "status"} aria-live="polite" className={`text-sm ${saveError ? "text-destructive" : "text-muted-foreground"}`}>{saveStatus}</p>
            )}

            <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:items-center">
              <Button type="button" variant="outline" onClick={() => setShowDeletePrompt(true)} className="min-h-11 gap-2 text-destructive hover:text-destructive" disabled={formLocked || !canEdit}>
                <Trash2 className="h-4 w-4" aria-hidden="true" /> Bouwmoment verwijderen
              </Button>
              <div className="flex flex-1 gap-3 sm:justify-end">
                <Button type="button" variant="ghost" onClick={requestClose} className="min-h-11 flex-1 sm:flex-none" disabled={loading}>Annuleren</Button>
                <Button
                  type="submit"
                  className="min-h-11 flex-[2] bg-accent text-accent-foreground hover:bg-accent/90 sm:flex-none"
                  disabled={loading || deleteMutation.isPending || deleteRetryLocked || !isDirty || !canEdit}
                >
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  {retryLocked ? "Zelfde wijziging opnieuw" : loading ? "Opslaan…" : "Wijzigingen opslaan"}
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <DiscardUpdateDraftDialog
        open={showDiscardPrompt}
        onOpenChange={setShowDiscardPrompt}
        onDiscard={() => {
          setShowDiscardPrompt(false);
          setIsDirty(false);
          onClose();
        }}
      />

      <AlertDialog open={showDeletePrompt} onOpenChange={setShowDeletePrompt}>
        <AlertDialogContent className="z-[1200] w-[calc(100%-2rem)] max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Bouwmoment definitief uit de verbouwing verwijderen?</AlertDialogTitle>
            <AlertDialogDescription>
              Het Bouwmoment verdwijnt uit het Verhaal. Gekoppelde mediabestanden worden niet hard verwijderd en blijven volgens het bewaarbeleid beschermd.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={deleteMutation.isPending || deleteRetryLocked}>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => { event.preventDefault(); void handleDelete(); }}
              disabled={deleteMutation.isPending}
              className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {deleteRetryLocked ? "Zelfde verwijdering opnieuw" : "Ja, Bouwmoment verwijderen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default EditStepDialog;
