import { useRef, useState } from "react";
import { ArrowLeft, ImagePlus, LockKeyhole } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useCreateProjectMutation } from "@/hooks/useProjectApi";
import { ApiClientError } from "@/lib/apiClient";
import { authPagePath } from "@/lib/authClient";
import { createClientIdempotencyKey } from "@/lib/clientIdempotency";
import {
  deleteLandingPhotoHandoff,
  LANDING_PHOTO_INTENT,
} from "@/lib/landingPhotoHandoffStore";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";
import {
  buildCreateProjectCommand,
  type CreateProjectFlowCommand,
} from "@/lib/projectWriteFlow";
import { Link, Navigate, useNavigate, useSearchParams } from "@/lib/router";

const PROJECT_TYPES = [
  "Volledige renovatie",
  "Nieuwbouw",
  "Verduurzaming",
  "Aanbouw",
  "Keuken",
  "Badkamer",
  "Zolder",
  "Tuin",
  "Boot of camper",
  "Anders",
];

const NewTrip = () => {
  const { user, loading: authLoading } = useAuth();
  usePageMeta({
    title: "Nieuwe verbouwing starten — Buildy",
    description: "Geef je verbouwing een naam en leg daarna meteen je eerste Bouwmoment vast.",
    path: PRODUCT_ROUTES.newProject,
    noIndex: true,
  });

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const importsLandingPhoto = searchParams.get("intent") === LANDING_PHOTO_INTENT;
  const [title, setTitle] = useState("");
  const [projectType, setProjectType] = useState("");
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [retryLocked, setRetryLocked] = useState(false);
  const submitGuardRef = useRef(false);
  const pendingCommandRef = useRef<CreateProjectFlowCommand | null>(null);
  const createProject = useCreateProjectMutation();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || submitGuardRef.current) return;

    const normalizedTitle = title.trim();
    if (normalizedTitle.length < 2) {
      toast.error("Geef je verbouwing een herkenbare naam.");
      return;
    }

    submitGuardRef.current = true;
    setLoading(true);
    setSaveError(null);
    let requestStarted = false;
    let createdProjectId: string | null = null;

    try {
      pendingCommandRef.current ??= buildCreateProjectCommand({
        title: normalizedTitle,
        description: "",
        projectType,
        address: "",
        startDate: "",
        expectedEndDate: "",
        visibility: "private",
      }, createClientIdempotencyKey("project-create"));
      requestStarted = true;
      const result = await createProject.mutateAsync(pendingCommandRef.current);
      pendingCommandRef.current = null;
      setRetryLocked(false);
      createdProjectId = result.project.id;
    } catch (error) {
      console.error("Unexpected project creation failure", error);
      const outcomeUncertain = requestStarted && (
        !(error instanceof ApiClientError)
        || error.status >= 500
        || [408, 425, 429].includes(error.status)
      );

      if (outcomeUncertain) {
        setRetryLocked(true);
        setSaveError("De serverbevestiging ontbreekt nog. Probeer dezelfde opdracht opnieuw; je veilige opdracht-ID blijft behouden.");
        toast.error("We konden de verbouwing nog niet bevestigen. Probeer opnieuw.");
      } else {
        pendingCommandRef.current = null;
        setRetryLocked(false);
        setSaveError(
          error instanceof ApiClientError
            ? error.message
            : "Je invoer staat nog klaar. Controleer de naam en probeer opnieuw.",
        );
        toast.error("Kon je verbouwing niet aanmaken. Probeer opnieuw.");
      }
    } finally {
      submitGuardRef.current = false;
      setLoading(false);
    }

    if (createdProjectId) {
      const next = new URLSearchParams({ update: "nieuw" });
      if (importsLandingPhoto) next.set("intent", LANDING_PHOTO_INTENT);
      navigate(`${PRODUCT_ROUTES.project(createdProjectId)}?${next.toString()}`, { replace: true });
      toast.success("Je verbouwing staat klaar. Tijd voor het eerste Bouwmoment!");
    }
  };

  const handleCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    setCancelError(null);
    try {
      if (importsLandingPhoto) await deleteLandingPhotoHandoff();
      navigate("/");
    } catch (error) {
      console.error("Clear landing photo after project cancellation failed", error);
      setCancelError("De lokale foto kon niet worden verwijderd. Probeer Annuleren opnieuw voordat je deze pagina verlaat.");
    } finally {
      setCancelling(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center" role="status" aria-live="polite">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
        <span className="sr-only">Account controleren…</span>
      </div>
    );
  }

  if (!user) {
    const next = importsLandingPhoto
      ? `${PRODUCT_ROUTES.newProject}?intent=${LANDING_PHOTO_INTENT}`
      : PRODUCT_ROUTES.newProject;
    return <Navigate to={authPagePath(next)} replace />;
  }

  const formLocked = loading || retryLocked;

  return (
    <div className="bg-background">
      <main className="mx-auto max-w-3xl px-5 py-8 sm:px-6 md:px-8 md:py-16">
        <Link
          to={PRODUCT_ROUTES.landing}
          className="mb-9 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Terug
        </Link>

        <header className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">Je verbouwverhaal begint hier</p>
          <h1 className="mt-3 font-serif text-4xl leading-[1.02] sm:text-5xl">Hoe heet je verbouwing?</h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
            Een naam is genoeg. Daarna open je meteen je eerste Bouwmoment en kun je foto&apos;s toevoegen.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="mt-10 space-y-7 border-y border-border py-8" aria-busy={loading}>
          <div className="space-y-2">
            <Label htmlFor="title" className="text-sm font-semibold">
              Hoe heet je verbouwing? <span className="text-accent" aria-hidden="true">*</span>
            </Label>
            <Input
              id="title"
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              minLength={2}
              maxLength={80}
              autoFocus
              disabled={formLocked}
              placeholder="Bijv. Ons jaren-30 huis"
              className="h-12 bg-background"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="type" className="text-sm font-semibold">Wat verbouw je? <span className="font-normal text-muted-foreground">(optioneel)</span></Label>
            <Select value={projectType} onValueChange={setProjectType} disabled={formLocked}>
              <SelectTrigger id="type" className="h-12 bg-background">
                <SelectValue placeholder="Kies wat het beste past" />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-start gap-3 border-l-2 border-accent bg-muted/30 px-4 py-3 text-sm">
            <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <p><span className="font-semibold">Je begint privé.</span> Alleen jij ziet deze verbouwing totdat je zelf een deellink maakt.</p>
          </div>

          {saveError ? <p role="status" aria-live="polite" className="text-sm text-destructive">{saveError}</p> : null}
          {cancelError ? <p role="alert" className="text-sm text-destructive">{cancelError}</p> : null}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 w-full sm:w-auto"
              disabled={loading || cancelling}
              onClick={() => void handleCancel()}
            >
              {cancelling ? "Lokale foto verwijderen…" : "Annuleren"}
            </Button>
            <Button
              type="submit"
              disabled={loading || title.trim().length < 2}
              className="min-h-11 w-full bg-accent px-7 text-accent-foreground hover:bg-accent/90 sm:w-auto"
            >
              {loading ? "Verbouwing starten…" : saveError ? "Opnieuw proberen" : "Verbouwing starten"}
              {!loading ? <ImagePlus className="h-4 w-4" aria-hidden="true" /> : null}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
};

export default NewTrip;
