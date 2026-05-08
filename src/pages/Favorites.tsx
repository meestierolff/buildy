import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Heart, Hammer, Home, Activity } from "lucide-react";
import ProgressBar from "@/components/ProgressBar";
import { formatDistanceToNow } from "date-fns";
import { nl } from "date-fns/locale";

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
        .select("id, location_name, description, step_date, trip_id, created_at, step_media(media_url)")
        .in("trip_id", ids)
        .order("created_at", { ascending: false })
        .limit(15);
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
    <div className="container py-12">
      <div className="flex items-center gap-3 mb-6">
        <Heart className="h-7 w-7 text-accent" />
        <h1 className="text-3xl font-bold">Gevolgd</h1>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Laden...</p>
      ) : projects.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Heart className="h-12 w-12 mx-auto mb-4 opacity-40" />
          <p>Je volgt nog geen projecten. Ontdek projecten op de homepage en klik op 'Volgen'.</p>
        </div>
      ) : (
        <Tabs defaultValue="feed">
          <TabsList className="mb-6">
            <TabsTrigger value="feed" className="gap-1.5"><Activity className="h-3.5 w-3.5" /> Recent</TabsTrigger>
            <TabsTrigger value="projects" className="gap-1.5"><Home className="h-3.5 w-3.5" /> Projecten ({projects.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="feed">
            {activity.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nog geen updates.</p>
            ) : (
              <div className="space-y-3 max-w-2xl">
                {activity.map((s: any) => (
                  <Link key={s.id} to={`/trip/${s.trip_id}`}>
                    <Card className="hover:shadow-md transition-shadow border-2 hover:border-accent/40">
                      <CardContent className="p-4 flex gap-3">
                        {s.step_media?.[0] ? (
                          <img src={s.step_media[0].media_url} alt="" className="h-16 w-16 object-cover rounded-lg shrink-0" />
                        ) : (
                          <div className="h-16 w-16 bg-muted rounded-lg flex items-center justify-center shrink-0">
                            <Hammer className="h-5 w-5 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-muted-foreground">
                            {s.trip?.title} · {formatDistanceToNow(new Date(s.created_at), { addSuffix: true, locale: nl })}
                          </p>
                          <p className="font-semibold text-sm leading-tight mt-0.5 line-clamp-1">{s.location_name}</p>
                          {s.description && <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{s.description}</p>}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="projects">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {projects.map((p) => (
                <Link key={p.id} to={`/trip/${p.id}`}>
                  <Card className="overflow-hidden hover:shadow-xl transition-all group cursor-pointer border-2 border-border hover:border-accent/40 h-full">
                    <div className="h-44 bg-gradient-to-br from-primary/20 to-accent/20 relative overflow-hidden">
                      {p.cover_image_url ? (
                        <img src={p.cover_image_url} alt={p.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center blueprint-grid">
                          <Home className="h-12 w-12 text-primary/40" />
                        </div>
                      )}
                      {p.project_type && (
                        <span className="absolute top-2 left-2 bg-accent text-accent-foreground text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full">
                          {p.project_type}
                        </span>
                      )}
                    </div>
                    <CardContent className="p-4 space-y-2">
                      <h3 className="font-bold text-lg font-sans leading-tight line-clamp-1">{p.title}</h3>
                      {p.address && <p className="text-xs text-muted-foreground line-clamp-1">📍 {p.address}</p>}
                      <ProgressBar value={p.progress_percentage ?? 0} showLabel={false} size="sm" />
                      <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                        <span className="flex items-center gap-1"><Hammer className="h-3 w-3" /> {p.step_count} updates</span>
                        {p.profile && <span>door {p.profile.display_name}</span>}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
};

export default Favorites;
