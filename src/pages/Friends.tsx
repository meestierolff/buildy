import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Search, Users, Hammer, Loader2, UserPlus, UserCheck } from "lucide-react";
import { toast } from "sonner";

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
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<ProfileResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Load who I already follow
  useEffect(() => {
    if (!user) return;
    supabase
      .from("user_follows")
      .select("following_id")
      .eq("follower_id", user.id)
      .then(({ data }) => {
        setFollowing(new Set((data || []).map((r: any) => r.following_id)));
      });
  }, [user]);

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

      const ids = data.map((p: any) => p.user_id).filter((uid: string) => uid !== user?.id);
      const filtered = data.filter((p: any) => p.user_id !== user?.id);
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
      return filtered.map((p: any) => ({ ...p, project_count: counts[p.user_id] || 0 }));
    },
    [user]
  );

  useEffect(() => {
    if (!debounced) {
      setResults([]);
      setLoading(false);
      setHasMore(false);
      return;
    }
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

  const toggleFollow = async (uid: string) => {
    if (!user) {
      toast.error("Log in om te volgen");
      return;
    }
    setBusyId(uid);
    if (following.has(uid)) {
      const { error } = await supabase
        .from("user_follows")
        .delete()
        .eq("follower_id", user.id)
        .eq("following_id", uid);
      if (!error) {
        setFollowing((prev) => {
          const n = new Set(prev);
          n.delete(uid);
          return n;
        });
      } else toast.error("Kon niet ontvolgen");
    } else {
      const { error } = await supabase
        .from("user_follows")
        .insert({ follower_id: user.id, following_id: uid });
      if (!error) {
        setFollowing((prev) => new Set(prev).add(uid));
      } else toast.error("Kon niet volgen");
    }
    setBusyId(null);
  };

  return (
    <div className="container max-w-3xl py-10">
      <div className="flex items-center gap-2 mb-2">
        <Users className="h-5 w-5 text-accent" />
        <h1 className="text-2xl font-bold">Ontdek bouwers</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Zoek andere bouwers op naam en volg hun projecten.
      </p>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Zoek op naam..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
          autoFocus
        />
      </div>

      {!debounced ? (
        <div className="text-center py-16 text-muted-foreground">
          <Search className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>Typ een naam om bouwers te vinden.</p>
        </div>
      ) : loading ? (
        <p className="text-center text-muted-foreground py-10 flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Zoeken...
        </p>
      ) : results.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>Geen gebruikers gevonden voor "{debounced}".</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {results.map((p) => {
              const isFollowing = following.has(p.user_id);
              return (
                <Card key={p.user_id} className="hover:shadow-md hover:border-accent/40 transition-all">
                  <CardContent className="p-4 flex items-center gap-3">
                    <Link to={`/profile/${p.user_id}`} className="flex items-center gap-3 min-w-0 flex-1">
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
                    </Link>
                    {user && (
                      <Button
                        size="sm"
                        variant={isFollowing ? "outline" : "default"}
                        onClick={() => toggleFollow(p.user_id)}
                        disabled={busyId === p.user_id}
                        className={isFollowing ? "" : "bg-accent text-accent-foreground hover:bg-accent/90"}
                      >
                        {isFollowing ? (
                          <><UserCheck className="h-3.5 w-3.5 mr-1" /> Volgend</>
                        ) : (
                          <><UserPlus className="h-3.5 w-3.5 mr-1" /> Volg</>
                        )}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="mt-6 flex justify-center">
            {hasMore && results.length < MAX_RESULTS ? (
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Laden...</>
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
