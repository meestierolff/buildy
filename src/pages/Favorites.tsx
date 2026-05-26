import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Heart, Hammer, Home, Flag } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { formatDistanceToNow } from "date-fns";
import { nl } from "date-fns/locale";
import { phaseColor } from "@/components/PhaseSelect";

const Favorites = () => {
  const { user } = useAuth();
  const [projects, setProjects] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    (async () => {
      const { data: follows } = await supabase
        .from("follows")
        .select("project_id")
        .eq("user_id", user.id);

      if (!follows || follows.length === 0) {
        setProjects([]);
        setActivity([]);
        setLoading(false);
        return;
      }

      const ids = follows.map((f) => f.project_id);
      const { data: trips } = await supabase
        .from("trips")
        .select("*")
        .in("id", ids);

      if (trips) {
        const enriched = await Promise.all(
          trips.map(async (t: any) => {
            const [{ count: stepCount }, { data: profile }] = await Promise.all([
              supabase.from("steps").select("*", { count: "exact", head: true }).eq("trip_id", t.id),
              supabase.from("profiles").select("display_name").eq("user_id", t.user_id).single(),
            ]);
            return { ...t, step_count: stepCount || 0, profile };
          })
        );
        setProjects(enriched);
      }

      // Activity feed: latest steps from followed projects
      const { data: recent } = await supabase
        .from("steps")
        .select("id, location_name, description, step_date, trip_id, created_at, phase, is_milestone, step_media(media_url)")
        .in("trip_id", ids)
        .order("created_at", { ascending: false })
        .limit(20);
      if (recent) {
        const tMap = new Map((trips || []).map((t: any) => [t.id, t]));
        setActivity(recent.map((s: any) => ({ ...s, trip: tMap.get(s.trip_id) })));
      }
      setLoading(false);
    })();
  }, [user]);

  if (!user) {
    return (
      <div className="container py-20 text-center">
        <p className="text-muted-foreground">Log in om je gevolgde projecten te bekijken.</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 md:px-8 py-16">
      <div className="mb-12">
        <p className="eyebrow mb-2">Jouw feed</p>
        <h1 className="font-serif italic text-4xl md:text-5xl">Gevolgd</h1>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">Laden…</p>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="Nog niks gevolgd"
          description="Ontdek projecten op de homepage en klik op 'Volgen' om updates hier terug te zien."
        />
      ) : (
        <Tabs defaultValue="feed">
          <TabsList className="mb-8 bg-transparent border-b border-border rounded-none p-0 h-auto gap-8">
            <TabsTrigger value="feed" className="text-[11px] font-bold uppercase tracking-[0.2em] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground text-muted-foreground/60 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground pb-3 px-0">Recent</TabsTrigger>
            <TabsTrigger value="projects" className="text-[11px] font-bold uppercase tracking-[0.2em] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground text-muted-foreground/60 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground pb-3 px-0">Projecten ({projects.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="feed">
            {activity.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nog geen updates.</p>
            ) : (
              <div className="space-y-3 max-w-2xl">
                {activity.map((s: any) => (
                  <Link key={s.id} to={`/trip/${s.trip_id}`}>
                    <Card className="hover:bg-muted/40 transition-colors border border-border shadow-none rounded-sm">
                      <CardContent className="p-4 flex gap-4">
                        {s.step_media?.[0] ? (
                          <img src={s.step_media[0].media_url} alt="" loading="lazy" className="h-20 w-20 object-cover rounded-sm shrink-0" />
                        ) : (
                          <div className="h-20 w-20 bg-muted rounded-sm flex items-center justify-center shrink-0">
                            <Hammer className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-0.5">
                            {s.trip?.title}
                          </p>
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <p className="font-serif italic text-lg leading-tight line-clamp-1">{s.location_name}</p>
                            {s.is_milestone && (
                              <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-sm bg-accent/15 text-accent flex items-center gap-0.5 shrink-0">
                                <Flag className="h-2.5 w-2.5" /> Mijlpaal
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {s.phase && (
                              <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-sm ${phaseColor(s.phase)}`}>
                                {s.phase}
                              </span>
                            )}
                            <span className="text-[10px] text-muted-foreground">
                              {formatDistanceToNow(new Date(s.created_at), { addSuffix: true, locale: nl })}
                            </span>
                          </div>
                          {s.description && <p className="text-sm text-muted-foreground line-clamp-2 mt-1.5">{s.description}</p>}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="projects">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12">
              {projects.map((p) => {
                const pct = Math.max(0, Math.min(100, p.progress_percentage ?? 0));
                return (
                  <Link key={p.id} to={`/trip/${p.id}`} className="group block">
                    <div className="relative aspect-[4/5] overflow-hidden rounded-sm bg-muted mb-5">
                      {p.cover_image_url ? (
                        <img src={p.cover_image_url} alt={p.title} loading="lazy" className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105" />
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
                      <div className="w-full h-0.5 bg-muted">
                        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[11px] text-muted-foreground">{p.profile?.display_name && `door ${p.profile.display_name}`}</span>
                        <span className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground">{p.step_count} updates</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
};

export default Favorites;
