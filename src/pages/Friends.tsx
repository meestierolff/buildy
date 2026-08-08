import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Lock,
  MapPin,
  Search,
  UserCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { SocialProfile } from "../../shared/contracts/social";
import EmptyState from "@/components/EmptyState";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { usePageMeta } from "@/hooks/usePageMeta";
import {
  useInfiniteSocialProfiles,
  useProfileFollowMutation,
  useRemoveProfileFollowerMutation,
} from "@/hooks/useSocial";
import { Link } from "@/lib/router";
import { authPagePath } from "@/lib/authClient";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";

type FriendsTab = "following" | "followers";

const Friends = () => {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeTab, setActiveTab] = useState<FriendsTab>("following");
  const [busyId, setBusyId] = useState<string | null>(null);
  const profilesQuery = useInfiniteSocialProfiles(
    debouncedQuery,
    debouncedQuery.length === 0 || debouncedQuery.length >= 2,
  );
  const followMutation = useProfileFollowMutation();
  const removeFollowerMutation = useRemoveProfileFollowerMutation();

  usePageMeta({
    title: "Vrienden ontdekken — Buildy",
    description: "Ontdek andere bouwers en volg hun renovatieverhalen.",
    path: "/connecties",
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const profiles = useMemo(() => {
    const unique = new Map<string, SocialProfile>();
    for (const profile of profilesQuery.data?.pages.flatMap((page) => page.items) ?? []) {
      unique.set(profile.id, profile);
    }
    return [...unique.values()].filter((profile) => profile.viewerFollowStatus !== "self");
  }, [profilesQuery.data]);
  const following = profiles.filter((profile) => profile.viewerFollowStatus === "following");
  const followers = profiles.filter((profile) => profile.followsViewer);
  const oneCharacterQuery = debouncedQuery.length === 1;
  const searching = debouncedQuery.length >= 2;

  const toggleFollow = async (profile: SocialProfile) => {
    if (!user) {
      toast.error("Log in om bouwers te volgen");
      return;
    }
    setBusyId(profile.id);
    const removing = profile.viewerFollowStatus === "following" || profile.viewerFollowStatus === "pending";
    try {
      const result = await followMutation.mutateAsync({
        action: removing ? "remove" : "follow",
        profileId: profile.id,
      });
      if (removing) {
        toast.success(profile.viewerFollowStatus === "pending" ? "Verzoek ingetrokken" : "Je volgt deze bouwer niet meer");
      } else {
        toast.success(result.state === "pending" ? "Volgverzoek verstuurd" : "Je volgt deze bouwer nu");
      }
    } catch (error) {
      console.error("Profile follow update failed", error);
      toast.error("Volgen bijwerken mislukt");
    } finally {
      setBusyId(null);
    }
  };

  const removeFollower = async (profile: SocialProfile) => {
    if (!user) return;
    setBusyId(profile.id);
    try {
      await removeFollowerMutation.mutateAsync({ followerId: profile.id });
      toast.success("Volger verwijderd");
    } catch (error) {
      console.error("Profile follower removal failed", error);
      toast.error("Volger verwijderen mislukt");
    } finally {
      setBusyId(null);
    }
  };

  const ProfileRow = ({
    profile,
    canRemoveFollower = false,
  }: {
    profile: SocialProfile;
    canRemoveFollower?: boolean;
  }) => {
    const isFollowing = profile.viewerFollowStatus === "following";
    const isPending = profile.viewerFollowStatus === "pending";
    return (
      <div className="flex items-center gap-4 py-5 border-b border-border last:border-b-0 group">
        <Link to={PRODUCT_ROUTES.profile(profile.slug)} className="flex items-center gap-4 min-w-0 flex-1">
          <Avatar className="h-12 w-12 shrink-0">
            <AvatarImage src={profile.avatar?.proxyPath ?? ""} alt="" />
            <AvatarFallback className="bg-muted text-foreground font-semibold text-sm">
              {profile.displayName[0]?.toUpperCase() ?? "?"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="font-serif italic text-xl leading-tight truncate group-hover:text-accent transition-colors flex items-center gap-2">
              {profile.displayName}
              {profile.isPrivate && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Privéprofiel" />}
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground mt-1 font-medium">
              <span>@{profile.slug}</span>
              {profile.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" aria-hidden="true" />{profile.location}
                </span>
              )}
              <span>{profile.followerCount} {profile.followerCount === 1 ? "volger" : "volgers"}</span>
            </div>
          </div>
        </Link>
        <div className="flex shrink-0 items-center gap-1.5">
          {user ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => toggleFollow(profile)}
              disabled={busyId === profile.id}
              aria-pressed={isFollowing}
              className={`rounded-full px-4 text-[10px] font-bold uppercase tracking-widest border-border ${
                isFollowing ? "bg-foreground text-background hover:bg-foreground/90 border-foreground" : ""
              }`}
            >
              {busyId === profile.id ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" aria-hidden="true" />
              ) : isFollowing || isPending ? (
                <UserCheck className="h-3 w-3 mr-1" aria-hidden="true" />
              ) : (
                <UserPlus className="h-3 w-3 mr-1" aria-hidden="true" />
              )}
              {isFollowing ? "Volgend" : isPending ? "Verzoek intrekken" : "Volgen"}
            </Button>
          ) : (
            <Button asChild size="sm" variant="outline" className="rounded-full text-[10px] uppercase tracking-widest">
              <Link to={authPagePath(PRODUCT_ROUTES.profile(profile.slug))}>
                Bekijken
              </Link>
            </Button>
          )}
          {canRemoveFollower && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive"
              onClick={() => removeFollower(profile)}
              disabled={busyId === profile.id}
              aria-label={`Verwijder ${profile.displayName} als volger`}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    );
  };

  const profileList = (items: SocialProfile[], emptyTitle: string, emptyDescription: string, canRemoveFollower = false) => (
    items.length > 0 ? (
      <div>{items.map((profile) => <ProfileRow key={profile.id} profile={profile} canRemoveFollower={canRemoveFollower} />)}</div>
    ) : (
      <EmptyState icon={Users} title={emptyTitle} description={emptyDescription} />
    )
  );

  const content = () => {
    if (oneCharacterQuery) {
      return <p className="py-10 text-center text-sm text-muted-foreground">Typ minimaal twee tekens om te zoeken.</p>;
    }
    if (profilesQuery.isPending) {
      return (
        <p className="text-center text-muted-foreground py-10 flex items-center justify-center gap-2 text-sm" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {searching ? "Zoeken…" : "Bouwers laden…"}
        </p>
      );
    }
    if (profilesQuery.isError) {
      return (
        <div className="py-10 text-center space-y-3" role="alert">
          <p className="text-sm text-muted-foreground">Bouwers konden niet worden geladen.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => profilesQuery.refetch()}>Opnieuw proberen</Button>
        </div>
      );
    }
    if (searching) {
      return profiles.length > 0
        ? <div>{profiles.map((profile) => <ProfileRow key={profile.id} profile={profile} />)}</div>
        : <EmptyState icon={Search} title={`Geen resultaten voor “${debouncedQuery}”`} description="Probeer een andere zoekterm." />;
    }
    if (!user) {
      return profileList(profiles, "Nog geen openbare bouwers", "Openbare profielen verschijnen hier zodra ze beschikbaar zijn.");
    }
    return (
      <Tabs value={activeTab} onValueChange={(value) => {
        if (value === "following" || value === "followers") setActiveTab(value);
      }} className="w-full">
        <TabsList className="grid grid-cols-2 bg-transparent border-b border-border rounded-none p-0 h-auto w-full mb-8">
          <TabsTrigger value="following" className="text-[11px] font-bold uppercase tracking-[0.2em] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground text-muted-foreground/60 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground pb-3 px-0">
            Volgend, geladen ({following.length})
          </TabsTrigger>
          <TabsTrigger value="followers" className="text-[11px] font-bold uppercase tracking-[0.2em] data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground text-muted-foreground/60 rounded-none border-b-2 border-transparent data-[state=active]:border-foreground pb-3 px-0">
            Volgers, geladen ({followers.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="following" className="mt-0">
          {profileList(following, "Geen gevolgde bouwers geladen", "Zoek hierboven op naam of laad meer zichtbare profielen.")}
        </TabsContent>
        <TabsContent value="followers" className="mt-0">
          {profileList(followers, "Nog geen zichtbare volgers", "Volgers uit de geladen, toegankelijke profielen verschijnen hier.", true)}
        </TabsContent>
        <p className="mt-6 text-xs text-muted-foreground">
          Nieuwe volgverzoeken voor een privéprofiel behandel je veilig via Meldingen.
        </p>
      </Tabs>
    );
  };

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 md:px-8 py-12 md:py-20">
        <div className="mb-12">
          <p className="eyebrow mb-3">Vrienden</p>
          <h1 className="font-serif italic text-4xl md:text-5xl leading-tight">Ontdek andere bouwers.</h1>
          <p className="text-sm text-muted-foreground mt-4 font-light max-w-md">
            Zoek op naam of gebruikersnaam en volg renovatieverhalen die voor jou zichtbaar zijn.
          </p>
        </div>
        <div className="relative mb-10">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            aria-label="Zoek bouwers op naam of gebruikersnaam"
            placeholder="Zoek op naam of @gebruikersnaam…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-11 h-12 rounded-full border-border"
          />
        </div>
        {content()}
        {!oneCharacterQuery && profilesQuery.hasNextPage && (
          <div className="mt-10 flex justify-center">
            <Button
              type="button"
              variant="outline"
              onClick={() => profilesQuery.fetchNextPage()}
              disabled={profilesQuery.isFetchingNextPage}
              className="rounded-full text-[11px] font-bold uppercase tracking-widest"
            >
              {profilesQuery.isFetchingNextPage ? "Meer laden…" : "Meer bouwers laden"}
            </Button>
          </div>
        )}
      </div>
    </main>
  );
};

export default Friends;
