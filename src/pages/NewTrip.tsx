import { useState } from "react";
import { Navigate, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, BookOpen, CalendarDays, Check, ImagePlus, LockKeyhole, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { usePageMeta } from "@/hooks/usePageMeta";

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
    title: "Nieuw project starten — Buildy",
    description: "Start een nieuw verbouwingsdagboek en leg de basis van je renovatie vast.",
    path: "/trips/new",
    noIndex: true,
  });
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectType, setProjectType] = useState("");
  const [address, setAddress] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isPublic, setIsPublic] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || loading) return;

    const normalizedTitle = title.trim();
    if (normalizedTitle.length < 2) {
      toast.error("Geef je project een herkenbare naam.");
      return;
    }
    if (startDate && endDate && endDate < startDate) {
      toast.error("De einddatum kan niet vóór de startdatum liggen.");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("trips")
        .insert({
          user_id: user.id,
          title: normalizedTitle,
          description: description.trim() || null,
          project_type: projectType || null,
          start_date: startDate || null,
          end_date: endDate || null,
          countries: [],
          is_public: isPublic,
        })
        .select()
        .single();

      if (error || !data) {
        console.error("Project creation failed", error);
        toast.error("Kon je project niet aanmaken. Controleer je verbinding en probeer opnieuw.");
        return;
      }

      const normalizedAddress = address.trim();
      if (normalizedAddress) {
        const { error: addressError } = await supabase
          .from("trip_private_info")
          .insert({ trip_id: data.id, address: normalizedAddress });

        if (addressError) {
          console.error("Private project address creation failed", addressError);
          const { error: rollbackError } = await supabase.from("trips").delete().eq("id", data.id);
          if (!rollbackError) {
            toast.error("Je adres kon niet veilig worden opgeslagen. Er is nog geen project aangemaakt; probeer het opnieuw.");
            return;
          }

          console.error("Project rollback after address failure failed", rollbackError);
          toast.error("Je project is gemaakt, maar het adres is niet opgeslagen. Voeg dit later toe bij de projectinstellingen.");
          navigate(`/trip/${data.id}`, { replace: true });
          return;
        }
      }

      toast.success("Je project staat klaar. Tijd voor de eerste update!");
      navigate(`/trip/${data.id}`, { replace: true });
    } catch (error) {
      console.error("Unexpected project creation failure", error);
      toast.error("Er ging iets mis. Controleer je verbinding en probeer opnieuw.");
    } finally {
      setLoading(false);
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

  if (!user) return <Navigate to="/auth?mode=register&next=%2Ftrips%2Fnew" replace />;

  return (
    <div className="bg-background">
      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-6 md:px-8 md:py-16">
        <Link to="/" className="mb-9 inline-flex items-center gap-2 rounded-sm text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Terug naar mijn projecten
        </Link>

        <div className="mb-10 max-w-2xl md:mb-12">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-accent-foreground">1</span>
            <p className="eyebrow text-foreground">De basis</p>
            <span className="text-xs text-muted-foreground">van 3</span>
          </div>
          <h1 className="font-serif text-4xl italic leading-[1.02] sm:text-5xl md:text-6xl">
            Leg de basis voor je verbouwing.
          </h1>
          <p className="mt-5 max-w-xl text-sm font-light leading-relaxed text-muted-foreground sm:text-base">
            Een naam en type zijn genoeg om te beginnen. Foto's, budget en alle mooie details voeg je daarna rustig toe.
          </p>
        </div>

        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-14">
          <form id="new-project-form" onSubmit={handleSubmit} className="space-y-6" noValidate={false}>
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7" aria-labelledby="project-details-title">
              <div className="mb-6">
                <h2 id="project-details-title" className="font-serif text-2xl italic">Vertel iets over je plan</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Dit vormt straks de voorkant van je verbouwingsdagboek.</p>
              </div>

              <div className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="title" className="text-xs font-semibold">Projectnaam <span className="text-accent" aria-hidden="true">*</span></Label>
                  <Input
                    id="title"
                    name="title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                    minLength={2}
                    maxLength={80}
                    autoFocus
                    placeholder="Bijv. Ons jaren-30 huis"
                    className="h-12 rounded-lg bg-background"
                    aria-describedby="title-help"
                  />
                  <div id="title-help" className="flex justify-between gap-4 text-[11px] text-muted-foreground">
                    <span>Kies een naam die je later graag op je Bouwboek ziet.</span>
                    <span className="shrink-0 tabular-nums">{title.length}/80</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="type" className="text-xs font-semibold">Type project</Label>
                  <Select value={projectType} onValueChange={setProjectType}>
                    <SelectTrigger id="type" className="h-12 rounded-lg bg-background"><SelectValue placeholder="Kies wat het beste past" /></SelectTrigger>
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
                    className="min-h-28 resize-y rounded-lg bg-background"
                  />
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7" aria-labelledby="planning-title">
              <div className="mb-6 flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h2 id="planning-title" className="font-serif text-2xl italic">Planning en plek</h2>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Alles hier is optioneel en later aan te passen.</p>
                </div>
              </div>

              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="start" className="text-xs font-semibold">Startdatum</Label>
                    <Input id="start" name="start-date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="h-12 rounded-lg bg-background" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="end" className="text-xs font-semibold">Verwachte einddatum</Label>
                    <Input id="end" name="end-date" type="date" min={startDate || undefined} value={endDate} onChange={(event) => setEndDate(event.target.value)} className="h-12 rounded-lg bg-background" />
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
                    className="h-12 rounded-lg bg-background"
                    aria-describedby="address-help"
                  />
                  <p id="address-help" className="text-[11px] leading-relaxed text-muted-foreground">Je adres wordt apart en privé opgeslagen. Ook bij een openbaar project ziet niemand anders het.</p>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7" aria-labelledby="visibility-title">
              <div className="flex items-start justify-between gap-5">
                <div className="flex gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
                    {isPublic ? <Users className="h-4 w-4" aria-hidden="true" /> : <LockKeyhole className="h-4 w-4" aria-hidden="true" />}
                  </div>
                  <div>
                    <Label id="visibility-title" htmlFor="public" className="font-semibold">{isPublic ? "Openbaar project" : "Privé beginnen"}</Label>
                    <p id="visibility-help" className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                      {isPublic
                        ? "Andere Buildy-gebruikers kunnen je tijdlijn bekijken en je project volgen. Je adres en budget blijven privé."
                        : "Alleen jij ziet het project. Je kunt delen later altijd aanzetten bij de projectinstellingen."}
                    </p>
                  </div>
                </div>
                <Switch id="public" checked={isPublic} onCheckedChange={setIsPublic} aria-describedby="visibility-help" className="mt-1 shrink-0" />
              </div>
            </section>

            <div className="flex flex-col-reverse items-center gap-3 pt-1 sm:flex-row sm:justify-end">
              <Button asChild type="button" variant="ghost" className="w-full sm:w-auto">
                <Link to="/">Annuleren</Link>
              </Button>
              <Button type="submit" variant="pill" size="pill" disabled={loading || title.trim().length < 2} className="w-full px-8 sm:w-auto">
                {loading ? "Project wordt klaargezet…" : "Project starten"}
              </Button>
            </div>
          </form>

          <aside className="rounded-2xl bg-foreground p-6 text-background lg:sticky lg:top-24" aria-labelledby="next-title">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-background/55">Hierna</p>
            <h2 id="next-title" className="mt-2 font-serif text-3xl italic">Je dagboek komt tot leven.</h2>
            <p className="mt-3 text-xs font-light leading-relaxed text-background/65">Na het starten begeleiden we je langs je eerste update. Alles blijft tussentijds aanpasbaar.</p>
            <ol className="mt-6 space-y-4">
              {[
                { icon: Check, text: "Projectbasis opslaan" },
                { icon: ImagePlus, text: "Eerste foto's en update toevoegen" },
                { icon: BookOpen, text: "Automatisch bouwen aan je Bouwboek" },
              ].map(({ icon: Icon, text }, index) => (
                <li key={text} className="flex items-center gap-3 text-xs">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${index === 0 ? "bg-accent text-accent-foreground" : "border border-background/20 text-background/55"}`}>
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
