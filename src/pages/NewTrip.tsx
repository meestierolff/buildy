import { useRef, useState } from "react";
import { Navigate, useNavigate, Link, useSearchParams } from "@/lib/router";
import { ArrowLeft, BookOpen, CalendarDays, Check, ImagePlus, LockKeyhole } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCreateProjectMutation } from "@/hooks/useProjectApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { usePageMeta } from "@/hooks/usePageMeta";
import { ApiClientError } from "@/lib/apiClient";
import { createClientIdempotencyKey } from "@/lib/clientIdempotency";
import { ProjectVisibilityContinuationError } from "@/lib/projectApi";
import { authPagePath } from "@/lib/authClient";
import {
  deleteLandingPhotoHandoff,
  LANDING_PHOTO_INTENT,
} from "@/lib/landingPhotoHandoffStore";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";
import {
  buildCreateProjectCommand,
  type CreateProjectFlowCommand,
} from "@/lib/projectWriteFlow";
import type { ProjectVisibility } from "../../shared/contracts/projects";

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

const VISIBILITY_OPTIONS: ReadonlyArray<{
  value: ProjectVisibility;
  label: string;
  description: string;
}> = [
  {
    value: "private",
    label: "Alleen ik",
    description: "Alleen jij kunt de verbouwing en Bouwmomenten bekijken.",
  },
  {
    value: "followers",
    label: "Mijn volgers",
    description: "Alleen actieve volgers van je Buildy-profiel kunnen gepubliceerde Bouwmomenten bekijken.",
  },
  {
    value: "unlisted",
    label: "Alleen via deellink",
    description: "Na het aanmaken kies je een tijdelijke deellink. Zonder die sleutel kan niemand kijken.",
  },
  {
    value: "public",
    label: "Openbaar",
    description: "Iedereen kan kijken en de verbouwing kan verschijnen in Ontdekken en de volgfeed.",
  },
];

const NewTrip = () => {
  const { user, loading: authLoading } = useAuth();
  usePageMeta({
    title: "Nieuwe verbouwing starten — Buildy",
    description: "Start een nieuw verbouwingsdagboek en leg de basis van je renovatie vast.",
    path: PRODUCT_ROUTES.newProject,
    noIndex: true,
  });
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const importsLandingPhoto = searchParams.get("intent") === LANDING_PHOTO_INTENT;
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectType, setProjectType] = useState("");
  const [address, setAddress] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [visibility, setVisibility] = useState<ProjectVisibility>("private");
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
    if (startDate && endDate && endDate < startDate) {
      toast.error("De einddatum kan niet vóór de startdatum liggen.");
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
        description,
        projectType,
        address,
        startDate,
        expectedEndDate: endDate,
        visibility,
      }, createClientIdempotencyKey("project-create"));
      requestStarted = true;
      const result = await createProject.mutateAsync(pendingCommandRef.current);

      pendingCommandRef.current = null;
      setRetryLocked(false);
      createdProjectId = result.project.id;
    } catch (error) {
      console.error("Unexpected project creation failure", error);
      const outcomeUncertain =
        requestStarted && (
          error instanceof ProjectVisibilityContinuationError ||
          !(error instanceof ApiClientError) ||
          error.status >= 500 ||
          [408, 425, 429].includes(error.status)
        );
      if (outcomeUncertain) {
        setRetryLocked(true);
        setSaveError("De serverbevestiging ontbreekt nog. Probeer dezelfde opdracht opnieuw; je veilige opdracht-ID blijft behouden.");
        toast.error("We konden de verbouwing nog niet bevestigen. Probeer opnieuw.");
      } else {
        pendingCommandRef.current = null;
        setRetryLocked(false);
        setSaveError(error instanceof ApiClientError
          ? error.message
          : "Je invoer staat nog klaar. Controleer je gegevens en probeer opnieuw.");
        toast.error("Kon je verbouwing niet aanmaken. Controleer je invoer en probeer opnieuw.");
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
      setCancelError("De lokale foto kon niet worden verwijderd. Probeer Annuleren opnieuw voordat je deze verbouwing verlaat.");
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
    return <Navigate to={`${authPagePath(next)}&mode=register`} replace />;
  }

  const formLocked = loading || retryLocked;

  return (
    <div className="bg-background">
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-6 md:px-8 md:py-14">
        <Link to={PRODUCT_ROUTES.projects} className="mb-8 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Terug naar mijn verbouwingen
        </Link>

        <div className="mb-10 max-w-2xl md:mb-12">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">Nieuwe verbouwing</p>
          <h1 className="font-sans text-4xl font-semibold leading-[1.04] tracking-tight sm:text-5xl">
            Leg de basis van je verbouwing vast.
          </h1>
          <p className="mt-5 max-w-xl text-sm font-light leading-relaxed text-muted-foreground sm:text-base">
            Een naam en type zijn genoeg om te beginnen. Foto's, budget en alle mooie details voeg je daarna rustig toe.
          </p>
        </div>

        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-14">
          <form id="new-project-form" onSubmit={handleSubmit} className="space-y-10" noValidate={false} aria-busy={loading}>
            <section className="border-t border-border pt-6" aria-labelledby="project-details-title">
              <div className="mb-6">
                <h2 id="project-details-title" className="font-sans text-xl font-semibold">Vertel iets over je plan</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Dit vormt straks de voorkant van je verbouwingsdagboek.</p>
              </div>

              <div className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="title" className="text-xs font-semibold">Naam van je verbouwing <span className="text-accent" aria-hidden="true">*</span></Label>
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
                    aria-describedby="title-help"
                  />
                  <div id="title-help" className="flex justify-between gap-4 text-[11px] text-muted-foreground">
                    <span>Kies een naam die je later graag op je Bouwboek ziet.</span>
                    <span className="shrink-0 tabular-nums">{title.length}/80</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="type" className="text-xs font-semibold">Type verbouwing</Label>
                  <Select value={projectType} onValueChange={setProjectType} disabled={formLocked}>
                  <SelectTrigger id="type" className="h-12 bg-background"><SelectValue placeholder="Kies wat het beste past" /></SelectTrigger>
                    <SelectContent>
                      {PROJECT_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="description" className="text-xs font-semibold">Korte beschrijving</Label>
                    <span className="text-[11px] tabular-nums text-muted-foreground">{description.length}/500</span>
                  </div>
                  <Textarea
                    id="description"
                    name="description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    maxLength={500}
                    placeholder="Wat ga je aanpakken en waar kijk je het meest naar uit?"
                    rows={4}
                    className="min-h-28 resize-y bg-background"
                    disabled={formLocked}
                  />
                </div>
              </div>
            </section>

            <section className="border-t border-border pt-6" aria-labelledby="planning-title">
              <div className="mb-6 flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-border text-foreground">
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h2 id="planning-title" className="font-sans text-xl font-semibold">Planning en plek</h2>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Alles hier is optioneel en later aan te passen.</p>
                </div>
              </div>

              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="start" className="text-xs font-semibold">Startdatum</Label>
                    <Input id="start" name="start-date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="h-12 bg-background" disabled={formLocked} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="end" className="text-xs font-semibold">Verwachte einddatum</Label>
                    <Input id="end" name="end-date" type="date" min={startDate || undefined} value={endDate} onChange={(event) => setEndDate(event.target.value)} className="h-12 bg-background" disabled={formLocked} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="address" className="flex items-center gap-2 text-xs font-semibold">
                    Adres <LockKeyhole className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                  </Label>
                  <Input
                    id="address"
                    name="street-address"
                    autoComplete="street-address"
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    maxLength={180}
                    placeholder="Bijv. Hoofdstraat 12, Utrecht"
                    className="h-12 bg-background"
                    aria-describedby="address-help"
                    disabled={formLocked}
                  />
                  <p id="address-help" className="text-[11px] leading-relaxed text-muted-foreground">Je adres wordt apart en privé opgeslagen. Ook bij een openbare verbouwing ziet niemand anders het.</p>
                </div>
              </div>
            </section>

            <section className="border-y border-border py-6" aria-labelledby="visibility-title">
              <div className="flex gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-border text-foreground">
                  <LockKeyhole className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <Label id="visibility-title" htmlFor="visibility" className="font-semibold">Wie kan je verbouwing zien?</Label>
                  <Select
                    value={visibility}
                    onValueChange={(value) => setVisibility(value as ProjectVisibility)}
                    disabled={formLocked}
                  >
                    <SelectTrigger id="visibility" aria-describedby="visibility-help" className="h-12 bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VISIBILITY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p id="visibility-help" className="max-w-md text-xs leading-relaxed text-muted-foreground">
                    {VISIBILITY_OPTIONS.find((option) => option.value === visibility)?.description}
                    {" "}Je adres en budget blijven altijd privé.
                  </p>
                </div>
              </div>
            </section>

            {saveError && <p role="status" aria-live="polite" className="text-sm text-destructive">{saveError}</p>}

            {cancelError ? <p role="alert" className="text-sm text-destructive">{cancelError}</p> : null}
            <div className="flex flex-col-reverse items-center gap-3 pt-1 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 w-full sm:w-auto"
                disabled={loading || cancelling}
                onClick={() => void handleCancel()}
              >
                {cancelling ? "Lokale foto verwijderen…" : "Annuleren"}
              </Button>
              <Button type="submit" disabled={loading || title.trim().length < 2} className="min-h-11 w-full bg-accent px-8 text-accent-foreground hover:bg-accent/90 sm:w-auto">
                {loading ? "Verbouwing wordt klaargezet…" : saveError ? "Opnieuw proberen" : "Verbouwing starten"}
              </Button>
            </div>
          </form>

          <aside className="border-l-2 border-accent bg-foreground p-6 text-background lg:sticky lg:top-24" aria-labelledby="next-title">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-background/55">Hierna</p>
            <h2 id="next-title" className="mt-2 font-sans text-2xl font-semibold leading-tight">Je Verhaal komt tot leven.</h2>
            <p className="mt-3 text-xs font-light leading-relaxed text-background/65">Na het starten begeleiden we je langs je eerste Bouwmoment. Alles blijft tussentijds aanpasbaar.</p>
            <ol className="mt-6 space-y-4">
              {[
                { icon: Check, text: "Basis van je verbouwing opslaan" },
                { icon: ImagePlus, text: "Eerste foto's en Bouwmoment toevoegen" },
                { icon: BookOpen, text: "Automatisch bouwen aan je Bouwboek" },
              ].map(({ icon: Icon, text }, index) => (
                <li key={text} className="flex items-center gap-3 text-xs">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center ${index === 0 ? "bg-accent text-accent-foreground" : "border border-background/20 text-background/55"}`}>
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span className={index === 0 ? "font-semibold" : "text-background/65"}>{text}</span>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default NewTrip;
