import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Heart, Hammer, Home } from "lucide-react";
import ProgressBar from "@/components/ProgressBar";

const Favorites = () => {
  const { user } = useAuth();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    (async () => {
      const { data: favs } = await supabase
        .from("favorites")
        .select("project_id")
        .eq("user_id", user.id);

      if (!favs || favs.length === 0) {
        setProjects([]);
        setLoading(false);
        return;
      }

      const ids = favs.map((f) => f.project_id);
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
      <div className="flex items-center gap-3 mb-8">
        <Heart className="h-7 w-7 text-accent" />
        <h1 className="text-3xl font-bold">Gevolgde projecten</h1>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Laden...</p>
      ) : projects.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Heart className="h-12 w-12 mx-auto mb-4 opacity-40" />
          <p>Je volgt nog geen projecten. Ontdek projecten op de homepage en klik op 'Volgen'.</p>
        </div>
      ) : (
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
      )}
    </div>
  );
};

export default Favorites;
