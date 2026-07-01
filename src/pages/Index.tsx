import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Plus, Home, Hammer, Search, X, BookOpen, ArrowRight } from "lucide-react";
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
  profile_name?: string;
  step_count: number;
  follower_count: number;
}

const Grid = ({ projects, loading, emptyState }: { projects: Project[]; loading: boolean; emptyState: React.ReactNode }) => {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse">
            <div className="aspect-[4/5] bg-muted rounded-sm mb-5" />
            <div className="h-5 bg-muted rounded w-3/4 mb-3" />
            <div className="h-3 bg-muted rounded w-1/2" />
          </div>
        ))}
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

const enrich = async (rows: any[]): Promise<Project[]> => {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));

  const [mediaSummaries, favRes, profRes] = await Promise.all([
    loadProjectMediaSummaries(ids),
    supabase.from("favorites").select("project_id").in("project_id", ids),
    supabase.rpc("get_profiles_basic", { _ids: userIds }),
  ]);

  const favCounts = new Map<string, number>();
  (favRes.data || []).forEach((f: any) => favCounts.set(f.project_id, (favCounts.get(f.project_id) || 0) + 1));
  const profMap = new Map<string, string>();
  (profRes.data || []).forEach((p: any) => profMap.set(p.user_id, p.display_name));

  // Trip visibility is controlled by trips.is_public — profiles stay publicly findable
  return applyProjectMediaSummaries(rows, mediaSummaries)
    .map((t: any) => ({
      ...t,
      follower_count: favCounts.get(t.id) || 0,
      profile_name: profMap.get(t.user_id) || undefined,
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

  useEffect(() => { setTab(user ? "mine" : "discover"); }, [user]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("trips")
        .select("*")
        .eq("is_public", true)
        .order("created_at", { ascending: false })
        .limit(40);
      setDiscover(await enrich(data || []));
      setLoadingD(false);
    })();
  }, []);

  useEffect(() => {
    if (!user) { setLoadingM(false); return; }
    (async () => {
      const { data } = await supabase
        .from("trips")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      setMine(await enrich(data || []));
      setLoadingM(false);
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

  const netBegonnen = filtered.filter((p) => p.step_count === 0 || (p as any).created_at > twoWeeksAgo).slice(0, 6);
  const bijnaKlaar = filtered.filter((p) => (p.progress_percentage ?? 0) >= 70 && (p.progress_percentage ?? 0) < 100).slice(0, 6);
  const trending = [...filtered].sort((a, b) => b.follower_count - a.follower_count).slice(0, 6);

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <header className="max-w-5xl mx-auto px-6 md:px-8 py-20 md:py-32 text-center">
        <h1 className="text-5xl md:text-7xl lg:text-8xl font-serif italic leading-[0.9] mb-8 tracking-tight">
          Verbeter je huis,<br />
          <span className="text-accent">stap voor stap.</span>
        </h1>
        <p className="max-w-xl mx-auto text-base md:text-lg text-muted-foreground leading-relaxed mb-10 font-light">
          Houd updates, foto's, mijlpalen en budget bij op een plek.{" "}<br className="hidden md:block" />
          Aan het einde maak je er automatisch een gedrukt Bouwboek van.
        </p>
        {user ? (
          <Link to="/trips/new">
            <Button size="lg" className="rounded-full px-8 py-6 text-[11px] font-bold uppercase tracking-[0.15em] bg-foreground text-background hover:bg-foreground/90 shadow-sm gap-2">
              <Plus className="h-4 w-4" /> Start een nieuw project
            </Button>
          </Link>
        ) : (
          <Link to="/auth">
            <Button size="lg" className="rounded-full px-8 py-6 text-[11px] font-bold uppercase tracking-[0.15em] bg-foreground text-background hover:bg-foreground/90 shadow-sm">
              Aan de slag
            </Button>
          </Link>
        )}
      </header>

      {/* Bouwboek teaser — laat het eindresultaat zien */}
      <section className="max-w-6xl mx-auto px-6 md:px-8 pb-20">
        <div className="grid md:grid-cols-2 gap-12 lg:gap-20 items-center">
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
            <Link to={user ? "/trips/new" : "/auth"}>
              <Button size="lg" className="rounded-full px-7 text-[11px] font-bold uppercase tracking-[0.15em] bg-accent text-accent-foreground hover:bg-accent/90 gap-2">
                <BookOpen className="h-4 w-4" /> Bekijk hoe het werkt <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>

          {/* Boek-mockup */}
          <div className="relative perspective-[1400px]">
            <div className="relative mx-auto w-full max-w-md group">
              {/* Schaduw onder boek */}
              <div className="absolute -bottom-6 left-6 right-6 h-6 bg-foreground/20 blur-2xl rounded-full" />

              {/* Boek */}
              <div
                className="relative aspect-[4/5] rounded-r-sm rounded-l-md shadow-2xl overflow-hidden bg-card border border-border/60 transition-transform duration-500 group-hover:-rotate-y-2"
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
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent mb-1">Bouwboek</p>
                    <p className="font-serif italic text-xl leading-tight text-foreground">Onze verbouwing — 2026</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-2">42 updates · 168 foto's</p>
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
      <section className="max-w-7xl mx-auto px-6 md:px-8 pb-24">
        <div className="flex items-center gap-10 mb-12 border-b border-border">
          <button
            onClick={() => setTab("discover")}
            className={`text-[11px] font-bold uppercase tracking-[0.2em] relative py-4 transition-colors ${
              tab === "discover" ? "text-foreground" : "text-muted-foreground/60 hover:text-muted-foreground"
            }`}
          >
            Ontdekken
            {tab === "discover" && <span className="absolute bottom-0 left-0 w-full h-0.5 bg-foreground" />}
          </button>
          {user && (
            <button
              onClick={() => setTab("mine")}
              className={`text-[11px] font-bold uppercase tracking-[0.2em] relative py-4 transition-colors ${
                tab === "mine" ? "text-foreground" : "text-muted-foreground/60 hover:text-muted-foreground"
              }`}
            >
              Mijn projecten
              {tab === "mine" && <span className="absolute bottom-0 left-0 w-full h-0.5 bg-foreground" />}
            </button>
          )}
        </div>

        {tab === "discover" && (
          <div>
            {/* Search + type filter */}
            <div className="flex flex-col sm:flex-row gap-3 mb-10">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Zoek project of persoon…"
                  className="w-full h-10 pl-9 pr-9 rounded-sm border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {activeTypes.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {activeTypes.map((t) => (
                    <button
                      key={t}
                      onClick={() => setSelectedType(selectedType === t ? "" : t)}
                      className={`px-3 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-[0.15em] border transition-colors ${
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
                <section>
                  <div className="flex items-baseline gap-3 mb-8">
                    <h2 className="text-[11px] font-bold uppercase tracking-[0.2em]">Alle projecten</h2>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                  <Grid projects={filtered} loading={false} emptyState={null} />
                </section>
              </div>
            )}
          </div>
        )}
        {tab === "mine" && user && (
          <Grid
            projects={mine}
            loading={loadingM}
            emptyState={
              <EmptyState
                icon={Hammer}
                title="Begin je eerste verbouwing"
                description="Documenteer elke stap, deel updates en bewaar foto's voor later."
                action={
                  <Link to="/trips/new">
                    <Button className="rounded-full px-6 text-[11px] font-bold uppercase tracking-widest bg-foreground text-background hover:bg-foreground/90 gap-2">
                      <Plus className="h-4 w-4" /> Nieuw project
                    </Button>
                  </Link>
                }
              />
            }
          />
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

      {/* Footer */}
      <footer className="border-t border-border mt-16 bg-muted/30">
        <div className="container py-8 max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-serif italic text-xl font-bold">Buildy</span>
            <span className="text-muted-foreground text-xs">© {new Date().getFullYear()}</span>
          </div>
          <div className="flex items-center gap-6 text-sm font-medium">
            <a href="https://www.instagram.com/buildy.log/" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/></svg>
              Instagram
            </a>
            <Link to="/privacy" className="text-muted-foreground hover:text-foreground transition-colors">Privacy</Link>
            <Link to="/voorwaarden" className="text-muted-foreground hover:text-foreground transition-colors">Voorwaarden</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
