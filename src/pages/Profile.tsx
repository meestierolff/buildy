import { useEffect, useMemo, useState } from "react";
import {
  Ban,
  ArrowLeft,
  ArrowRight,
  Check,
  Home,
  Loader2,
  Lock,
  MapPin,
  Plus,
  Settings2,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import ReportDialog from "@/components/moderation/ReportDialog";
import AsyncState from "@/components/app/AsyncState";
import ProjectCard from "@/components/ProjectCard";
import { useAuth } from "@/hooks/useAuth";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useOwnProfile, usePublicProfile } from "@/hooks/useProfiles";
import { useProjectDashboard } from "@/hooks/useProjectApi";
import { useProfileBlockMutation, useProfileFollowMutation, useProfileProjects, useSocialProfile } from "@/hooks/useSocial";
import { Link, Navigate, useParams } from "@/lib/router";
import { authPagePath } from "@/lib/authClient";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";
import { profileSlugSchema } from "../../shared/contracts/profiles";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RestrictedFollowState = "unknown" | "pending" | "following";

const Profile = () => {
  const { profileKey = "" } = useParams<{ profileKey: string }>();
  const { user, loading: authLoading } = useAuth();
  const ownProfileRoute = !profileKey;
  const ownProfileQuery = useOwnProfile(ownProfileRoute && Boolean(user));
  const legacyProfileId = UUID.test(profileKey) ? profileKey.toLowerCase() : "";
  const parsedSlug = profileSlugSchema.safeParse(profileKey);
  const profileSlug = !legacyProfileId && parsedSlug.success ? parsedSlug.data : "";
  const publicProfileQuery = usePublicProfile(profileSlug, Boolean(profileSlug));
  const profileId = ownProfileRoute
    ? ownProfileQuery.data?.id ?? ""
    : legacyProfileId || publicProfileQuery.data?.id || "";
  const profileQuery = useSocialProfile(profileId, Boolean(profileId));
  const followMutation = useProfileFollowMutation();
  const blockMutation = useProfileBlockMutation();
  const [restrictedFollowState, setRestrictedFollowState] = useState<RestrictedFollowState>("unknown");
  const [blockState, setBlockState] = useState<"active" | "blocked">("active");
  const [blockError, setBlockError] = useState<string | null>(null);

  useEffect(() => {
    setBlockState("active");
    setBlockError(null);
    setRestrictedFollowState("unknown");
  }, [profileId]);

  const profile = profileQuery.data;
  const validProfileKey = ownProfileRoute || Boolean(legacyProfileId || profileSlug);
  const socialProfileFailed = profileQuery.isError && !(blockState === "blocked" && profile);
  const profileError = ownProfileRoute
    ? ownProfileQuery.isError || (Boolean(ownProfileQuery.data) && socialProfileFailed)
    : legacyProfileId
    ? socialProfileFailed
    : publicProfileQuery.isError || (Boolean(publicProfileQuery.data) && socialProfileFailed);
  const profilePending = authLoading || (ownProfileRoute
    ? ownProfileQuery.isPending || (Boolean(ownProfileQuery.data) && profileQuery.isPending)
    : legacyProfileId
    ? profileQuery.isPending
    : publicProfileQuery.isPending || (Boolean(publicProfileQuery.data) && profileQuery.isPending));
  const isMe = profile?.viewerFollowStatus === "self";
  const canViewProjects = Boolean(profile && profile.viewerAccess !== "requestable" && blockState !== "blocked");
  const dashboardQuery = useProjectDashboard(isMe && canViewProjects);
  const publicProjectsQuery = useProfileProjects(profileId, !isMe && canViewProjects);
  const projectsQuery = isMe ? dashboardQuery : publicProjectsQuery;
  const projects = useMemo(() => [...new Map(
    (projectsQuery.data?.pages.flatMap((page) => page.items) ?? []).map((project) => [project.id, project]),
  ).values()], [projectsQuery.data]);
  const description = profile?.bio?.trim()
    ? `${profile.bio.slice(0, 140)}${profile.bio.length > 140 ? "…" : ""}`
    : profile
      ? `${profile.displayName} deelt een renovatieverhaal op Buildy.`
      : "Bouwersprofiel op Buildy.";

  usePageMeta({
    title: profile ? `${profile.displayName} — Buildy` : "Profiel — Buildy",
    description,
    image: profile?.avatar?.proxyPath,
    imageAlt: profile ? `Profiel van ${profile.displayName} op Buildy` : "Bouwersprofiel op Buildy",
    path: ownProfileRoute ? PRODUCT_ROUTES.ownProfile : validProfileKey ? PRODUCT_ROUTES.profile(profile?.slug || profileSlug || profileKey) : undefined,
    noIndex: profile?.isPrivate ?? true,
    type: "profile",
  });

  const toggleFollow = async () => {
    if (!user) {
      toast.error("Log in om deze bouwer te volgen");
      return;
    }
    if (!profile || isMe) return;
    const removing = profile.viewerFollowStatus === "following" || profile.viewerFollowStatus === "pending";
    try {
      const result = await followMutation.mutateAsync({
        action: removing ? "remove" : "follow",
        profileId: profile.id,
      });
      if (removing) {
        toast.success(profile.viewerFollowStatus === "pending" ? "Verzoek ingetrokken" : "Bouwer ontvolgd");
      } else {
        toast.success(result.state === "pending" ? "Volgverzoek verstuurd" : "Je volgt deze bouwer");
      }
    } catch (error) {
      console.error("Profile follow update failed", error);
      toast.error("Volgen bijwerken mislukt");
    }
  };

  const requestRestrictedProfile = async () => {
    if (!user || !legacyProfileId) return;
    try {
      const result = await followMutation.mutateAsync({ action: "follow", profileId: legacyProfileId });
      if (result.state === "pending") {
        setRestrictedFollowState("pending");
        toast.success("Volgverzoek verstuurd");
        return;
      }
      if (result.state === "following") {
        setRestrictedFollowState("following");
        toast.success("Toegang verleend");
        await profileQuery.refetch();
        return;
      }
      toast.error("Dit profiel is niet beschikbaar");
    } catch (error) {
      console.error("Restricted profile follow request failed", error);
      toast.error("Dit profiel kun je nu niet volgen");
    }
  };

  const cancelRestrictedRequest = async () => {
    if (!user || !legacyProfileId) return;
    try {
      await followMutation.mutateAsync({ action: "remove", profileId: legacyProfileId });
      setRestrictedFollowState("unknown");
      toast.success("Verzoek ingetrokken");
    } catch (error) {
      console.error("Restricted profile follow cancellation failed", error);
      toast.error("Verzoek intrekken mislukt");
    }
  };

  const refetchProfile = async () => {
    if (ownProfileRoute) {
      await ownProfileQuery.refetch();
      return profileQuery.refetch();
    }
    if (legacyProfileId) return profileQuery.refetch();
    const publicResult = await publicProfileQuery.refetch();
    if (publicResult.data) return profileQuery.refetch();
    return publicResult;
  };

  const toggleBlock = async () => {
    if (!user || !profile || isMe || blockMutation.isPending) return;
    const action = blockState === "blocked" ? "unblock" : "block";
    setBlockError(null);
    try {
      const result = await blockMutation.mutateAsync({ action, profileId: profile.id });
      if (action === "block" && result.state !== "blocked") throw new Error("Unexpected block state");
      if (action === "unblock" && result.state !== "unblocked") throw new Error("Unexpected unblock state");
      setBlockState(action === "block" ? "blocked" : "active");
      toast.success(action === "block" ? "Bouwer geblokkeerd" : "Bouwer gedeblokkeerd");
      if (action === "unblock") {
        void refetchProfile().catch((error) => {
          console.error("Profile refresh after unblock failed", error);
        });
      }
    } catch (error) {
      console.error("Profile block update failed", error);
      const message = action === "block"
        ? "Blokkeren is niet gelukt. Probeer het opnieuw."
        : "Deblokkeren is niet gelukt. Probeer het opnieuw.";
      setBlockError(message);
      toast.error(message);
    }
  };

  if (ownProfileRoute && !authLoading && !user) {
    return <Navigate to={authPagePath(PRODUCT_ROUTES.ownProfile)} replace />;
  }

  if (!validProfileKey || profileError) {
    return (
      <main className="mx-auto flex max-w-lg justify-center px-4 py-10">
        <section className="max-w-md w-full rounded-xl border bg-card p-8 text-center space-y-4 shadow-sm" aria-labelledby="profile-unavailable-title">
          <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center">
            <Lock className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h1 id="profile-unavailable-title" className="text-xl font-semibold">Profiel niet beschikbaar</h1>
            <p className="text-sm text-muted-foreground" role="alert">
              Dit profiel bestaat niet, is afgeschermd of kan momenteel niet veilig worden geladen.
            </p>
          </div>
          {legacyProfileId && user && restrictedFollowState === "pending" ? (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 w-full gap-2"
              disabled={followMutation.isPending}
              onClick={cancelRestrictedRequest}
            >
              {followMutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                : <UserCheck className="h-4 w-4" aria-hidden="true" />}
              Verzoek intrekken
            </Button>
          ) : legacyProfileId && user && restrictedFollowState === "following" ? (
            <Button type="button" className="min-h-11 w-full gap-2" onClick={() => profileQuery.refetch()}>
              <Check className="h-4 w-4" aria-hidden="true" /> Profiel opnieuw laden
            </Button>
          ) : legacyProfileId && user ? (
            <Button
              type="button"
              className="min-h-11 w-full gap-2"
              disabled={followMutation.isPending}
              onClick={requestRestrictedProfile}
            >
              {followMutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                : <UserPlus className="h-4 w-4" aria-hidden="true" />}
              Volgverzoek sturen
            </Button>
          ) : validProfileKey && !user ? (
            <Button asChild className="min-h-11 w-full">
              <Link to={authPagePath(PRODUCT_ROUTES.profile(profileKey))}>Inloggen om verder te gaan</Link>
            </Button>
          ) : null}
          {validProfileKey && (
            <Button type="button" variant="ghost" className="min-h-11 w-full" onClick={refetchProfile}>
              Opnieuw proberen
            </Button>
          )}
          <Link to={PRODUCT_ROUTES.landing} className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline">Terug naar Buildy</Link>
        </section>
      </main>
    );
  }

  if (profilePending || !profile) {
    return (
      <main className="flex items-center justify-center min-h-[60vh]" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Profiel laden…</span>
      </main>
    );
  }

  if (blockState === "blocked") {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-lg items-center justify-center px-4 py-10">
        <section className="w-full max-w-md space-y-5 rounded-xl border bg-card p-8 text-center shadow-sm" aria-labelledby="blocked-profile-title">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Ban className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="space-y-2">
            <h1 id="blocked-profile-title" className="text-xl font-semibold">Bouwer geblokkeerd</h1>
            <p className="text-sm leading-6 text-muted-foreground">
              Profielgegevens en verbouwingen zijn verborgen. Na deblokkeren volg je deze bouwer niet automatisch opnieuw.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" className="min-h-11 w-full" disabled={blockMutation.isPending}>
                {blockMutation.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  : <Ban className="h-4 w-4" aria-hidden="true" />}
                Deblokkeren
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Deze bouwer deblokkeren?</AlertDialogTitle>
                <AlertDialogDescription>
                  Jullie kunnen elkaars openbare profiel en verbouwingen daarna weer zien. Jullie volgen elkaar niet automatisch opnieuw.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="min-h-11">Annuleren</AlertDialogCancel>
                <AlertDialogAction className="min-h-11" disabled={blockMutation.isPending} onClick={() => void toggleBlock()}>
                  Deblokkeren
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {blockError ? <p className="text-sm text-destructive" role="alert">{blockError}</p> : null}
          <Link to={PRODUCT_ROUTES.landing} className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline">Terug naar Buildy</Link>
        </section>
      </main>
    );
  }

  const isFollowing = profile.viewerFollowStatus === "following";
  const isPending = profile.viewerFollowStatus === "pending";

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 pb-12 pt-5 sm:px-6 sm:pt-8">
        <div className="mb-5 flex items-center justify-between">
          <Link to={PRODUCT_ROUTES.connections} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Bouwers
          </Link>
          {isMe ? (
            <Button asChild variant="ghost" className="min-h-11 gap-2">
              <Link to={PRODUCT_ROUTES.account}><Settings2 className="h-4 w-4" aria-hidden="true" /> Instellingen</Link>
            </Button>
          ) : null}
        </div>

        <section className="rounded-2xl border border-border bg-card p-5 sm:p-7" aria-labelledby="profile-title">
          <div className="flex items-start gap-4 sm:gap-5">
            <Avatar className="h-20 w-20 shrink-0 border-4 border-background sm:h-24 sm:w-24">
              {profile.avatar ? <AvatarImage src={profile.avatar.proxyPath} alt="" /> : null}
              <AvatarFallback className="bg-secondary text-2xl font-semibold text-primary">
                {profile.displayName[0]?.toUpperCase() ?? "B"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 pt-1">
              <h1 id="profile-title" className="break-words text-2xl font-bold tracking-tight sm:text-3xl">{profile.displayName}</h1>
              <p className="mt-1 break-all text-sm text-muted-foreground">@{profile.slug}</p>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2 text-xs text-muted-foreground">
                {profile.location ? <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{profile.location}</span> : null}
                {profile.isPrivate ? <span className="flex items-center gap-1"><Lock className="h-3.5 w-3.5" aria-hidden="true" />Privéprofiel</span> : null}
                {profile.followsViewer && !isMe ? <span className="font-medium text-primary">Volgt jou</span> : null}
              </div>
            </div>
          </div>
          {profile.bio ? <p className="mt-5 max-w-2xl whitespace-pre-wrap text-sm leading-6">{profile.bio}</p> : null}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
            <dl className="flex gap-6 text-sm">
              <div><dd className="text-xl font-semibold tabular-nums">{profile.followerCount}</dd><dt className="text-xs text-muted-foreground">Volgers</dt></div>
              <div><dd className="text-xl font-semibold tabular-nums">{profile.followingCount}</dd><dt className="text-xs text-muted-foreground">Volgend</dt></div>
            </dl>
            {isMe ? (
              <Button asChild variant="outline" className="min-h-11 gap-2">
                <Link to={PRODUCT_ROUTES.account}><Settings2 className="h-4 w-4" aria-hidden="true" /> Profiel bewerken</Link>
              </Button>
            ) : user ? (
              <Button
                type="button"
                onClick={toggleFollow}
                disabled={followMutation.isPending}
                variant={isFollowing || isPending ? "outline" : "default"}
                className="min-h-11 min-w-32 gap-2"
              >
                {followMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : isFollowing || isPending ? <UserCheck className="h-4 w-4" aria-hidden="true" /> : <UserPlus className="h-4 w-4" aria-hidden="true" />}
                {isFollowing ? "Ontvolgen" : isPending ? "Verzoek intrekken" : "Volgen"}
              </Button>
            ) : (
              <Button asChild className="min-h-11 gap-2">
                <Link to={authPagePath(PRODUCT_ROUTES.profile(profile.slug))}><UserPlus className="h-4 w-4" aria-hidden="true" /> Log in om te volgen</Link>
              </Button>
            )}
          </div>
          {isPending ? <p className="mt-3 text-sm text-muted-foreground" role="status">Je volgverzoek wacht op goedkeuring.</p> : null}
          {!isMe && !isFollowing && !isPending ? <p className="mt-3 text-xs leading-5 text-muted-foreground">{profile.isPrivate ? "Deze bouwer keurt volgverzoeken eerst goed." : "Volg deze bouwer voor nieuwe Bouwmomenten in je timeline."}</p> : null}
        </section>

        {isMe ? (
          <Link to={PRODUCT_ROUTES.connections} className="my-5 flex min-h-14 items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium hover:border-primary/30">
            <span className="flex items-center gap-2"><UserPlus className="h-4 w-4 text-primary" aria-hidden="true" /> Bouwers, volgers en verzoeken</span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </Link>
        ) : null}

        <section className="mt-8" aria-labelledby="profile-content-title">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 id="profile-content-title" className="text-lg font-semibold">{isMe ? "Mijn verbouwingen" : "Verbouwingen"}</h2>
              {!isMe ? <p className="mt-1 text-xs text-muted-foreground">De verhalen die deze bouwer met jou deelt.</p> : null}
            </div>
            {isMe ? <Button asChild variant="outline" className="min-h-11 gap-2"><Link to={PRODUCT_ROUTES.newProject}><Plus className="h-4 w-4" aria-hidden="true" /> Nieuw</Link></Button> : null}
          </div>
          {!canViewProjects ? (
            <AsyncState status="empty" icon={<Lock className="h-5 w-5" />} title="Een privéverhaal" description="Na goedkeuring van je volgverzoek zie je de verbouwingen die deze bouwer met volgers deelt." />
          ) : projectsQuery.isPending ? (
            <div className="grid gap-5 sm:grid-cols-2" role="status" aria-label="Verbouwingen laden">
              {[0, 1].map((item) => <div key={item} className="aspect-[4/3] animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" aria-hidden="true" />)}
            </div>
          ) : projectsQuery.isError ? (
            <AsyncState status="error" title="Verbouwingen laden lukt niet" description="Probeer het opnieuw om de verhalen te bekijken." action={<Button variant="outline" onClick={() => void projectsQuery.refetch()}>Opnieuw proberen</Button>} />
          ) : projects.length === 0 ? (
            <AsyncState status="empty" icon={<Home className="h-5 w-5" />} title={isMe ? "Je eerste verhaal begint hier" : "Nog geen zichtbare verbouwingen"} description={isMe ? "Maak je verbouwing aan. Elke foto en elk Bouwmoment groeit mee in je Bouwboek." : "Deze bouwer heeft nog geen verbouwing met jou gedeeld."} action={isMe ? <Button asChild className="bg-accent text-accent-foreground hover:bg-accent/90"><Link to={PRODUCT_ROUTES.newProject}><Plus className="mr-2 h-4 w-4" />Start een verbouwing</Link></Button> : undefined} />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => <ProjectCard key={project.id} id={project.id} title={project.title} projectType={project.projectType} progressPercentage={project.progressPercentage} coverUrl={project.cover?.proxyPath} coverMediaType={project.cover?.contentType?.startsWith("video/") ? "video" : "image"} updateCount={project.updateCount} visibility={project.visibility} />)}
            </div>
          )}
          {canViewProjects && projectsQuery.hasNextPage ? <div className="mt-5 flex justify-center"><Button variant="outline" className="min-h-11" disabled={projectsQuery.isFetchingNextPage} onClick={() => void projectsQuery.fetchNextPage()}>{projectsQuery.isFetchingNextPage ? "Laden…" : "Meer verbouwingen"}</Button></div> : null}
        </section>

        {!isMe ? (
          <div className="mt-8 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4 [&_button]:min-h-11">
            <ReportDialog compact targetType="profile" targetId={profile.id} targetLabel={`Profiel van ${profile.displayName}`} />
            {user ? (
              <AlertDialog>
                <AlertDialogTrigger asChild><Button type="button" variant="ghost" className="min-h-11 gap-2 text-muted-foreground" disabled={blockMutation.isPending}><Ban className="h-4 w-4" aria-hidden="true" />Blokkeren</Button></AlertDialogTrigger>
                <AlertDialogContent className="w-[calc(100%-2rem)] rounded-xl">
                  <AlertDialogHeader><AlertDialogTitle>Deze bouwer blokkeren?</AlertDialogTitle><AlertDialogDescription>Jullie zien elkaars profiel en verbouwingen niet meer. Jullie volgen elkaar daarna niet meer.</AlertDialogDescription></AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel className="min-h-11">Annuleren</AlertDialogCancel><AlertDialogAction className="min-h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={blockMutation.isPending} onClick={() => void toggleBlock()}>Blokkeren</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
            {blockError ? <p className="w-full text-sm text-destructive" role="alert">{blockError}</p> : null}
          </div>
        ) : null}
      </div>
    </main>
  );
};

export default Profile;
