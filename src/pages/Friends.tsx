import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Loader2,
  Lock,
  Search,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type {
  SocialConnection,
  SocialConnectionView,
  SocialProfile,
} from "../../shared/contracts/social";
import EmptyState from "@/components/EmptyState";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { usePageMeta } from "@/hooks/usePageMeta";
import {
  useInfiniteSocialConnections,
  useInfiniteSocialProfiles,
  useProfileBlockMutation,
  useProfileFollowMutation,
  useRemoveProfileFollowerMutation,
  useSocialRequestDecisionMutation,
} from "@/hooks/useSocial";
import { authPagePath } from "@/lib/authClient";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";
import { Link } from "@/lib/router";

type FriendsTab = "search" | SocialConnectionView;
type ConnectionPerson = Pick<
  SocialProfile,
  | "avatar"
  | "displayName"
  | "followsViewer"
  | "id"
  | "isPrivate"
  | "slug"
  | "viewerFollowStatus"
>;

const CONNECTION_VIEWS: ReadonlyArray<{
  emptyDescription: string;
  emptyTitle: string;
  label: string;
  value: SocialConnectionView;
}> = [
  {
    emptyDescription: "Zoek een bouwer en volg het verbouwingsverhaal.",
    emptyTitle: "Je volgt nog niemand",
    label: "Volgend",
    value: "following",
  },
  {
    emptyDescription: "Volgers verschijnen hier zodra iemand jouw profiel volgt.",
    emptyTitle: "Nog geen volgers",
    label: "Volgers",
    value: "followers",
  },
  {
    emptyDescription: "Nieuwe verzoeken voor jouw privéprofiel verschijnen hier.",
    emptyTitle: "Geen inkomende verzoeken",
    label: "Inkomend",
    value: "incoming",
  },
  {
    emptyDescription: "Verzoeken aan privéprofielen die nog wachten verschijnen hier.",
    emptyTitle: "Geen uitgaande verzoeken",
    label: "Uitgaand",
    value: "outgoing",
  },
  {
    emptyDescription: "Geblokkeerde accounts verschijnen hier en kunnen altijd worden vrijgegeven.",
    emptyTitle: "Niemand geblokkeerd",
    label: "Geblokkeerd",
    value: "blocked",
  },
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("nl-NL"))
    .join("") || "B";
}

const Friends = () => {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeTab, setActiveTab] = useState<FriendsTab>("search");
  const [busyId, setBusyId] = useState<string | null>(null);

  const profilesQuery = useInfiniteSocialProfiles(
    debouncedQuery,
    activeTab === "search" && (debouncedQuery.length === 0 || debouncedQuery.length >= 2),
  );
  const followingQuery = useInfiniteSocialConnections("following", Boolean(user));
  const followersQuery = useInfiniteSocialConnections("followers", Boolean(user));
  const incomingQuery = useInfiniteSocialConnections("incoming", Boolean(user));
  const outgoingQuery = useInfiniteSocialConnections("outgoing", Boolean(user));
  const blockedQuery = useInfiniteSocialConnections("blocked", Boolean(user));

  const followMutation = useProfileFollowMutation();
  const removeFollowerMutation = useRemoveProfileFollowerMutation();
  const requestDecisionMutation = useSocialRequestDecisionMutation();
  const blockMutation = useProfileBlockMutation();

  usePageMeta({
    title: "Connecties — Buildy",
    description: "Zoek bouwers en beheer je volgers, verzoeken en blokkades.",
    path: "/connecties",
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const profiles = useMemo(() => {
    const unique = new Map<string, SocialProfile>();
    for (const profile of profilesQuery.data?.pages.flatMap((page) => page.items) ?? []) {
      if (profile.viewerFollowStatus !== "self") unique.set(profile.id, profile);
    }
    return [...unique.values()];
  }, [profilesQuery.data]);

  const connectionQueries = {
    blocked: blockedQuery,
    followers: followersQuery,
    following: followingQuery,
    incoming: incomingQuery,
    outgoing: outgoingQuery,
  } as const;
  const activeConnectionQuery = activeTab === "search" ? null : connectionQueries[activeTab];
  const activeConnections = useMemo<SocialConnection[]>(() => {
    if (!activeConnectionQuery) return [];
    const unique = new Map<string, SocialConnection>();
    for (const connection of activeConnectionQuery.data?.pages.flatMap((page) => page.items) ?? []) {
      unique.set(connection.id, connection);
    }
    return [...unique.values()];
  }, [activeConnectionQuery]);

  const runFor = async (profileId: string, operation: () => Promise<unknown>) => {
    setBusyId(profileId);
    try {
      await operation();
    } finally {
      setBusyId(null);
    }
  };

  const toggleFollow = async (profile: ConnectionPerson) => {
    if (!user) {
      toast.error("Log in om bouwers te volgen");
      return;
    }
    const removing = profile.viewerFollowStatus === "following" || profile.viewerFollowStatus === "pending";
    try {
      await runFor(profile.id, async () => {
        const result = await followMutation.mutateAsync({
          action: removing ? "remove" : "follow",
          profileId: profile.id,
        });
        toast.success(
          removing
            ? profile.viewerFollowStatus === "pending"
              ? "Verzoek ingetrokken"
              : "Je volgt deze bouwer niet meer"
            : result.state === "pending"
              ? "Volgverzoek verstuurd"
              : "Je volgt deze bouwer nu",
        );
      });
    } catch {
      toast.error("Volgen bijwerken mislukt");
    }
  };

  const removeFollower = async (profile: ConnectionPerson) => {
    try {
      await runFor(profile.id, async () => {
        await removeFollowerMutation.mutateAsync({ followerId: profile.id });
        toast.success("Volger verwijderd");
      });
    } catch {
      toast.error("Volger verwijderen mislukt");
    }
  };

  const decideRequest = async (profile: ConnectionPerson, decision: "accept" | "reject") => {
    try {
      await runFor(profile.id, async () => {
        await requestDecisionMutation.mutateAsync({
          actorId: profile.id,
          decision,
          kind: "profile",
        });
        toast.success(decision === "accept" ? "Volgverzoek geaccepteerd" : "Volgverzoek afgewezen");
      });
    } catch {
      toast.error("Verzoek verwerken mislukt");
    }
  };

  const unblock = async (profile: ConnectionPerson) => {
    try {
      await runFor(profile.id, async () => {
        await blockMutation.mutateAsync({ action: "unblock", profileId: profile.id });
        toast.success("Account vrijgegeven");
      });
    } catch {
      toast.error("Account vrijgeven mislukt");
    }
  };

  const actionsFor = (profile: ConnectionPerson, context: FriendsTab) => {
    const loading = busyId === profile.id;
    if (context === "incoming") {
      return (
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => decideRequest(profile, "accept")}
            disabled={loading}
            className="rounded-full text-[10px] font-bold uppercase tracking-widest"
          >
            <Check className="mr-1 h-3 w-3" aria-hidden="true" /> Accepteren
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => decideRequest(profile, "reject")}
            disabled={loading}
            className="rounded-full text-[10px] font-bold uppercase tracking-widest"
          >
            <X className="mr-1 h-3 w-3" aria-hidden="true" /> Afwijzen
          </Button>
        </div>
      );
    }
    if (context === "followers") {
      return (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => removeFollower(profile)}
          disabled={loading}
          className="rounded-full text-[10px] font-bold uppercase tracking-widest"
        >
          <UserMinus className="mr-1 h-3 w-3" aria-hidden="true" /> Verwijderen
        </Button>
      );
    }
    if (context === "blocked") {
      return (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => unblock(profile)}
          disabled={loading}
          className="rounded-full text-[10px] font-bold uppercase tracking-widest"
        >
          Vrijgeven
        </Button>
      );
    }

    const removing = context === "following" || context === "outgoing";
    const isFollowing = profile.viewerFollowStatus === "following";
    const isPending = profile.viewerFollowStatus === "pending";
    return (
      <Button
        type="button"
        size="sm"
        variant={removing || isFollowing ? "outline" : "default"}
        onClick={() => toggleFollow(profile)}
        disabled={loading}
        className="rounded-full text-[10px] font-bold uppercase tracking-widest"
      >
        {loading ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
        ) : isFollowing ? (
          <UserCheck className="mr-1 h-3 w-3" aria-hidden="true" />
        ) : (
          <UserPlus className="mr-1 h-3 w-3" aria-hidden="true" />
        )}
        {context === "following"
          ? "Ontvolgen"
          : context === "outgoing" || isPending
            ? "Intrekken"
            : "Volgen"}
      </Button>
    );
  };

  const ProfileRow = ({ profile, context }: { profile: ConnectionPerson; context: FriendsTab }) => {
    const profileIsAccessible = !profile.isPrivate || profile.viewerFollowStatus === "following";
    const identity = (
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{profile.displayName}</p>
        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          @{profile.slug}
          {profile.isPrivate && <Lock className="h-3 w-3" aria-label="Privéprofiel" />}
        </p>
      </div>
    );
    return (
      <div className="flex flex-col gap-4 border-b border-border py-5 last:border-b-0 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <Avatar className="h-11 w-11 shrink-0 border border-border">
            {profile.avatar && <AvatarImage src={profile.avatar.proxyPath} alt="" />}
            <AvatarFallback>{initials(profile.displayName)}</AvatarFallback>
          </Avatar>
          {profileIsAccessible ? (
            <Link to={PRODUCT_ROUTES.profile(profile.slug)} className="min-w-0 hover:underline">
              {identity}
            </Link>
          ) : identity}
        </div>
        <div className="flex shrink-0 pl-[3.75rem] sm:pl-0">{actionsFor(profile, context)}</div>
      </div>
    );
  };

  const renderSearch = () => {
    if (debouncedQuery.length === 1) {
      return <p className="py-12 text-center text-sm text-muted-foreground">Typ minimaal twee tekens om te zoeken.</p>;
    }
    if (profilesQuery.isPending) {
      return (
        <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Bouwers laden…
        </p>
      );
    }
    if (profilesQuery.isError) {
      return (
        <div className="space-y-3 py-12 text-center" role="alert">
          <p className="text-sm text-muted-foreground">Bouwers konden niet worden geladen.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => profilesQuery.refetch()}>
            Opnieuw proberen
          </Button>
        </div>
      );
    }
    if (profiles.length === 0) {
      return (
        <EmptyState
          icon={Search}
          title={debouncedQuery ? `Geen resultaten voor “${debouncedQuery}”` : "Nog geen openbare bouwers"}
          description={debouncedQuery ? "Probeer een andere naam of gebruikersnaam." : "Openbare profielen verschijnen hier zodra ze beschikbaar zijn."}
        />
      );
    }
    return <div>{profiles.map((profile) => <ProfileRow key={profile.id} profile={profile} context="search" />)}</div>;
  };

  const renderConnections = () => {
    if (!user) {
      return (
        <EmptyState
          icon={Users}
          title="Log in voor je connecties"
          description="Je volgers, verzoeken en blokkades zijn alleen voor jou zichtbaar."
          action={(
            <Button asChild className="rounded-full">
              <Link to={authPagePath("/connecties")}>Inloggen</Link>
            </Button>
          )}
        />
      );
    }
    const config = CONNECTION_VIEWS.find((view) => view.value === activeTab);
    if (!activeConnectionQuery || !config) return null;
    if (activeConnectionQuery.isPending) {
      return (
        <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Connecties laden…
        </p>
      );
    }
    if (activeConnectionQuery.isError) {
      return (
        <div className="space-y-3 py-12 text-center" role="alert">
          <p className="text-sm text-muted-foreground">Deze lijst kon niet worden geladen.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => activeConnectionQuery.refetch()}>
            Opnieuw proberen
          </Button>
        </div>
      );
    }
    if (activeConnections.length === 0) {
      return <EmptyState icon={Users} title={config.emptyTitle} description={config.emptyDescription} />;
    }
    return <div>{activeConnections.map((profile) => <ProfileRow key={profile.id} profile={profile} context={activeTab} />)}</div>;
  };

  const currentHasNextPage = activeTab === "search"
    ? profilesQuery.hasNextPage
    : activeConnectionQuery?.hasNextPage;
  const currentIsFetchingNextPage = activeTab === "search"
    ? profilesQuery.isFetchingNextPage
    : activeConnectionQuery?.isFetchingNextPage;
  const fetchNextPage = () => activeTab === "search"
    ? profilesQuery.fetchNextPage()
    : activeConnectionQuery?.fetchNextPage();

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-5 py-12 sm:px-8 md:py-20">
        <div className="mb-10 max-w-xl">
          <p className="eyebrow mb-3">Connecties</p>
          <h1 className="font-serif text-4xl italic leading-tight md:text-5xl">Bouw samen, op jouw voorwaarden.</h1>
          <p className="mt-4 text-sm font-light text-muted-foreground">
            Vind andere bouwers en beheer hier alle volgers, verzoeken en blokkades vanuit één rustige plek.
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as FriendsTab)}>
          <TabsList className="mb-8 flex h-auto w-full justify-start gap-6 overflow-x-auto rounded-none border-b border-border bg-transparent p-0">
            <TabsTrigger
              value="search"
              className="shrink-0 rounded-none border-b-2 border-transparent px-0 pb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              Zoeken
            </TabsTrigger>
            {user && CONNECTION_VIEWS.map((view) => {
              const total = connectionQueries[view.value].data?.pages[0]?.total;
              return (
                <TabsTrigger
                  key={view.value}
                  value={view.value}
                  className="shrink-0 rounded-none border-b-2 border-transparent px-0 pb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                >
                  {view.label} {total === undefined ? "" : `(${total})`}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {activeTab === "search" && (
            <div className="relative mb-8">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                aria-label="Zoek bouwers op naam of gebruikersnaam"
                placeholder="Zoek op naam of @gebruikersnaam…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-12 rounded-full border-border pl-11"
              />
            </div>
          )}

          {activeTab === "search" ? renderSearch() : renderConnections()}
        </Tabs>

        {currentHasNextPage && (
          <div className="mt-10 flex justify-center">
            <Button
              type="button"
              variant="outline"
              onClick={fetchNextPage}
              disabled={currentIsFetchingNextPage}
              className="rounded-full text-[11px] font-bold uppercase tracking-widest"
            >
              {currentIsFetchingNextPage ? "Meer laden…" : "Meer laden"}
            </Button>
          </div>
        )}
      </div>
    </main>
  );
};

export default Friends;
