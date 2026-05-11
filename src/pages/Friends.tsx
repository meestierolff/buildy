import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Search, Users, Hammer } from "lucide-react";

interface ProfileResult {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  location: string | null;
  project_count: number;
}

const Friends = () => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProfileResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      let q = supabase
        .from("profiles")
        .select("user_id, display_name, avatar_url, bio, location")
        .order("display_name", { ascending: true })
        .limit(30);
      if (query.trim()) q = q.ilike("display_name", `%${query.trim()}%`);
      const { data } = await q;
      if (cancelled) return;

      const enriched = await Promise.all(
        (data || []).map(async (p: any) => {
          const { count } = await supabase
            .from("trips")
            .select("*", { count: "exact", head: true })
            .eq("user_id", p.user_id)
            .eq("is_public", true);
          return { ...p, project_count: count || 0 };
        })
      );
      if (!cancelled) {
        setResults(enriched);
        setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  return (
    <div className="container max-w-3xl py-10">
      <div className="flex items-center gap-2 mb-2">
        <Users className="h-5 w-5 text-accent" />
        <h1 className="text-2xl font-bold">Vrienden</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Zoek andere bouwers en bekijk hun projecten.
      </p>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Zoek op naam..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading && results.length === 0 ? (
        <p className="text-center text-muted-foreground py-10">Zoeken...</p>
      ) : results.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>Geen gebruikers gevonden.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {results.map((p) => (
            <Link key={p.user_id} to={`/profile/${p.user_id}`}>
              <Card className="hover:shadow-md hover:border-accent/40 transition-all">
                <CardContent className="p-4 flex items-center gap-3">
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={p.avatar_url ?? ""} />
                    <AvatarFallback className="bg-accent text-accent-foreground font-bold">
                      {p.display_name?.[0]?.toUpperCase() ?? "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold truncate">{p.display_name || "Naamloos"}</p>
                    {p.location && <p className="text-xs text-muted-foreground truncate">📍 {p.location}</p>}
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <Hammer className="h-3 w-3" /> {p.project_count} {p.project_count === 1 ? "project" : "projecten"}
                    </p>
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

export default Friends;
