import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Hammer, Plus, Home, Heart } from "lucide-react";
import ProgressBar from "@/components/ProgressBar";

interface ProjectCard {
  id: string;
  title: string;
  project_type: string | null;
  address: string | null;
  progress_percentage: number | null;
  cover_image_url: string | null;
  user_id: string;
  is_public: boolean;
  profile?: { display_name: string };
  step_count: number;
  follower_count: number;
}

const ProjectGrid = ({ projects, loading, emptyText }: { projects: ProjectCard[]; loading: boolean; emptyText: string }) => {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <div className="h-48 bg-muted rounded-t-lg" />
            <CardContent className="p-4 space-y-2">
              <div className="h-5 bg-muted rounded w-3/4" />
              <div className="h-4 bg-muted rounded w-1/2" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
  if (projects.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Hammer className="h-12 w-12 mx-auto mb-4 opacity-40" />
        <p className="text-lg">{emptyText}</p>
      </div>
    );
  }
  return (
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
                <span className="flex items-center gap-1"><Heart className="h-3 w-3" /> {p.follower_count}</span>
              </div>
              {p.profile && <p className="text-xs text-muted-foreground">door {p.profile.display_name}</p>}
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
};

const Index = () => {
  const { user } = useAuth();
  const [discover, setDiscover] = useState<ProjectCard[]>([]);
  const [mine, setMine] = useState<ProjectCard[]>([]);
  const [loadingD, setLoadingD] = useState(true);
  const [loadingM, setLoadingM] = useState(true);

  const enrich = async (rows: any[]): Promise<ProjectCard[]> => {
    return Promise.all(
      rows.map(async (t: any) => {
        const [{ count: stepCount }, { count: followerCount }, { data: profile }] = await Promise.all([
          supabase.from("steps").select("*", { count: "exact", head: true }).eq("trip_id", t.id),
          supabase.from("favorites").select("*", { count: "exact", head: true }).eq("project_id", t.id),
          supabase.from("profiles").select("display_name").eq("user_id", t.user_id).single(),
        ]);
        return {
          ...t,
          profile: profile || undefined,
          step_count: stepCount || 0,
          follower_count: followerCount || 0,
        };
      })
    );
  };

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("trips")
        .select("*")
        .eq("is_public", true)
        .order("created_at", { ascending: false })
        .limit(20);
      if (data) setDiscover(await enrich(data));
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
      if (data) setMine(await enrich(data));
      setLoadingM(false);
    })();
  }, [user]);

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative overflow-hidden py-20 md:py-28">
        <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary/95 to-primary/85" />
        <div className="absolute inset-0 blueprint-grid opacity-15" />
        <div className="container relative text-center">
          <div className="flex justify-center mb-6">
            <div className="bg-accent rounded-2xl p-3 shadow-lg shadow-accent/30">
              <Hammer className="h-7 w-7 text-accent-foreground" />
            </div>
          </div>
          <h1 className="text-4xl md:text-6xl font-bold mb-4 tracking-tight text-primary-foreground">
            <span className="text-gradient-gold italic">Verbeter</span> je huis,<br className="hidden md:block" />
            stap voor stap.
          </h1>
          <p className="text-lg md:text-xl text-primary-foreground/80 max-w-2xl mx-auto mb-8">
            Leg elke fase van je verbouwing vast met foto's en verhalen. Druk een fotoboek af voor later.
          </p>
          {user ? (
            <Link to="/trips/new">
              <Button size="lg" className="gap-2 text-base bg-accent text-accent-foreground hover:bg-accent/90 shadow-lg shadow-accent/30">
                <Plus className="h-5 w-5" /> Start een nieuw project
              </Button>
            </Link>
          ) : (
            <Link to="/auth">
              <Button size="lg" className="gap-2 text-base bg-accent text-accent-foreground hover:bg-accent/90 shadow-lg shadow-accent/30">
                <Hammer className="h-5 w-5" /> Aan de slag
              </Button>
            </Link>
          )}
        </div>
      </section>

      {/* Tabs */}
      <section className="container py-12">
        <Tabs defaultValue={user ? "mine" : "discover"} className="w-full">
          <TabsList className="mb-8">
            <TabsTrigger value="discover">Ontdekken</TabsTrigger>
            {user && <TabsTrigger value="mine">Mijn projecten</TabsTrigger>}
          </TabsList>
          <TabsContent value="discover">
            <ProjectGrid projects={discover} loading={loadingD} emptyText="Nog geen publieke projecten." />
          </TabsContent>
          {user && (
            <TabsContent value="mine">
              {mine.length === 0 && !loadingM ? (
                <div className="text-center py-16 text-muted-foreground">
                  <Home className="h-12 w-12 mx-auto mb-4 opacity-40" />
                  <p className="text-lg mb-4">Je hebt nog geen projecten.</p>
                  <Link to="/trips/new">
                    <Button className="bg-accent text-accent-foreground hover:bg-accent/90">
                      <Plus className="h-4 w-4 mr-1" /> Maak je eerste project
                    </Button>
                  </Link>
                </div>
              ) : (
                <ProjectGrid projects={mine} loading={loadingM} emptyText="Geen projecten." />
              )}
            </TabsContent>
          )}
        </Tabs>
      </section>
    </div>
  );
};

export default Index;
