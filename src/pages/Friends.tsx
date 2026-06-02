import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Search, Users, Loader2, UserPlus, UserCheck, MapPin, Hammer } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { toast } from "sonner";
import { usePageMeta } from "@/hooks/usePageMeta";

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
  usePageMeta({
    title: "Vrienden ontdekken — Buildy",
    description: "Ontdek andere bouwers, volg renovatieprojecten en krijg inspiratie voor je eigen verbouwing.",
    path: "/vrienden",
  });
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<ProfileResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [followedProfiles, setFollowedProfiles] = useState<ProfileResult[]>([]);
  const [loadingFollowed, setLoadingFollowed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!user) return;
    setLoadingFollowed(true);
    (async () => {
      const { data } = await supabase.from("user_follows").select("following_id").eq("follower_id", user.id);
      const ids = (data || []).map((r: any) => r.following_id);
      setFollowing(new Set(ids));
      if (ids.length === 0) { setFollowedProfiles([]); setLoadingFollowed(false); return; }
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name, avatar_url, bio, location")
        .in("user_id", ids)
        .order("display_name", { ascending: true });
      if (profiles) {
        const { data: trips } = await supabase.from("trips").select("user_id").in("user_id", ids).eq("is_public", true);
        const counts: Record<string, number> = {};
        (trips || []).forEach((t: any) => { counts[t.user_id] = (counts[t.user_id] || 0) + 1; });
        setFollowedProfiles(profiles.map((p: any) => ({ ...p, project_count: counts[p.user_id] || 0 })));
      }
      setLoadingFollowed(false);
    })();
  }, [user]);

  const fetchPage = useCallback(async (search: string, from: number, reqId: number): Promise<ProfileResult[]> => {
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
      const { data: trips } = await supabase.from("trips").select("user_id").in("user_id", ids).eq("is_public", true);
      (trips || []).forEach((t: any) => { counts[t.user_id] = (counts[t.user_id] || 0) + 1; });
    }
    if (reqId !== reqIdRef.current) return [];
    return filtered.map((p: any) => ({ ...p, project_count: counts[p.user_id] || 0 }));
  }, [user]);

  useEffect(() => {
    if (!debounced) { setResults([]); setLoading(false); setHasMore(false); return; }
    const reqId = ++reqIdRef.current;
    setLoading(true); setHasMore(true);
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
    if (reqId !== reqIdRef.current) { setLoadingMore(false); return; }
    setResults((prev) => [...prev, ...page]);
    setHasMore(page.length === PAGE_SIZE && results.length + page.length < MAX_RESULTS);
    setLoadingMore(false);
  };

  const toggleFollow = async (uid: string) => {
    if (!user) { toast.error("Log in om te volgen"); return; }
    setBusyId(uid);
    if (following.has(uid)) {
      const { error } = await supabase.from("user_follows").delete().eq("follower_id", user.id).eq("following_id", uid);
      if (!error) {
        setFollowing((prev) => { const n = new Set(prev); n.delete(uid); return n; });
        setFollowedProfiles((prev) => prev.filter((p) => p.user_id !== uid));
      } else toast.error("Kon niet ontvolgen");
    } else {
      const { error } = await supabase.from("user_follows").insert({ follower_id: user.id, following_id: uid });
      if (!error) {
        setFollowing((prev) => new Set(prev).add(uid));
        const profile = results.find((p) => p.user_id === uid);
        if (profile) {
          setFollowedProfiles((prev) => [...prev, profile].sort((a, b) => (a.display_name || "").localeCompare(b.display_name || "")));
        }
      } else toast.error("Kon niet volgen");
    }
    setBusyId(null);
  };

  const Row = ({ p, isFollowing }: { p: ProfileResult; isFollowing: boolean }) => (
    <div className="flex items-center gap-4 py-5 border-b border-border last:border-b-0 group">
      <Link to={`/profile/${p.user_id}`} className="flex items-center gap-4 min-w-0 flex-1">
        <Avatar className="h-12 w-12 shrink-0">
          <AvatarImage src={p.avatar_url ?? ""} />
          <AvatarFallback className="bg-muted text-foreground font-semibold text-sm">
            {p.display_name?.[0]?.toUpperCase() ?? "?"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="font-serif italic text-xl leading-tight truncate group-hover:text-accent transition-colors">
            {p.display_name || "Naamloos"}
          </p>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1 font-medium">
            {p.location && (
              <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{p.location}</span>
            )}
            <span className="flex items-center gap-1"><Hammer className="h-3 w-3" />{p.project_count} {p.project_count === 1 ? "project" : "projecten"}</span>
          </div>
        </div>
      </Link>
      {user && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => toggleFollow(p.user_id)}
          disabled={busyId === p.user_id}
          className={`rounded-full px-4 text-[10px] font-bold uppercase tracking-widest border-border ${isFollowing ? "bg-foreground text-background hover:bg-foreground/90 border-foreground" : ""}`}
        >
          {isFollowing ? <><UserCheck className="h-3 w-3 mr-1" />Volgend</> : <><UserPlus className="h-3 w-3 mr-1" />Volg</>}
        </Button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 md:px-8 py-12 md:py-20">
        <div className="mb-12">
          <p className="eyebrow mb-3">Vrienden</p>
          <h1 className="font-serif italic text-4xl md:text-5xl leading-tight">Ontdek andere bouwers.</h1>
          <p className="text-sm text-muted-foreground mt-4 font-light max-w-md">
            Zoek bouwers op naam en volg hun projecten om updates in je feed te zien.
          </p>
        </div>

        <div className="relative mb-10">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Zoek op naam…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-11 h-12 rounded-full border-border"
          />
        </div>

        {!debounced ? (
          loadingFollowed ? (
            <p className="text-center text-muted-foreground py-10 flex items-center justify-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Laden…
            </p>
          ) : followedProfiles.length > 0 ? (
            <div>
              <div className="flex items-baseline gap-3 mb-2">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.2em]">Je volgt ({followedProfiles.length})</h2>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div>
                {followedProfiles.map((p) => <Row key={p.user_id} p={p} isFollowing={true} />)}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={Users}
              title="Volg je eerste bouwer"
              description="Zoek hierboven op naam om andere bouwers te ontdekken en hun verbouwingen te volgen."
            />
          )
        ) : loading ? (
          <p className="text-center text-muted-foreground py-10 flex items-center justify-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Zoeken…
          </p>
        ) : results.length === 0 ? (
          <EmptyState icon={Search} title={`Geen resultaten voor "${debounced}"`} description="Probeer een andere zoekterm." />
        ) : (
          <>
            <div>
              {results.map((p) => <Row key={p.user_id} p={p} isFollowing={following.has(p.user_id)} />)}
            </div>
            <div className="mt-10 flex justify-center">
              {hasMore && results.length < MAX_RESULTS ? (
                <Button variant="outline" onClick={loadMore} disabled={loadingMore} className="rounded-full text-[11px] font-bold uppercase tracking-widest">
                  {loadingMore ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> Laden…</> : "Meer laden"}
                </Button>
              ) : (
                <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-medium">
                  {results.length >= MAX_RESULTS ? "Maximum bereikt — verfijn je zoekopdracht." : "Alle resultaten geladen."}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Friends;
