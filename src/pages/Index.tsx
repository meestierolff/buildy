import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Plus, Home, Hammer, Search, X, BookOpen, ArrowRight, Camera, Check, LockKeyhole, Users } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import ProjectCard from "@/components/ProjectCard";
import { applyProjectMediaSummaries, loadProjectMediaSummaries } from "@/lib/projectMedia";
import { usePageMeta } from "@/hooks/usePageMeta";

interface Project {
  id: string;
  title: string;
  project_type: string | null;
  progress_percentage: number | null;
  cover_image_url: string | null;
  cover_media_type?: string | null;
  user_id: string;
  is_public: boolean;
  created_at: string;
  profile_name?: string;
  step_count: number;
  follower_count: number;
}

type TripRow = Database["public"]["Tables"]["trips"]["Row"];

const Grid = ({ projects, loading, emptyState }: { projects: Project[]; loading: boolean; emptyState: React.ReactNode }) => {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-x-8 gap-y-12 md:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Projecten laden">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse">
            <div className="aspect-[4/5] bg-muted rounded-sm mb-5" />
            <div className="h-5 bg-muted rounded w-3/4 mb-3" />
            <div className="h-3 bg-muted rounded w-1/2" />
          </div>
        ))}
        <span className="sr-only">Projecten laden…</span>
      </div>
    );
  }
  if (projects.length === 0) return <>{emptyState}</>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12">
      {projects.map((p) => (
        <ProjectCard
          key={p.id}
          id={p.id}
          title={p.title}
          projectType={p.project_type}
          progressPercentage={p.progress_percentage}
          coverUrl={p.cover_image_url}
          coverMediaType={p.cover_media_type}
          profileName={p.profile_name}
          stepCount={p.step_count}
        />
      ))}
    </div>
  );
};

const enrich = async (rows: TripRow[]): Promise<Project[]> => {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));

  const [mediaSummaries, favRes, profRes] = await Promise.all([
    loadProjectMediaSummaries(ids),
    supabase.from("favorites").select("project_id").in("project_id", ids),
    supabase.rpc("get_profiles_basic", { _ids: userIds }),
  ]);

  const favCounts = new Map<string, number>();
  (favRes.data || []).forEach((favorite) => favCounts.set(favorite.project_id, (favCounts.get(favorite.project_id) || 0) + 1));
  const profMap = new Map<string, string>();
  (profRes.data || []).forEach((profile) => profMap.set(profile.user_id, profile.display_name));

  // Trip visibility is controlled by trips.is_public — profiles stay publicly findable
  return applyProjectMediaSummaries(rows, mediaSummaries)
    .map((trip) => ({
      ...trip,
      follower_count: favCounts.get(trip.id) || 0,
      profile_name: profMap.get(trip.user_id) || undefined,
    }));
};

const Index = () => {
  const { user } = useAuth();
  usePageMeta({
    title: "Buildy — Verbouwingsdagboek en Bouwboek maken",
    description: "Houd je verbouwing bij met foto's, updates, budget en mijlpalen. Deel je renovatie en maak aan het einde automatisch een gedrukt Bouwboek.",
    path: "/",
  });
  const [tab, setTab] = useState<"discover" | "mine">(user ? "mine" : "discover");
  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [discover, setDiscover] = useState<Project[]>([]);
  const [mine, setMine] = useState<Project[]>([]);
  const [loadingD, setLoadingD] = useState(true);
  const [loadingM, setLoadingM] = useState(true);
  const [discoverError, setDiscoverError] = useState(false);
  const [mineError, setMineError] = useState(false);

  useEffect(() => { setTab(user ? "mine" : "discover"); }, [user]);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("trips")
          .select("*")
          .eq("is_public", true)
          .order("created_at", { ascending: false })
          .limit(40);
        if (error) {
          console.error("Public projects load failed", error);
          setDiscoverError(true);
          return;
        }
        setDiscover(await enrich(data || []));
      } catch (error) {
        console.error("Unexpected public projects load failure", error);
        setDiscoverError(true);
      } finally {
        setLoadingD(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!user) { setLoadingM(false); return; }
    (async () => {
      setLoadingM(true);
      setMineError(false);
      try {
        const { data, error } = await supabase
          .from("trips")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });
        if (error) {
          console.error("Own projects load failed", error);
          setMineError(true);
          return;
        }
        setMine(await enrich(data || []));
      } catch (error) {
        console.error("Unexpected own projects load failure", error);
        setMineError(true);
      } finally {
        setLoadingM(false);
      }
    })();
  }, [user]);

  // Derived sections from public projects
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const activeTypes = Array.from(new Set(discover.map((p) => p.project_type).filter(Boolean))) as string[];

  const filtered = discover.filter((p) => {
    const matchSearch = !search ||
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      (p.profile_name || "").toLowerCase().includes(search.toLowerCase());
    const matchType = !selectedType || p.project_type === selectedType;
    return matchSearch && matchType;
  });

  // Keep discovery sections distinct so the same project is not repeated down the page.
  const shownProjectIds = new Set<string>();
  const takeUnique = (projects: Project[], limit = 6) => {
    let selected = 0;
    return projects.filter((project) => {
      if (selected >= limit || shownProjectIds.has(project.id)) return false;
      shownProjectIds.add(project.id);
      selected += 1;
      return true;
    });
  };
  const trending = takeUnique(
    [...filtered]
      .filter((project) => project.follower_count > 0)
      .sort((a, b) => b.follower_count - a.follower_count),
  );
  const netBegonnen = takeUnique(
    filtered.filter((project) => project.step_count === 0 || project.created_at > twoWeeksAgo),
  );
  const bijnaKlaar = takeUnique(
    filtered.filter((project) => (project.progress_percentage ?? 0) >= 70 && (project.progress_percentage ?? 0) < 100),
  );
  const overigeProjecten = filtered.filter((project) => !shownProjectIds.has(project.id));

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border" aria-labelledby="home-title">
        <div className="pointer-events-none absolute inset-0 opacity-[0.32] blueprint-grid [mask-image:linear-gradient(to_bottom,black,transparent_88%)]" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 py-14 sm:px-6 md:px-8 md:py-20 lg:grid-cols-[1.05fr_0.95fr] lg:gap-20 lg:py-24">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-accent/25 bg-background/85 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-accent backdrop-blur-sm">
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" /> Van eerste sloopdag tot Bouwboek
            </div>
            <h1 id="home-title" className="max-w-3xl font-serif text-5xl italic leading-[0.92] tracking-tight sm:text-6xl md:text-7xl lg:text-[5.25rem]">
              Je verbouwing,<br />
              <span className="text-accent">een verhaal dat blijft.</span>
            </h1>
            <p className="mt-7 max-w-xl text-base font-light leading-relaxed text-muted-foreground md:text-lg">
              Bewaar foto's, keuzes, mijlpalen en budget in één rustig dagboek. Deel je voortgang als je wilt en bundel alles later in een gedrukt Bouwboek.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button asChild variant="pill" size="pillLg" className="w-full sm:w-auto">
                <Link to={user ? "/trips/new" : "/auth?mode=register&next=%2Ftrips%2Fnew"}>
                  {user ? <Plus className="h-4 w-4" /> : null}
                  {user ? "Nieuw project starten" : "Start gratis je dagboek"}
                </Link>
              </Button>
              <Button asChild variant="pillOutline" size="pill" className="w-full bg-background/70 px-6 sm:w-auto">
                <a href="#zo-werkt-het">Zo werkt het <ArrowRight className="h-4 w-4" /></a>
              </Button>
            </div>
            <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground" aria-label="Voordelen">
              {["Gratis beginnen", "Privé of openbaar", "Gemaakt voor je Bouwboek"].map((benefit) => (
                <li key={benefit} className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" /> {benefit}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative mx-auto w-full max-w-lg py-4" aria-hidden="true">
            <div className="absolute inset-x-10 inset-y-6 rotate-3 rounded-2xl border border-border bg-accent/20" />
            <div className="relative -rotate-1 overflow-hidden rounded-2xl border border-border bg-card shadow-[0_28px_70px_-32px_hsl(var(--foreground)/0.35)] transition-transform duration-500 hover:rotate-0">
              <div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-accent">Voorbeeldproject</p>
                  <p className="mt-1 font-serif text-2xl italic">Ons jaren-30 huis</p>
                </div>
                <span className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                  <LockKeyhole className="h-3 w-3" /> Privé
                </span>
              </div>
              <div className="p-5 sm:p-6">
                <div className="mb-6 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <span>Voortgang</span><span className="text-foreground">64%</span>
                </div>
                <div className="mb-7 h-1 overflow-hidden rounded-full bg-muted"><div className="h-full w-[64%] rounded-full bg-accent" /></div>
                <div className="space-y-5">
                  {[
                    { label: "De sleutel", date: "14 maart", done: true },
                    { label: "Sloopwerk afgerond", date: "2 april", done: true },
                    { label: "Nieuwe kozijnen", date: "Vandaag", done: false },
                  ].map((update) => (
                    <div key={update.label} className="grid grid-cols-[28px_1fr_auto] items-center gap-3">
                      <span className={`flex h-7 w-7 items-center justify-center rounded-full ${update.done ? "bg-foreground text-background" : "bg-accent text-accent-foreground"}`}>
                        {update.done ? <Check className="h-3.5 w-3.5" /> : <Camera className="h-3.5 w-3.5" />}
                      </span>
                      <span className="text-sm font-semibold">{update.label}</span>
                      <span className="text-[10px] text-muted-foreground">{update.date}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-7 rounded-xl border border-accent/20 bg-accent/[0.07] px-4 py-3 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">Goed bewaard.</span> Iedere update wordt later een pagina in je Bouwboek.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="zo-werkt-het" className="scroll-mt-24 border-b border-border bg-card" aria-labelledby="how-title">
        <div className="mx-auto max-w-7xl px-5 py-16 sm:px-6 md:px-8 md:py-20">
          <div className="max-w-2xl">
            <p className="eyebrow mb-3">Zo werkt Buildy</p>
            <h2 id="how-title" className="font-serif text-4xl italic leading-tight md:text-5xl">Klein beginnen. Mooi terugkijken.</h2>
          </div>
          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              { icon: Camera, title: "Leg het moment vast", text: "Maak per fase een update met foto's, keuzes, kosten en wat je niet wilt vergeten." },
              { icon: Users, title: "Deel op jouw manier", text: "Begin privé. Nodig later vrienden uit of deel je project met andere verbouwers." },
              { icon: BookOpen, title: "Maak je Bouwboek", text: "Je tijdlijn vormt vanzelf de basis voor een persoonlijk fotoboek van de hele verbouwing." },
            ].map(({ icon: Icon, title, text }, index) => (
              <li key={title} className="rounded-2xl border border-border bg-background p-6">
                <div className="flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-foreground"><Icon className="h-4 w-4" aria-hidden="true" /></span>
                  <span className="font-serif text-2xl italic text-accent">0{index + 1}</span>
                </div>
                <h3 className="mt-7 font-serif text-2xl italic">{title}</h3>
                <p className="mt-2 text-sm font-light leading-relaxed text-muted-foreground">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Bouwboek teaser — laat het eindresultaat zien */}
      <section className="border-b border-border bg-secondary/45">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 sm:px-6 md:grid-cols-2 md:px-8 md:py-24 lg:gap-20">
          {/* Tekst */}
          <div>
            <p className="eyebrow mb-3">Het eindresultaat</p>
            <h2 className="font-serif italic text-4xl md:text-5xl leading-tight mb-5">
              Jouw verbouwing als <span className="text-accent">echt boek.</span>
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-6 font-light">
              Elke update, elke foto, elke mijlpaal — automatisch gebundeld in een gedrukt
              Bouwboek dat je trots op je salontafel legt. Geen losse mappen meer.
            </p>
            <Button asChild variant="pillAccent" size="pill" className="px-7">
              <Link to={user ? "/trips/new" : "/auth?mode=register&next=%2Ftrips%2Fnew"}>
                <BookOpen className="h-4 w-4" /> Start je eigen verhaal <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>

          {/* Boek-mockup */}
          <div className="relative perspective-[1400px]">
            <div className="relative mx-auto w-full max-w-md group">
              {/* Schaduw onder boek */}
              <div className="absolute -bottom-6 left-6 right-6 h-6 bg-foreground/20 blur-2xl rounded-full" />

              {/* Boek */}
              <div
                className="relative aspect-[4/5] overflow-hidden rounded-l-md rounded-r-sm border border-border/60 bg-card shadow-2xl transition-transform duration-500 group-hover:-translate-y-1"
                style={{ transform: "rotateY(-12deg) rotateX(2deg)", transformStyle: "preserve-3d" }}
              >
                {/* Boek-rug links */}
                <div className="absolute left-0 top-0 bottom-0 w-3 bg-gradient-to-r from-foreground/30 via-foreground/10 to-transparent" />
                {/* Bladwijzer */}
                <div className="absolute right-6 -top-1 w-3 h-16 bg-accent shadow-md" />

                {/* Cover-content */}
                <div className="absolute inset-0 flex flex-col">
                  {/* Foto bovenkant */}
                  <div className="flex-1 bg-gradient-to-br from-stone-200 via-stone-300 to-stone-400 relative overflow-hidden">
                    <svg className="absolute inset-0 w-full h-full opacity-20" xmlns="http://www.w3.org/2000/svg">
                      <defs>
                        <pattern id="bookgrid" width="20" height="20" patternUnits="userSpaceOnUse">
                          <path d="M 20 0 H 0 V 20" fill="none" stroke="currentColor" strokeWidth="0.5" />
                        </pattern>
                      </defs>
                      <rect width="100%" height="100%" fill="url(#bookgrid)" />
                    </svg>
                    <Hammer className="absolute inset-0 m-auto h-20 w-20 text-stone-600/60" strokeWidth={1.2} />
                  </div>
                  {/* Titel onderkant */}
                  <div className="bg-card px-6 py-5 border-t-2 border-accent">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-accent">Bouwboek</p>
                    <p className="font-serif text-xl italic leading-tight text-foreground">Van kluswoning naar thuis</p>
                    <p className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">Ons verbouwingsverhaal · 2026</p>
                  </div>
                </div>
              </div>

              {/* Tweede boek erachter — stapel-effect */}
              <div
                className="absolute -bottom-2 -right-2 -z-10 aspect-[4/5] w-[92%] rounded-sm bg-stone-300/70 border border-border/40"
                style={{ transform: "rotateY(-12deg) rotateX(2deg) translateZ(-20px)" }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Projects */}
      <section id="projecten" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-16 sm:px-6 md:px-8 md:py-24" aria-labelledby="projects-title">
        <div className="mb-9 max-w-2xl">
          <p className="eyebrow mb-3">De Buildy-community</p>
          <h2 id="projects-title" className="font-serif text-4xl italic leading-tight md:text-5xl">Kijk mee met andere verbouwers.</h2>
          <p className="mt-3 text-sm font-light leading-relaxed text-muted-foreground">Echte projecten, eerlijke voortgang en ideeën die je meteen kunt bewaren voor later.</p>
        </div>

        <div className="mb-10 flex items-center gap-8 border-b border-border" role="tablist" aria-label="Projectoverzicht">
          <button
            id="discover-tab"
            type="button"
            role="tab"
            aria-selected={tab === "discover"}
            aria-controls="discover-panel"
            onClick={() => setTab("discover")}
            className={`relative rounded-sm py-4 text-[11px] font-bold uppercase tracking-[0.2em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 ${
              tab === "discover" ? "text-foreground" : "text-muted-foreground/60 hover:text-muted-foreground"
            }`}
          >
            Ontdekken
            {tab === "discover" && <span className="absolute bottom-0 left-0 w-full h-0.5 bg-foreground" />}
          </button>
          {user && (
            <button
              id="mine-tab"
              type="button"
              role="tab"
              aria-selected={tab === "mine"}
              aria-controls="mine-panel"
              onClick={() => setTab("mine")}
              className={`relative rounded-sm py-4 text-[11px] font-bold uppercase tracking-[0.2em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 ${
                tab === "mine" ? "text-foreground" : "text-muted-foreground/60 hover:text-muted-foreground"
              }`}
            >
              Mijn projecten
              {tab === "mine" && <span className="absolute bottom-0 left-0 w-full h-0.5 bg-foreground" />}
            </button>
          )}
        </div>

        {tab === "discover" && (
          <div id="discover-panel" role="tabpanel" aria-labelledby="discover-tab">
            {/* Search + type filter */}
            <div className="mb-10 flex flex-col gap-3 sm:flex-row">
              <div className="relative max-w-sm flex-1">
                <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Zoek project of persoon…"
                  aria-label="Zoek project of persoon"
                  className="h-11 w-full rounded-lg border border-border bg-background pl-10 pr-10 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
                {search && (
                  <button type="button" onClick={() => setSearch("")} aria-label="Zoekopdracht wissen" className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {activeTypes.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {activeTypes.map((t) => (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={selectedType === t}
                      onClick={() => setSelectedType(selectedType === t ? "" : t)}
                      className={`rounded-full border px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                        selectedType === t
                          ? "bg-foreground text-background border-foreground"
                          : "border-border text-muted-foreground hover:text-foreground hover:border-foreground"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {loadingD ? (
              <Grid projects={[]} loading={true} emptyState={null} />
            ) : discoverError ? (
              <EmptyState icon={Home} title="Projecten zijn even niet bereikbaar" description="Je eigen gegevens zijn veilig. Vernieuw de pagina om het nog eens te proberen." />
            ) : filtered.length === 0 ? (
              <EmptyState icon={Home} title={search || selectedType ? "Geen resultaten" : "Nog geen publieke projecten"} description={search || selectedType ? "Probeer een andere zoekterm of filter." : "Zodra anderen hun verbouwing delen verschijnen ze hier."} />
            ) : (
              <div className="space-y-20">
                {trending.length > 0 && (
                  <section>
                    <div className="flex items-baseline gap-3 mb-8">
                      <h2 className="text-[11px] font-bold uppercase tracking-[0.2em]">Populair</h2>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                    <Grid projects={trending} loading={false} emptyState={null} />
                  </section>
                )}
                {netBegonnen.length > 0 && (
                  <section>
                    <div className="flex items-baseline gap-3 mb-8">
                      <h2 className="text-[11px] font-bold uppercase tracking-[0.2em]">Net begonnen</h2>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                    <Grid projects={netBegonnen} loading={false} emptyState={null} />
                  </section>
                )}
                {bijnaKlaar.length > 0 && (
                  <section>
                    <div className="flex items-baseline gap-3 mb-8">
                      <h2 className="text-[11px] font-bold uppercase tracking-[0.2em]">Bijna klaar</h2>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                    <Grid projects={bijnaKlaar} loading={false} emptyState={null} />
                  </section>
                )}
                {overigeProjecten.length > 0 && (
                  <section>
                    <div className="mb-8 flex items-baseline gap-3">
                      <h2 className="text-[11px] font-bold uppercase tracking-[0.2em]">Meer projecten</h2>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                    <Grid projects={overigeProjecten} loading={false} emptyState={null} />
                  </section>
                )}
              </div>
            )}
          </div>
        )}
        {tab === "mine" && user && (
          <div id="mine-panel" role="tabpanel" aria-labelledby="mine-tab">
            {mineError ? (
              <EmptyState icon={Hammer} title="Je projecten zijn even niet bereikbaar" description="Vernieuw de pagina om het nog eens te proberen." />
            ) : (
              <Grid
                projects={mine}
                loading={loadingM}
                emptyState={
                  <EmptyState
                    icon={Hammer}
                    title="Begin je eerste verbouwing"
                    description="Documenteer elke stap, deel updates en bewaar foto's voor later."
                    action={
                      <Button asChild variant="pill" size="pill">
                        <Link to="/trips/new"><Plus className="h-4 w-4" /> Nieuw project</Link>
                      </Button>
                    }
                  />
                }
              />
            )}
          </div>
        )}

        {!user && (
          <section className="mt-24 overflow-hidden rounded-2xl bg-foreground px-6 py-10 text-background sm:px-10 md:flex md:items-center md:justify-between md:gap-10 md:py-12" aria-labelledby="final-cta-title">
            <div className="max-w-2xl">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-background/55">Jouw verhaal begint hier</p>
              <h2 id="final-cta-title" className="mt-3 font-serif text-4xl italic leading-tight md:text-5xl">Vandaag één update. Straks een heel Bouwboek.</h2>
              <p className="mt-3 text-sm font-light leading-relaxed text-background/65">Start gratis en bepaal zelf wanneer je iets deelt.</p>
            </div>
            <Button asChild variant="pillAccent" size="pill" className="mt-7 w-full shrink-0 px-7 md:mt-0 md:w-auto">
              <Link to="/auth?mode=register&next=%2Ftrips%2Fnew">Maak je eerste project <ArrowRight className="h-4 w-4" /></Link>
            </Button>
          </section>
        )}

        <section className="mt-24 border-t border-border pt-16 grid gap-10 md:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="eyebrow mb-3">Verbouwingsdagboek</p>
            <h2 className="font-serif italic text-4xl md:text-5xl leading-tight">
              Van losse foto's naar een verhaal dat blijft.
            </h2>
          </div>
          <div className="space-y-5 text-sm md:text-base text-muted-foreground leading-relaxed font-light">
            <p>
              Buildy helpt je een verbouwing bijhouden zonder dat alles verdwijnt in WhatsApp, notities en fotomappen.
              Maak per fase een update, leg keuzes en mijlpalen vast en laat vrienden of familie meekijken.
            </p>
            <p>
              Of je nu een keuken, badkamer, aanbouw, zolder, boot, camper, auto of volledige renovatie documenteert: je bouwt automatisch aan
              een renovatiedagboek dat later geschikt is voor een fysiek fotoboek van je verbouwing.
            </p>
          </div>
        </section>
      </section>
    </div>
  );
};

export default Index;
