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
import AsyncState from "@/components/app/AsyncState";
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
import { Link, useSearchParams } from "@/lib/router";

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
    emptyDescription: "Zoek vrienden, familie of andere bouwers om hun verhaal te volgen.",
    emptyTitle: "Je volgt nog geen bouwers",
    label: "Volgend",
    value: "following",
  },
  {
    emptyDescription: "De mensen die jouw bouwverhaal volgen verschijnen hier.",
    emptyTitle: "Je eerste volger komt nog",
    label: "Volgers",
    value: "followers",
  },
  {
    emptyDescription: "Nieuwe verzoeken voor jouw privéprofiel verschijnen hier.",
    emptyTitle: "Geen inkomende verzoeken",
    label: "Verzoeken",
    value: "incoming",
  },
  {
    emptyDescription: "Verzoeken aan privéprofielen die nog wachten verschijnen hier.",
    emptyTitle: "Geen uitgaande verzoeken",
    label: "Verstuurd",
    value: "outgoing",
  },
  {
    emptyDescription: "Geblokkeerde bouwers verschijnen hier. Je kunt ze hier ook weer deblokkeren.",
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
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<FriendsTab>(() => {
    const view = searchParams.get("view");
    return CONNECTION_VIEWS.some((item) => item.value === view) ? view as SocialConnectionView : "search";
  });
  const [busyId, setBusyId] = useState<string | null>(null);

  const profilesQuery = useInfiniteSocialProfiles(
    debouncedQuery,
    activeTab === "search" && debouncedQuery.length >= 2,
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
    title: "Bouwers — Buildy",
    description: "Volg bouwers, bekijk je volgers en beheer volgverzoeken.",
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
              : "Bouwer ontvolgd"
            : result.state === "pending"
              ? "Volgverzoek verstuurd"
              : "Je volgt deze bouwer",
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
        toast.success("Bouwer gedeblokkeerd");
      });
    } catch {
      toast.error("Deblokkeren mislukt");
    }
  };

  const actionsFor = (profile: ConnectionPerson, context: FriendsTab) => {
    const loading = busyId === profile.id;
    if (context === "incoming") {
      return (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => decideRequest(profile, "accept")}
            disabled={loading}
            className="min-h-11 rounded-full px-4 text-sm font-medium"
          >
            <Check className="mr-1 h-3 w-3" aria-hidden="true" /> Accepteren
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => decideRequest(profile, "reject")}
            disabled={loading}
            className="min-h-11 rounded-full px-4 text-sm font-medium"
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
          className="min-h-11 rounded-full px-4 text-sm font-medium"
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
          className="min-h-11 rounded-full px-4 text-sm font-medium"
        >
          Deblokkeren
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
        className="min-h-11 rounded-full px-4 text-sm font-medium"
      >
        {loading ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
        ) : isFollowing ? (
          <UserCheck className="mr-1 h-3 w-3" aria-hidden="true" />
        ) : (
          <UserPlus className="mr-1 h-3 w-3" aria-hidden="true" />
        )}
        {context === "following" || isFollowing
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
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-4 last:border-b-0 sm:px-5">
        <div className="flex min-w-[10rem] flex-1 items-center gap-3">
          <Avatar className="h-12 w-12 shrink-0 border border-border">
            {profile.avatar && <AvatarImage src={profile.avatar.proxyPath} alt="" />}
            <AvatarFallback>{initials(profile.displayName)}</AvatarFallback>
          </Avatar>
          {profileIsAccessible ? (
            <Link to={PRODUCT_ROUTES.profile(profile.slug)} className="flex min-h-11 min-w-0 items-center hover:underline">
              {identity}
            </Link>
          ) : identity}
        </div>
        <div className="flex shrink-0">{actionsFor(profile, context)}</div>
      </div>
    );
  };

  const renderSearch = () => {
    if (query.trim().length < 2 || debouncedQuery.length < 2) {
      return <AsyncState status="empty" icon={<Search className="h-5 w-5" aria-hidden="true" />} title="Wie bouwt er mee?" description="Zoek op naam of gebruikersnaam. Typ minimaal twee tekens om een bouwer te vinden." />;
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
          <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => profilesQuery.refetch()}>
            Opnieuw proberen
          </Button>
        </div>
      );
    }
    if (profiles.length === 0) {
      return (
        <AsyncState status="empty" icon={<Search className="h-5 w-5" aria-hidden="true" />} title={`Geen bouwers gevonden voor “${debouncedQuery}”`} description="Controleer de naam of probeer een andere gebruikersnaam." />
      );
    }
    return <div className="overflow-hidden rounded-2xl border border-border bg-card">{profiles.map((profile) => <ProfileRow key={profile.id} profile={profile} context="search" />)}</div>;
  };

  const renderConnections = () => {
    if (!user) {
      return (
        <AsyncState status="empty"
          icon={<Users className="h-5 w-5" aria-hidden="true" />}
          title="Samen je verbouwing beleven"
          description="Log in om bouwers te volgen en je volgverzoeken te bekijken."
          action={(
            <Button asChild className="min-h-11 rounded-full">
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
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Bouwers laden…
        </p>
      );
    }
    if (activeConnectionQuery.isError) {
      return (
        <div className="space-y-3 py-12 text-center" role="alert">
          <p className="text-sm text-muted-foreground">Deze lijst kon niet worden geladen.</p>
          <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => activeConnectionQuery.refetch()}>
            Opnieuw proberen
          </Button>
        </div>
      );
    }
    if (activeConnections.length === 0) {
      return <AsyncState status="empty" icon={<Users className="h-5 w-5" aria-hidden="true" />} title={config.emptyTitle} description={config.emptyDescription} action={activeTab === "following" ? <Button className="min-h-11" onClick={() => setActiveTab("search")}>Zoek een bouwer</Button> : undefined} />;
    }
    return <div className="overflow-hidden rounded-2xl border border-border bg-card">{activeConnections.map((profile) => <ProfileRow key={profile.id} profile={profile} context={activeTab} />)}</div>;
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

  const requestView = ["incoming", "outgoing", "blocked"].includes(activeTab);
  const incomingTotal = incomingQuery.data?.pages[0]?.total;
  const activeTotal = activeConnectionQuery?.data?.pages[0]?.total;
  const primaryTabs = [
    { value: "search", label: "Zoeken" },
    { value: "following", label: "Volgend" },
    { value: "followers", label: "Volgers" },
    { value: "incoming", label: "Verzoeken" },
  ] as const;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 pb-12 pt-7 sm:px-6 sm:pt-10">
        <header className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">Bouwers</h1>
          <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">Volg de mensen achter de verbouwing.</p>
        </header>

        <Tabs value={requestView ? "incoming" : activeTab} onValueChange={(value) => setActiveTab(value as FriendsTab)}>
          <TabsList className="mb-6 grid h-auto w-full grid-cols-4 rounded-xl bg-muted p-1">
            {primaryTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="relative min-h-11 rounded-lg px-1 text-xs font-medium data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm sm:px-3 sm:text-sm">
                {tab.label}
                {tab.value === "incoming" && incomingTotal ? <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold text-accent-foreground">{incomingTotal}</span> : null}
              </TabsTrigger>
            ))}
          </TabsList>

          {requestView && user ? (
            <div className="mb-5 flex gap-2 overflow-x-auto pb-1" aria-label="Verzoeken en blokkades">
              {CONNECTION_VIEWS.filter((view) => ["incoming", "outgoing", "blocked"].includes(view.value)).map((view) => {
                const total = connectionQueries[view.value].data?.pages[0]?.total;
                return <Button key={view.value} type="button" variant={activeTab === view.value ? "secondary" : "ghost"} className="min-h-11 shrink-0 rounded-full px-4 text-xs" aria-pressed={activeTab === view.value} onClick={() => setActiveTab(view.value)}>{view.value === "incoming" ? "Ontvangen" : view.label}{total === undefined ? "" : ` · ${total}`}</Button>;
              })}
            </div>
          ) : null}

          {activeTab === "search" ? (
            <div className="relative mb-5">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input aria-label="Zoek bouwers op naam of gebruikersnaam" placeholder="Naam of gebruikersnaam" value={query} onChange={(event) => setQuery(event.target.value)} className="h-12 rounded-xl border-border bg-card pl-12 pr-4 text-base" autoComplete="off" maxLength={80} />
            </div>
          ) : null}

          {activeTab === "following" || activeTab === "followers" ? (
            <p className="mb-4 text-xs text-muted-foreground">
              {activeTotal === undefined ? "" : `${activeTotal} `}
              {activeTab === "following"
                ? activeTotal === 1 ? "bouwer die je volgt" : "bouwers die je volgt"
                : activeTotal === 1 ? "persoon volgt jouw verhaal" : "mensen volgen jouw verhaal"}
            </p>
          ) : null}
          {activeTab === "search" ? renderSearch() : renderConnections()}
        </Tabs>

        {currentHasNextPage && (activeTab !== "search" || (query.trim().length >= 2 && debouncedQuery.length >= 2)) ? (
          <div className="mt-6 flex justify-center"><Button type="button" variant="outline" className="min-h-11 rounded-full" onClick={() => void fetchNextPage()} disabled={currentIsFetchingNextPage}>{currentIsFetchingNextPage ? "Meer laden…" : "Meer bouwers"}</Button></div>
        ) : null}
      </div>
    </main>
  );
};

export default Friends;
