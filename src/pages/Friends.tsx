import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Search, Users, Hammer, Loader2 } from "lucide-react";

interface ProfileResult {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  location: string | null;
  project_count: number;
}

const PAGE_SIZE = 20;
const MAX_RESULTS = 200;

const Friends = () => {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<ProfileResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const reqIdRef = useRef(0);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const fetchPage = useCallback(
    async (search: string, from: number, reqId: number): Promise<ProfileResult[]> => {
      let q = supabase
        .from("profiles")
        .select("user_id, display_name, avatar_url, bio, location")
        .eq("is_private", false)
        .order("display_name", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (search) q = q.ilike("display_name", `%${search}%`);
      const { data, error } = await q;
      if (error || !data || reqId !== reqIdRef.current) return [];

      const ids = data.map((p: any) => p.user_id);
      const counts: Record<string, number> = {};
      if (ids.length) {
        const { data: trips } = await supabase
          .from("trips")
          .select("user_id")
          .in("user_id", ids)
          .eq("is_public", true);
        (trips || []).forEach((t: any) => {
          counts[t.user_id] = (counts[t.user_id] || 0) + 1;
        });
      }
      if (reqId !== reqIdRef.current) return [];
      return data.map((p: any) => ({ ...p, project_count: counts[p.user_id] || 0 }));
    },
    []
  );

  // Initial / search-changed load
  useEffect(() => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setHasMore(true);
    (async () => {
      const page = await fetchPage(debounced, 0, reqId);
      if (reqId !== reqIdRef.current) return;
      setResults(page);
      setHasMore(page.length === PAGE_SIZE);
      setLoading(false);
    })();
  }, [debounced, fetchPage]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || results.length >= MAX_RESULTS) return;
    setLoadingMore(true);
    const reqId = reqIdRef.current;
    const page = await fetchPage(debounced, results.length, reqId);
    if (reqId !== reqIdRef.current) {
      setLoadingMore(false);
      return;
    }
    setResults((prev) => [...prev, ...page]);
    setHasMore(page.length === PAGE_SIZE && results.length + page.length < MAX_RESULTS);
    setLoadingMore(false);
  };

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

      {loading ? (
        <p className="text-center text-muted-foreground py-10 flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Zoeken...
        </p>
      ) : results.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>Geen gebruikers gevonden.</p>
        </div>
      ) : (
        <>
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
                      {p.location && (
                        <p className="text-xs text-muted-foreground truncate">📍 {p.location}</p>
                      )}
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                        <Hammer className="h-3 w-3" /> {p.project_count}{" "}
                        {p.project_count === 1 ? "project" : "projecten"}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <div className="mt-6 flex justify-center">
            {hasMore && results.length < MAX_RESULTS ? (
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Laden...
                  </>
                ) : (
                  "Meer laden"
                )}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                {results.length >= MAX_RESULTS
                  ? "Maximum bereikt — verfijn je zoekopdracht."
                  : "Alle resultaten geladen."}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default Friends;
