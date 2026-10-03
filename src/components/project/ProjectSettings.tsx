import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ProjectOverview } from "../../../shared/contracts/projects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useUpdateProjectMutation } from "@/hooks/useProjectApi";
import { ApiClientError } from "@/lib/apiClient";
import { createClientIdempotencyKey } from "@/lib/clientIdempotency";
import { deleteProjectPhase } from "@/lib/projectApi";
import { preparePrivateProjectImage, uploadProjectImage, type PreparedProjectImage } from "@/lib/privateMediaApi";

export default function ProjectSettings({ project }: { project: ProjectOverview }) {
  const queryClient = useQueryClient();
  const updateProject = useUpdateProjectMutation(project.id);
  const [startDate, setStartDate] = useState(project.startDate ?? "");
  const [expectedEndDate, setExpectedEndDate] = useState(project.expectedEndDate ?? "");
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const coverUpload = useRef<{ file: File; key: string; prepared?: PreparedProjectImage }>();
  const [deletingPhase, setDeletingPhase] = useState<string | null>(null);
  const phaseCommands = useRef(new Map<string, { idempotencyKey: string; expectedProjectVersion: number }>());
  const customPhases = project.phases.filter((phase) => phase.isCustom);

  useEffect(() => {
    setStartDate(project.startDate ?? "");
    setExpectedEndDate(project.expectedEndDate ?? "");
  }, [project.startDate, project.expectedEndDate]);

  const saveDates = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await updateProject.mutateAsync({ expectedVersion: project.version, startDate: startDate || null, expectedEndDate: expectedEndDate || null });
      toast.success("Planning bijgewerkt. Je voortgang loopt automatisch mee.");
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Je planning kon niet worden opgeslagen.");
    }
  };

  const saveCover = async (file: File) => {
    setCoverFile(file);
    setCoverBusy(true);
    try {
      if (coverUpload.current?.file !== file) coverUpload.current = { file, key: createClientIdempotencyKey("project-cover") };
      const upload = coverUpload.current;
      upload.prepared ??= await preparePrivateProjectImage(file);
      await uploadProjectImage({ projectId: project.id, purpose: "project_cover", idempotencyKey: upload.key, prepared: upload.prepared });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["social"] }),
      ]);
      setCoverFile(null);
      coverUpload.current = undefined;
      toast.success("Omslagfoto bijgewerkt");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "De omslagfoto kon niet worden opgeslagen.");
    } finally { setCoverBusy(false); }
  };

  const removePhase = async (phaseId: string) => {
    setDeletingPhase(phaseId);
    try {
      const command = phaseCommands.current.get(phaseId) ?? {
        idempotencyKey: createClientIdempotencyKey("phase-delete"), expectedProjectVersion: project.version,
      };
      phaseCommands.current.set(phaseId, command);
      const result = await deleteProjectPhase(project.id, phaseId, command);
      queryClient.setQueryData(["projects", "overview", project.id], result.project);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Fase verwijderd. Je Bouwmomenten zijn bewaard.");
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409) {
        phaseCommands.current.delete(phaseId);
        await queryClient.invalidateQueries({ queryKey: ["projects", "overview", project.id] });
      }
      toast.error(error instanceof ApiClientError ? error.message : "De fase kon niet worden verwijderd.");
    } finally { setDeletingPhase(null); }
  };

  return <div className="space-y-5">
    <div className="space-y-2">
      <Label htmlFor="project-cover">Omslagfoto</Label>
      <label htmlFor="project-cover" className="relative flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium focus-within:ring-2 focus-within:ring-ring">
        {coverBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Camera className="h-4 w-4" aria-hidden="true" />} {coverBusy ? "Omslag verwerken…" : "Omslagfoto kiezen"}
        <input id="project-cover" className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif" disabled={coverBusy} onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void saveCover(file);
        }} />
      </label>
      <p className="text-xs leading-5 text-muted-foreground">Deze foto blijft je omslag, ook wanneer je een nieuw Bouwmoment toevoegt.</p>
      {coverFile && !coverBusy && <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => void saveCover(coverFile)}>Omslag opnieuw proberen</Button>}
    </div>
    <form onSubmit={saveDates} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="project-start-date">Begindatum</Label><Input id="project-start-date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="min-h-11" /></div>
        <div className="space-y-2"><Label htmlFor="project-end-date">Verwachte einddatum</Label><Input id="project-end-date" type="date" min={startDate || undefined} value={expectedEndDate} onChange={(event) => setExpectedEndDate(event.target.value)} className="min-h-11" /></div>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">Je voortgang toont hoeveel van deze geplande periode is verstreken. Het is geen meting van het afgeronde werk.</p>
      <Button type="submit" variant="outline" disabled={updateProject.isPending} className="min-h-11 gap-2">{updateProject.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />} Planning opslaan</Button>
    </form>
    {customPhases.length > 0 && <div className="space-y-2">
      <h3 className="text-sm font-medium">Eigen fases</h3>
      <ul className="divide-y rounded-lg border">
        {customPhases.map((phase) => <li key={phase.id} className="flex min-h-12 items-center justify-between gap-2 px-3">
          <span className="min-w-0 break-words text-sm">{phase.name}</span>
          <AlertDialog>
            <AlertDialogTrigger asChild><Button type="button" size="icon" variant="ghost" disabled={deletingPhase !== null} aria-label={`Fase ${phase.name} verwijderen`} className="min-h-11 min-w-11 shrink-0">{deletingPhase === phase.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>Fase {phase.name} verwijderen?</AlertDialogTitle><AlertDialogDescription>Je Bouwmomenten, foto’s en aantekeningen blijven bewaard. De koppeling met deze fase vervalt.</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel>Annuleren</AlertDialogCancel><AlertDialogAction onClick={() => void removePhase(phase.id)}>Fase verwijderen</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </li>)}
      </ul>
    </div>}
  </div>;
}
