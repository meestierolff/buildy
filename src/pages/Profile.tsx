import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MapPin, Hammer, Camera, Pencil, Lock, UserPlus, UserCheck, Users, BarChart2 } from "lucide-react";
import { toast } from "sonner";

interface FollowProfile {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  is_private: boolean;
}

const Profile = () => {
  const { userId } = useParams<{ userId: string }>();
  const { user } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [trips, setTrips] = useState<any[]>([]);
  const [stats, setStats] = useState({ updates: 0, photos: 0 });
  const [statsExtra, setStatsExtra] = useState({ budgetTotal: 0, completedProjects: 0, upcomingProject: null as any });
  const [followers, setFollowers] = useState<FollowProfile[]>([]);
  const [following, setFollowing] = useState<FollowProfile[]>([]);
  const [iFollow, setIFollow] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ display_name: "", bio: "", location: "", is_private: false });

  const isMe = user?.id === userId;

  const loadFollows = async (uid: string) => {
    const [{ data: fers }, { data: fing }] = await Promise.all([
      supabase.from("user_follows").select("follower_id").eq("following_id", uid),
      supabase.from("user_follows").select("following_id").eq("follower_id", uid),
    ]);
    const followerIds = (fers || []).map((r: any) => r.follower_id);
    const followingIds = (fing || []).map((r: any) => r.following_id);
    const allIds = Array.from(new Set([...followerIds, ...followingIds]));
    let profilesById: Record<string, FollowProfile> = {};
    if (allIds.length) {
      const { data: ps } = await supabase
        .from("profiles")
        .select("user_id, display_name, avatar_url, is_private")
        .in("user_id", allIds);
      (ps || []).forEach((p: any) => { profilesById[p.user_id] = p; });
    }
    setFollowers(followerIds.map((id) => profilesById[id]).filter(Boolean));
    setFollowing(followingIds.map((id) => profilesById[id]).filter(Boolean));
    if (user && !isMe) {
      const { data: rel } = await supabase
        .from("user_follows")
        .select("id")
        .eq("follower_id", user.id)
        .eq("following_id", uid)
        .maybeSingle();
      setIFollow(!!rel);
    }
  };

  const load = async () => {
    if (!userId) return;
    const { data: profileData } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .single();
    setProfile(profileData);
    if (profileData) setDraft({
      display_name: profileData.display_name || "",
      bio: profileData.bio || "",
      location: profileData.location || "",
      is_private: !!profileData.is_private,
    });

    let tripsQuery = supabase
      .from("trips")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (!isMe) tripsQuery = tripsQuery.eq("is_public", true);
    const { data: tripsData } = await tripsQuery;
    setTrips(tripsData || []);

    const completedProjects = (tripsData || []).filter((t: any) => (t.progress_percentage || 0) >= 100).length;
    const budgetTotal = (tripsData || []).reduce((sum: number, t: any) => sum + (t.budget_total || 0), 0);
    const upcomingProject = (tripsData || []).find((t: any) => t.start_date && new Date(t.start_date) > new Date()) || null;
    setStatsExtra({ budgetTotal, completedProjects, upcomingProject });

    const tripIds = (tripsData || []).map((t: any) => t.id);
    if (tripIds.length) {
      const [{ count: updates }, { count: photos }] = await Promise.all([
        supabase.from("steps").select("*", { count: "exact", head: true }).in("trip_id", tripIds),
        supabase.from("step_media").select("*", { count: "exact", head: true }).eq("user_id", userId),
      ]);
      setStats({ updates: updates || 0, photos: photos || 0 });
    } else {
      setStats({ updates: 0, photos: 0 });
    }

    await loadFollows(userId);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [userId, user?.id]);

  const save = async () => {
    if (!user) return;
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: draft.display_name.trim(),
        bio: draft.bio.trim() || null,
        location: draft.location.trim() || null,
        is_private: draft.is_private,
      })
      .eq("user_id", user.id);
    if (error) {
      toast.error("Opslaan mislukt");
    } else {
      toast.success("Profiel bijgewerkt");
      setEditing(false);
      load();
    }
  };

  const toggleFollow = async () => {
    if (!user) { toast.error("Log in om te volgen"); return; }
    if (!userId || isMe) return;
    setFollowBusy(true);
    if (iFollow) {
      await supabase.from("user_follows").delete().eq("follower_id", user.id).eq("following_id", userId);
      setIFollow(false);
    } else {
      await supabase.from("user_follows").insert({ follower_id: user.id, following_id: userId });
      setIFollow(true);
    }
    await loadFollows(userId);
    setFollowBusy(false);
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
  }

  if (!profile) {
    return <div className="container py-20 text-center text-muted-foreground">Profiel niet gevonden.</div>;
  }

  const PeopleList = ({ list, empty }: { list: FollowProfile[]; empty: string }) => (
    list.length === 0 ? (
      <p className="text-center text-sm text-muted-foreground py-10">{empty}</p>
    ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {list.map((p) => (
          <Link key={p.user_id} to={`/profile/${p.user_id}`}>
            <Card className="hover:shadow-md hover:border-accent/40 transition-all">
              <CardContent className="p-3 flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={p.avatar_url ?? ""} />
                  <AvatarFallback className="bg-accent text-accent-foreground font-bold">
                    {p.display_name?.[0]?.toUpperCase() ?? "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold truncate flex items-center gap-1">
                    {p.display_name || "Naamloos"}
                    {p.is_private && <Lock className="h-3 w-3 text-muted-foreground" />}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    )
  );

  return (
    <div className="container max-w-4xl py-12">
      <div className="flex items-start gap-4 mb-8">
        <Avatar className="h-20 w-20">
          <AvatarImage src={profile.avatar_url || ""} />
          <AvatarFallback className="bg-primary text-primary-foreground text-2xl">
            {profile.display_name?.[0]?.toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              {profile.display_name}
              {profile.is_private && (
                <span title="Privé profiel" className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  <Lock className="h-3 w-3" /> Privé
                </span>
              )}
            </h1>
            <div className="flex gap-2">
              {!isMe && user && (
                <Button
                  size="sm"
                  variant={iFollow ? "default" : "outline"}
                  onClick={toggleFollow}
                  disabled={followBusy}
                  className={`gap-1.5 ${iFollow ? "bg-accent text-accent-foreground hover:bg-accent/90" : ""}`}
                >
                  {iFollow ? <><UserCheck className="h-3.5 w-3.5" /> Gevolgd</> : <><UserPlus className="h-3.5 w-3.5" /> Volgen</>}
                </Button>
              )}
              {isMe && (
                <Button size="sm" variant="outline" onClick={() => setEditing(true)} className="gap-1.5">
                  <Pencil className="h-3.5 w-3.5" /> Bewerk
                </Button>
              )}
            </div>
          </div>
          {profile.location && (
            <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
              <MapPin className="h-3.5 w-3.5" /> {profile.location}
            </p>
          )}
          {profile.bio && <p className="text-sm mt-2 leading-relaxed">{profile.bio}</p>}

          <div className="flex flex-wrap gap-5 mt-3 text-sm">
            <span><strong>{trips.length}</strong> <span className="text-muted-foreground">projecten</span></span>
            <span><strong>{followers.length}</strong> <span className="text-muted-foreground">volgers</span></span>
            <span><strong>{following.length}</strong> <span className="text-muted-foreground">volgend</span></span>
            <span className="flex items-center gap-1"><Hammer className="h-3.5 w-3.5 text-accent" /><strong>{stats.updates}</strong> <span className="text-muted-foreground">updates</span></span>
            <span className="flex items-center gap-1"><Camera className="h-3.5 w-3.5 text-accent" /><strong>{stats.photos}</strong> <span className="text-muted-foreground">foto's</span></span>
          </div>
        </div>
      </div>

      <Tabs defaultValue="projects" className="w-full">
        <TabsList>
          <TabsTrigger value="projects">Projecten</TabsTrigger>
          <TabsTrigger value="stats" className="gap-1.5"><BarChart2 className="h-3.5 w-3.5" /> Statistieken</TabsTrigger>
          <TabsTrigger value="followers" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Volgers ({followers.length})</TabsTrigger>
          <TabsTrigger value="following" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Volgend ({following.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="mt-6">
          {trips.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-10">Nog geen projecten.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {trips.map((trip) => (
                <Link key={trip.id} to={`/trip/${trip.id}`}>
                  <Card className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer border-2 hover:border-accent/40">
                    <div className="h-40 bg-gradient-to-br from-primary/20 to-accent/20">
                      {trip.cover_image_url && (
                        <img src={trip.cover_image_url} alt={trip.title} className="w-full h-full object-cover" />
                      )}
                    </div>
                    <CardContent className="p-4">
                      <h3 className="font-semibold text-lg font-sans">{trip.title}</h3>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="stats" className="mt-6 space-y-8">
          {/* Big numbers */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Projecten", value: trips.length, sub: statsExtra.completedProjects > 0 ? `${statsExtra.completedProjects} afgerond` : null },
              { label: "Updates", value: stats.updates, sub: null },
              { label: "Foto's", value: stats.photos, sub: null },
              { label: "Geïnvesteerd", value: statsExtra.budgetTotal > 0 ? `€${statsExtra.budgetTotal.toLocaleString("nl")}` : "—", sub: null },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border bg-card p-4 text-center">
                <div className="text-3xl font-bold tabular-nums">{item.value}</div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mt-1">{item.label}</div>
                {item.sub && <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">{item.sub}</div>}
              </div>
            ))}
          </div>

          {/* Upcoming project countdown */}
          {statsExtra.upcomingProject && (() => {
            const days = Math.ceil((new Date(statsExtra.upcomingProject.start_date).getTime() - Date.now()) / 86_400_000);
            return (
              <div className="p-5 rounded-lg border-2 border-accent/40 bg-accent/5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-accent mb-1">Aankomend project</p>
                <p className="font-serif italic text-xl leading-tight">{statsExtra.upcomingProject.title}</p>
                <p className="text-3xl font-bold mt-2">Nog <span className="text-accent">{days}</span> <span className="text-lg font-normal text-muted-foreground">dagen</span></p>
              </div>
            );
          })()}

          {/* Badges */}
          {(() => {
            const BADGES = [
              { id: "early", emoji: "⭐", label: "Vroege Bouwer", desc: "Een van de eerste gebruikers", earned: true },
              { id: "first_step", emoji: "🔨", label: "Eerste Sloopdag", desc: "Eerste update gepost", earned: stats.updates >= 1 },
              { id: "craftsman", emoji: "📐", label: "Vakman", desc: "10 updates gepost", earned: stats.updates >= 10 },
              { id: "documentalist", emoji: "📸", label: "Documentalist", desc: "50 foto's geüpload", earned: stats.photos >= 50 },
              { id: "completed", emoji: "🏁", label: "Opgeleverd", desc: "Project afgerond op 100%", earned: statsExtra.completedProjects >= 1 },
              { id: "popular", emoji: "🤝", label: "Buurtbouwer", desc: "5 volgers verzameld", earned: followers.length >= 5 },
            ];
            return (
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-4">Badges</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {BADGES.map((b) => (
                    <div key={b.id} className={`rounded-lg border p-3 flex items-center gap-3 transition-all ${b.earned ? "bg-card" : "opacity-35 bg-muted/10"}`}>
                      <span className="text-2xl leading-none">{b.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">{b.label}</p>
                        <p className="text-xs text-muted-foreground leading-tight">{b.desc}</p>
                      </div>
                      {b.earned && <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </TabsContent>

        <TabsContent value="followers" className="mt-6">
          <PeopleList list={followers} empty="Nog geen volgers." /></TabsContent>

        <TabsContent value="following" className="mt-6">
          <PeopleList list={following} empty="Volgt nog niemand." />
        </TabsContent>
      </Tabs>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <DialogHeader><DialogTitle>Profiel bewerken</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Naam</Label>
              <Input value={draft.display_name} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} />
            </div>
            <div>
              <Label>Locatie</Label>
              <Input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
            </div>
            <div>
              <Label>Bio</Label>
              <Textarea value={draft.bio} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} rows={3} />
            </div>
            <div className="flex items-start justify-between gap-3 p-3 rounded-lg border bg-muted/30">
              <div className="flex-1">
                <Label className="flex items-center gap-1.5 font-medium">
                  <Lock className="h-3.5 w-3.5" /> Openbaar profiel
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Standaard ben je privé. Zet dit aan om zichtbaar te zijn in 'Vrienden' en 'Ontdekken', zodat anderen je projecten kunnen volgen.
                </p>
              </div>
              <Switch
                checked={!draft.is_private}
                onCheckedChange={(v) => setDraft({ ...draft, is_private: !v })}
              />
            </div>
            <Button onClick={save} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">Opslaan</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Profile;
