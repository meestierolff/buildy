import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MapPin, Hammer, Camera, Pencil, Lock, UserPlus, UserCheck, Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";
import ProjectCard from "@/components/ProjectCard";
import { applyProjectMediaSummaries, loadProjectMediaSummaries } from "@/lib/projectMedia";
import { getOwnedPublicAvatarPath, getOwnedPublicTripMediaPath } from "@/lib/storagePaths";
import { usePageMeta } from "@/hooks/usePageMeta";

interface FollowProfile {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  is_private: boolean;
}

const Profile = () => {
  const { userId } = useParams<{ userId: string }>();
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [trips, setTrips] = useState<any[]>([]);
  const [stats, setStats] = useState({ updates: 0, photos: 0 });
  const [statsExtra, setStatsExtra] = useState({ budgetTotal: 0, completedProjects: 0, upcomingProject: null as any });
  const [followers, setFollowers] = useState<FollowProfile[]>([]);
  const [following, setFollowing] = useState<FollowProfile[]>([]);
  const [iFollow, setIFollow] = useState(false);
  const [followPending, setFollowPending] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [restrictedProfile, setRestrictedProfile] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ display_name: "", bio: "", location: "", is_private: false });

  const [activeTab, setActiveTab] = useState("projects");

  const isMe = user?.id === userId;
  const profileName = profile?.display_name || "Deze bouwer";
  const profileDescription = profile?.bio && profile.bio.trim().length >= 50
    ? `${profile.bio.slice(0, 140)}${profile.bio.length > 140 ? "..." : ""}`
    : `${profileName} deelt renovatieprojecten, updates, foto's en Bouwboeken op Buildy.${profile?.location ? ` Vanuit ${profile.location}.` : ""}`;

  usePageMeta({
    title: profile?.display_name ? `${profile.display_name} — Buildy` : "Profiel — Buildy",
    description: profileDescription,
    image: profile?.avatar_url || undefined,
    imageAlt: profile?.display_name ? `Profiel van ${profile.display_name} op Buildy` : "Bouwersprofiel op Buildy",
    path: userId ? `/profile/${userId}` : undefined,
    noIndex: !!profile?.is_private,
    type: "profile",
  });
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const loadFollows = useCallback(async (uid: string) => {
    const [{ data: fers }, { data: fing }] = await Promise.all([
      supabase.from("user_follows").select("follower_id").eq("following_id", uid).eq("status", "accepted"),
      supabase.from("user_follows").select("following_id").eq("follower_id", uid).eq("status", "accepted"),
    ]);
    const followerIds = (fers || []).map((r: any) => r.follower_id);
    const followingIds = (fing || []).map((r: any) => r.following_id);
    const allIds = Array.from(new Set([...followerIds, ...followingIds]));
    const profilesById: Record<string, FollowProfile> = {};
    if (allIds.length) {
      const { data: ps, error } = await supabase.rpc("get_profiles_basic", { _ids: allIds });
      if (error) console.error("Follow profiles load failed:", error);
      (ps || []).forEach((p) => {
        profilesById[p.user_id] = { ...p, is_private: false };
      });
    }
    setFollowers(followerIds.map((id) => profilesById[id]).filter(Boolean));
    setFollowing(followingIds.map((id) => profilesById[id]).filter(Boolean));
    if (user && !isMe) {
      const { data: rel } = await supabase
        .from("user_follows")
        .select("id, status")
        .eq("follower_id", user.id)
        .eq("following_id", uid)
        .maybeSingle();
      setIFollow(rel?.status === "accepted");
      setFollowPending(rel?.status === "pending");
    } else {
      setIFollow(false);
      setFollowPending(false);
    }
  }, [isMe, user]);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setRestrictedProfile(false);
    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (profileError) console.error("Profile load failed:", profileError);

    let visibleProfile: any = profileData;
    if (!visibleProfile) {
      const { data: basicRows, error: basicError } = await supabase.rpc("get_profiles_basic", { _ids: [userId] });
      if (basicError) console.error("Basic profile load failed:", basicError);
      const basic = basicRows?.[0];
      if (basic) {
        visibleProfile = {
          ...basic,
          bio: null,
          location: null,
          is_private: true,
          is_pro: false,
          onboarded: true,
        };
        setRestrictedProfile(true);
      }
    }

    setProfile(visibleProfile);
    if (profileData) setDraft({
      display_name: profileData.display_name || "",
      bio: profileData.bio || "",
      location: profileData.location || "",
      is_private: !!profileData.is_private,
    });

    await loadFollows(userId);
    if (!profileData) {
      setTrips([]);
      setStats({ updates: 0, photos: 0 });
      setStatsExtra({ budgetTotal: 0, completedProjects: 0, upcomingProject: null });
      setLoading(false);
      return;
    }

    const tripsQuery = supabase
      .from("trips")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    
    // Project RLS is separate from profile follows. A private project appears
    // only to its owner or an accepted project-level follower.
    const { data: tripsData } = await tripsQuery;
    const rawTrips = tripsData || [];
    const tripIds = rawTrips.map((t: any) => t.id);
    const mediaSummaries = await loadProjectMediaSummaries(tripIds);
    const tripsWithMedia = applyProjectMediaSummaries(rawTrips, mediaSummaries);
    setTrips(tripsWithMedia);

    let budgetTotal = 0;
    if (tripIds.length > 0) {
      const { data: budgetData } = await supabase
        .from("step_budget")
        .select("cost")
        .in("trip_id", tripIds);
      budgetTotal = (budgetData || []).reduce((sum, row) => sum + (Number(row.cost) || 0), 0);
    }

    const completedProjects = rawTrips.filter((t: any) => (t.progress_percentage || 0) >= 100).length;
    const upcomingProject = rawTrips.find((t: any) => t.start_date && new Date(t.start_date) > new Date()) || null;
    setStatsExtra({ budgetTotal, completedProjects, upcomingProject });

    const totals = Array.from(mediaSummaries.values()).reduce(
      (acc, item) => ({
        updates: acc.updates + item.stepCount,
        photos: acc.photos + item.mediaCount,
      }),
      { updates: 0, photos: 0 },
    );
    setStats(totals);

    setLoading(false);
  }, [loadFollows, userId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setActiveTab("projects");
  }, [userId]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    const extensions: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
    };
    const ext = extensions[file.type];
    if (!ext) {
      toast.error("Kies een JPG-, PNG-, WebP- of GIF-afbeelding");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("De profielfoto mag maximaal 10 MB zijn");
      return;
    }
    setAvatarUploading(true);
    const previousAvatarPath = getOwnedPublicAvatarPath(profile?.avatar_url, user.id);
    const previousLegacyPath = previousAvatarPath
      ? null
      : getOwnedPublicTripMediaPath(profile?.avatar_url, user.id);
    const nextSlot = previousAvatarPath?.split("/").at(-1)?.startsWith("avatar-a.") ? "b" : "a";
    const path = `${user.id}/avatar-${nextSlot}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("avatars")
      .upload(path, file, { contentType: file.type, upsert: true });
    if (upErr) {
      console.error("Avatar upload failed:", upErr);
      toast.error("Uploaden mislukt");
    } else {
      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
      const publicUrl = `${urlData.publicUrl}?v=${Date.now()}`;
      const { error: saveError } = await supabase
        .from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("user_id", user.id);
      if (saveError) {
        console.error("Avatar profile save failed:", saveError);
        await supabase.storage.from("avatars").remove([path]);
        toast.error("Profielfoto opslaan mislukt");
        setAvatarUploading(false);
        if (avatarInputRef.current) avatarInputRef.current.value = "";
        return;
      }

      if (previousAvatarPath && previousAvatarPath !== path) {
        const { error: cleanupError } = await supabase.storage.from("avatars").remove([previousAvatarPath]);
        if (cleanupError) console.error("Previous avatar cleanup failed:", cleanupError);
      }
      const previousName = previousLegacyPath?.split("/").at(-1) || "";
      const isManagedLegacyAvatar = previousLegacyPath?.startsWith(`${user.id}/avatars/`)
        || previousName.startsWith("avatar-");
      if (previousLegacyPath && isManagedLegacyAvatar) {
        const { error: cleanupError } = await supabase.storage.from("trip-media").remove([previousLegacyPath]);
        if (cleanupError) console.error("Legacy avatar cleanup failed:", cleanupError);
      }
      await load();
      toast.success("Profielfoto bijgewerkt!");
    }
    setAvatarUploading(false);
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  };

  const save = async () => {
    if (!user) return;
    const displayName = draft.display_name.trim();
    if (displayName.length < 2 || displayName.length > 60) {
      toast.error("Kies een naam van 2 tot 60 tekens");
      return;
    }
    if (draft.bio.trim().length > 500 || draft.location.trim().length > 100) {
      toast.error("Je bio of locatie is te lang");
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: displayName,
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
    try {
      if (iFollow || followPending) {
        const { error } = await supabase.from("user_follows").delete().eq("follower_id", user.id).eq("following_id", userId);
        if (error) throw error;
        setIFollow(false);
        setFollowPending(false);
        toast.success(followPending ? "Volgverzoek ingetrokken" : "Je volgt dit profiel niet meer");
      } else {
        const { data, error } = await supabase.rpc("request_user_follow", {
          _following_id: userId,
        });
        if (error) throw error;
        setIFollow(data === "accepted");
        setFollowPending(data === "pending");
        toast.success(data === "accepted" ? "Je volgt dit profiel nu" : "Volgverzoek verstuurd");
      }
      await loadFollows(userId);
    } catch (error) {
      console.error("Profile follow toggle failed:", error);
      toast.error("Volgen bijwerken mislukt");
    } finally {
      setFollowBusy(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
  }

  if (!profile) {
    return <div className="container py-20 text-center text-muted-foreground">Profiel niet gevonden.</div>;
  }

  const PeopleList = ({ list, empty }: { list: FollowProfile[]; empty: string }) => (
    list.length === 0 ? (
      <p className="text-center text-sm text-muted-foreground py-10 font-light">{empty}</p>
    ) : (
      <div>
        {list.map((p) => (
          <Link key={p.user_id} to={`/profile/${p.user_id}`} className="flex items-center gap-4 py-4 border-b border-border last:border-b-0 group">
            <Avatar className="h-11 w-11">
              <AvatarImage src={p.avatar_url ?? ""} />
              <AvatarFallback className="bg-muted text-foreground font-semibold text-sm">
                {p.display_name?.[0]?.toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="font-serif italic text-lg leading-tight truncate flex items-center gap-2 group-hover:text-accent transition-colors">
                {p.display_name || "Naamloos"}
                {p.is_private && <Lock className="h-3 w-3 text-muted-foreground shrink-0" />}
              </p>
            </div>
          </Link>
        ))}
      </div>
    )
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 md:px-8 py-12 md:py-20">
        {/* Hero */}
        <div className="flex flex-col md:flex-row md:items-start gap-8 md:gap-10 mb-16">
          <div className="relative shrink-0">
            <Avatar className="h-28 w-28 md:h-32 md:w-32">
              <AvatarImage src={profile.avatar_url || ""} />
              <AvatarFallback className="bg-muted text-foreground font-serif italic text-4xl">
                {profile.display_name?.[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
            {isMe && (
              <>
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={avatarUploading}
                  className="absolute inset-0 rounded-full bg-foreground/40 flex items-center justify-center opacity-0 hover:opacity-100 focus:opacity-100 transition-opacity"
                  title="Profielfoto wijzigen"
                >
                  {avatarUploading
                    ? <Loader2 className="h-5 w-5 text-background animate-spin" />
                    : <Camera className="h-5 w-5 text-background" />}
                </button>
                <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
              </>
            )}
          </div>

          <div className="flex-1 min-w-0">
            {profile.is_private && (
              <p className="eyebrow mb-3 flex items-center gap-1.5"><Lock className="h-3 w-3" /> Privé profiel</p>
            )}
            <h1 className="font-serif italic text-4xl md:text-5xl leading-tight">{profile.display_name}</h1>
            {profile.location && (
              <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-3 font-light">
                <MapPin className="h-3.5 w-3.5" /> {profile.location}
              </p>
            )}
            {profile.bio && <p className="text-sm mt-4 leading-relaxed font-light max-w-xl">{profile.bio}</p>}

            {!restrictedProfile && <div className="flex flex-wrap gap-x-8 gap-y-3 mt-6">
              {[
                { label: "Projecten", value: trips.length, tab: "projects" },
                { label: "Volgers", value: followers.length, tab: "followers" },
                { label: "Volgend", value: following.length, tab: "following" },
                { label: "Updates", value: stats.updates, tab: "" },
                { label: "Foto's", value: stats.photos, tab: "" },
              ].map((s) => (
                <div 
                  key={s.label} 
                  className={s.tab ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}
                  onClick={() => s.tab && setActiveTab(s.tab)}
                >
                  <p className="font-serif italic text-2xl leading-none tabular-nums">{s.value}</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-1">{s.label}</p>
                </div>
              ))}
            </div>}

            <div className="mt-6 flex gap-2">
              {!isMe && user && (
                <Button
                  size="sm"
                  onClick={toggleFollow}
                  disabled={followBusy}
                  className={`rounded-full px-5 text-[11px] font-bold uppercase tracking-widest gap-1.5 ${iFollow || followPending ? "bg-foreground text-background hover:bg-foreground/90" : "bg-accent text-accent-foreground hover:bg-accent/90"}`}
                >
                  {iFollow ? <><UserCheck className="h-3.5 w-3.5" /> Volgend</> : followPending ? <><UserCheck className="h-3.5 w-3.5" /> Verzoek intrekken</> : <><UserPlus className="h-3.5 w-3.5" /> Volgen</>}
                </Button>
              )}
              {!isMe && !user && (
                <Link to={`/auth?next=${encodeURIComponent(`/profile/${userId}`)}`}>
                  <Button size="sm" className="rounded-full px-5 text-[11px] font-bold uppercase tracking-widest gap-1.5 bg-accent text-accent-foreground hover:bg-accent/90">
                    <UserPlus className="h-3.5 w-3.5" /> Log in om te volgen
                  </Button>
                </Link>
              )}
              {isMe && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)} className="rounded-full px-5 text-[11px] font-bold uppercase tracking-widest gap-1.5 border-border">
                    <Pencil className="h-3.5 w-3.5" /> Bewerk profiel
                  </Button>
                  <Button size="sm" variant="outline" onClick={signOut} className="rounded-full px-5 text-[11px] font-bold uppercase tracking-widest gap-1.5 border-border text-muted-foreground hover:text-foreground">
                    <LogOut className="h-3.5 w-3.5" /> Uitloggen
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      {restrictedProfile ? (
        <div className="rounded-2xl border border-border/70 bg-card px-6 py-10 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Lock className="h-5 w-5 text-muted-foreground" />
          </div>
          <h2 className="font-serif italic text-2xl">Dit profiel is privé</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            Stuur een volgverzoek om de bio, projecten en sociale updates van deze bouwer te bekijken.
            Privéprojecten vragen daarna nog altijd apart toestemming.
          </p>
        </div>
      ) : (
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-2 sm:inline-flex bg-transparent sm:border-b sm:border-border rounded-none p-0 h-auto gap-x-6 gap-y-2 sm:gap-8 w-full justify-start mb-8">
          <TabsTrigger value="projects" className="text-[11px] font-bold uppercase tracking-[0.2em] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground text-muted-foreground/60 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground pb-3 px-0">Projecten</TabsTrigger>
          <TabsTrigger value="stats" className="text-[11px] font-bold uppercase tracking-[0.2em] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground text-muted-foreground/60 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground pb-3 px-0">Statistieken</TabsTrigger>
          <TabsTrigger value="followers" className="text-[11px] font-bold uppercase tracking-[0.2em] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground text-muted-foreground/60 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground pb-3 px-0">Volgers ({followers.length})</TabsTrigger>
          <TabsTrigger value="following" className="text-[11px] font-bold uppercase tracking-[0.2em] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground text-muted-foreground/60 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground pb-3 px-0">Volgend ({following.length})</TabsTrigger>
        </TabsList>


        <TabsContent value="projects" className="mt-6">
          {trips.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-10">Nog geen projecten.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12">
              {trips.map((trip) => (
                <ProjectCard
                  key={trip.id}
                  id={trip.id}
                  title={trip.title}
                  projectType={trip.project_type}
                  progressPercentage={trip.progress_percentage}
                  coverUrl={trip.cover_image_url}
                  coverMediaType={trip.cover_media_type}
                  placeholderIcon={Hammer}
                />
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
                {item.sub && <div className="text-xs text-accent mt-0.5">{item.sub}</div>}
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
                      {b.earned && <div className="w-2 h-2 rounded-full bg-accent shrink-0" />}
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
      )}

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
                  Standaard ben je privé. Zet dit aan om vindbaar te zijn in Vrienden. De zichtbaarheid van ieder project stel je apart in.
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
    </div>

  );
};

export default Profile;
