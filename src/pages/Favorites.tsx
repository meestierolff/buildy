import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Heart, Home, Flag } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { formatDistanceToNow } from "date-fns";
import { nl } from "date-fns/locale";
import { phaseColor } from "@/components/PhaseSelect";
import ProjectCard from "@/components/ProjectCard";
import { applyProjectMediaSummaries, loadProjectMediaSummaries } from "@/lib/projectMedia";
import { hydrateStepsMedia } from "@/lib/mediaUrl";
import { usePageMeta } from "@/hooks/usePageMeta";

const Favorites = () => {
  const { user, loading: authLoading } = useAuth();
  usePageMeta({
    title: "Gevolgde projecten — Buildy",
    description: "Bekijk updates van renovatieprojecten die je volgt.",
    path: "/favorieten",
    noIndex: true,
  });
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
        const userIds = Array.from(new Set(trips.map((t: any) => t.user_id)));
        const [mediaSummaries, { data: profiles }] = await Promise.all([
          loadProjectMediaSummaries(ids),
          supabase.rpc("get_profiles_basic", { _ids: userIds }),
        ]);
        const profileById = new Map((profiles || []).map((p: any) => [p.user_id, p]));
        setProjects(
          applyProjectMediaSummaries(trips, mediaSummaries).map((t: any) => ({
            ...t,
            profile: profileById.get(t.user_id),
          })),
        );
      }

      // Activity feed: latest steps from followed projects
      const { data: recent } = await supabase
        .from("steps")
        .select("id, location_name, description, step_date, trip_id, created_at, phase, is_milestone, step_media(media_url, storage_path, media_type, sort_order)")
        .in("trip_id", ids)
        .order("created_at", { ascending: false })
        .limit(20);
      if (recent) {
        await hydrateStepsMedia(recent as any);
        const tMap = new Map((trips || []).map((t: any) => [t.id, t]));
        setActivity(recent.map((s: any) => ({ ...s, trip: tMap.get(s.trip_id) })));
      }
      setLoading(false);
    })();
  }, [user]);

  if (authLoading) return <div className="min-h-screen bg-background" />;
  if (!user) return <Navigate to="/auth" replace />;

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
              <p className="text-muted-foreground text-sm">Nog geen updates van gevolgde projecten.</p>
            ) : (
              <div className="max-w-lg divide-y divide-border/50 rounded-xl overflow-hidden border border-border/60">
                {activity.map((s: any) => {
                  const firstPhoto = [...(s.step_media || [])]
                    .filter((m: any) => m.media_type !== "pdf" && m.media_type !== "video")
                    .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0]?.media_url;
                  return (
                    <Link key={s.id} to={`/trip/${s.trip_id}`} className="block hover:bg-muted/40 transition-colors bg-card">
                      {/* project name header */}
                      <div className="px-4 pt-3 pb-1 flex items-center gap-2">
                        <Home className="h-3 w-3 text-accent shrink-0" />
                        <span className="text-[11px] font-semibold text-accent truncate">{s.trip?.title}</span>
                        <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                          {formatDistanceToNow(new Date(s.created_at), { addSuffix: true, locale: nl })}
                        </span>
                      </div>

                      {/* photo */}
                      {firstPhoto && (
                        <div className="w-full" style={{ aspectRatio: "4/3" }}>
                          <img src={firstPhoto} alt="" loading="lazy" className="w-full h-full object-cover" />
                        </div>
                      )}

                      {/* meta + text */}
                      <div className="px-4 pt-2 pb-3 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {s.phase && (
                            <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${phaseColor(s.phase)}`}>
                              {s.phase}
                            </span>
                          )}
                          {s.is_milestone && (
                            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-accent/15 text-accent flex items-center gap-0.5">
                              <Flag className="h-2.5 w-2.5" /> Mijlpaal
                            </span>
                          )}
                        </div>
                        <p className="font-bold text-sm leading-tight">{s.location_name}</p>
                        {s.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2">{s.description}</p>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="projects">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12">
              {projects.map((p) => {
                return (
                  <ProjectCard
                    key={p.id}
                    id={p.id}
                    title={p.title}
                    projectType={p.project_type}
                    progressPercentage={p.progress_percentage}
                    coverUrl={p.cover_image_url}
                    coverMediaType={p.cover_media_type}
                    profileName={p.profile?.display_name}
                    stepCount={p.step_count}
                  />
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
