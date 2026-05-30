import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Plus, Home, Hammer, Search, X } from "lucide-react";
import EmptyState from "@/components/EmptyState";

interface ProjectCard {
  id: string;
  title: string;
  project_type: string | null;
  progress_percentage: number | null;
  cover_image_url: string | null;
  user_id: string;
  is_public: boolean;
  profile_name?: string;
  step_count: number;
  follower_count: number;
}

const Card = ({ p }: { p: ProjectCard }) => {
  const pct = Math.max(0, Math.min(100, p.progress_percentage ?? 0));
  return (
    <Link to={`/trip/${p.id}`} className="group block">
      <div className="relative aspect-[4/5] overflow-hidden rounded-sm bg-muted mb-5">
        {p.cover_image_url ? (
          <img
            src={p.cover_image_url}
            alt={p.title}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center blueprint-grid">
            <Home className="h-12 w-12 text-muted-foreground/40" strokeWidth={1.5} />
          </div>
        )}
        {p.project_type && (
          <div className="absolute top-5 left-5">
            <span className="bg-background/95 backdrop-blur-md px-3 py-1.5 rounded-sm text-[9px] font-bold uppercase tracking-[0.2em] text-foreground shadow-sm">
              {p.project_type}
            </span>
          </div>
        )}
      </div>
      <div className="space-y-3">
        <div className="flex justify-between items-baseline gap-3">
          <h3 className="font-serif italic text-2xl leading-tight truncate">{p.title}</h3>
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest tabular-nums shrink-0">{pct}%</span>
        </div>
        <div className="space-y-2">
          <div className="w-full h-0.5 bg-muted">
            <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-muted-foreground font-medium">
            {p.profile_name ? `door ${p.profile_name}` : ""}
          </span>
          <span className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground">
            {p.step_count} updates
          </span>
        </div>
      </div>
    </Link>
  );
};

const Grid = ({ projects, loading, emptyState }: { projects: ProjectCard[]; loading: boolean; emptyState: React.ReactNode }) => {
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
      {projects.map((p) => <Card key={p.id} p={p} />)}
    </div>
  );
};

const enrich = async (rows: any[]): Promise<ProjectCard[]> => {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));

  const [stepsRes, favRes, profRes] = await Promise.all([
    supabase.from("steps").select("trip_id").in("trip_id", ids),
    supabase.from("favorites").select("project_id").in("project_id", ids),
    supabase.from("profiles").select("user_id, display_name").in("user_id", userIds),
  ]);

  const stepCounts = new Map<string, number>();
  (stepsRes.data || []).forEach((s: any) => stepCounts.set(s.trip_id, (stepCounts.get(s.trip_id) || 0) + 1));
  const favCounts = new Map<string, number>();
  (favRes.data || []).forEach((f: any) => favCounts.set(f.project_id, (favCounts.get(f.project_id) || 0) + 1));
  const profMap = new Map<string, string>();
  (profRes.data || []).forEach((p: any) => profMap.set(p.user_id, p.display_name));

  // Trip visibility is controlled by trips.is_public — profiles stay publicly findable
  return rows
    .map((t: any) => ({
      ...t,
      step_count: stepCounts.get(t.id) || 0,
      follower_count: favCounts.get(t.id) || 0,
      profile_name: profMap.get(t.user_id) || undefined,
    }));
};

const Index = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState<"discover" | "mine">(user ? "mine" : "discover");
  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [discover, setDiscover] = useState<ProjectCard[]>([]);
  const [mine, setMine] = useState<ProjectCard[]>([]);
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
          Leg elke fase van je verbouwing vast met foto's en verhalen.{" "}<br className="hidden md:block" />
          Een digitaal dagboek voor de architectuur van je leven.
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
      </section>
    </div>
  );
};

export default Index;
