import { useEffect, useState } from "react";
import {
  Ban,
  Check,
  Loader2,
  Lock,
  LogOut,
  MapPin,
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
import { useAuth } from "@/hooks/useAuth";
import { usePageMeta } from "@/hooks/usePageMeta";
import { usePublicProfile } from "@/hooks/useProfiles";
import { useProfileBlockMutation, useProfileFollowMutation, useSocialProfile } from "@/hooks/useSocial";
import { Link, useParams } from "@/lib/router";
import { authPagePath } from "@/lib/authClient";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";
import { profileSlugSchema } from "../../shared/contracts/profiles";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RestrictedFollowState = "unknown" | "pending" | "following";

const Profile = () => {
  const { profileKey = "" } = useParams<{ profileKey: string }>();
  const { user, signOut } = useAuth();
  const legacyProfileId = UUID.test(profileKey) ? profileKey.toLowerCase() : "";
  const parsedSlug = profileSlugSchema.safeParse(profileKey);
  const profileSlug = !legacyProfileId && parsedSlug.success ? parsedSlug.data : "";
  const publicProfileQuery = usePublicProfile(profileSlug, Boolean(profileSlug));
  const profileId = legacyProfileId || publicProfileQuery.data?.id || "";
  const profileQuery = useSocialProfile(profileId, Boolean(profileId));
  const followMutation = useProfileFollowMutation();
  const blockMutation = useProfileBlockMutation();
  const [restrictedFollowState, setRestrictedFollowState] = useState<RestrictedFollowState>("unknown");
  const [blockState, setBlockState] = useState<"active" | "blocked">("active");
  const [blockError, setBlockError] = useState<string | null>(null);

  useEffect(() => {
    setBlockState("active");
    setBlockError(null);
  }, [profileId]);

  const profile = profileQuery.data;
  const validProfileKey = Boolean(legacyProfileId || profileSlug);
  const socialProfileFailed = profileQuery.isError && !(blockState === "blocked" && profile);
  const profileError = legacyProfileId
    ? socialProfileFailed
    : publicProfileQuery.isError || (Boolean(publicProfileQuery.data) && socialProfileFailed);
  const profilePending = legacyProfileId
    ? profileQuery.isPending
    : publicProfileQuery.isPending || (Boolean(publicProfileQuery.data) && profileQuery.isPending);
  const isMe = profile?.viewerFollowStatus === "self";
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
    path: validProfileKey ? PRODUCT_ROUTES.profile(profile?.slug || profileSlug || profileKey) : undefined,
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
        toast.success(profile.viewerFollowStatus === "pending" ? "Verzoek ingetrokken" : "Je volgt deze bouwer niet meer");
      } else {
        toast.success(result.state === "pending" ? "Volgverzoek verstuurd" : "Je volgt deze bouwer nu");
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
      toast.error("Profiel of volgmogelijkheid niet beschikbaar");
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

  if (!validProfileKey || profileError) {
    return (
      <main className="container py-20 flex justify-center">
        <section className="max-w-md w-full rounded-xl border bg-card p-8 text-center space-y-4 shadow-sm" aria-labelledby="profile-unavailable-title">
          <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center">
            <Lock className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h1 id="profile-unavailable-title" className="text-xl font-serif font-semibold">Profiel niet beschikbaar</h1>
            <p className="text-sm text-muted-foreground" role="alert">
              Dit profiel bestaat niet, is afgeschermd of kan momenteel niet veilig worden geladen.
            </p>
          </div>
          {legacyProfileId && user && restrictedFollowState === "pending" ? (
            <Button
              type="button"
              variant="secondary"
              className="w-full gap-2"
              disabled={followMutation.isPending}
              onClick={cancelRestrictedRequest}
            >
              {followMutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                : <UserCheck className="h-4 w-4" aria-hidden="true" />}
              Verzoek intrekken
            </Button>
          ) : legacyProfileId && user && restrictedFollowState === "following" ? (
            <Button type="button" className="w-full gap-2" onClick={() => profileQuery.refetch()}>
              <Check className="h-4 w-4" aria-hidden="true" /> Profiel opnieuw laden
            </Button>
          ) : legacyProfileId && user ? (
            <Button
              type="button"
              className="w-full gap-2"
              disabled={followMutation.isPending}
              onClick={requestRestrictedProfile}
            >
              {followMutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                : <UserPlus className="h-4 w-4" aria-hidden="true" />}
              Volgverzoek versturen
            </Button>
          ) : validProfileKey && !user ? (
            <Button asChild className="w-full">
              <Link to={authPagePath(PRODUCT_ROUTES.profile(profileKey))}>Inloggen om verder te gaan</Link>
            </Button>
          ) : null}
          {validProfileKey && (
            <Button type="button" variant="ghost" className="w-full" onClick={refetchProfile}>
              Opnieuw proberen
            </Button>
          )}
          <Link to={PRODUCT_ROUTES.landing} className="block text-xs text-muted-foreground underline">Terug naar Buildy</Link>
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
      <main className="container flex min-h-[60vh] items-center justify-center py-20">
        <section className="w-full max-w-md space-y-5 rounded-xl border bg-card p-8 text-center shadow-sm" aria-labelledby="blocked-profile-title">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Ban className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="space-y-2">
            <h1 id="blocked-profile-title" className="text-xl font-serif font-semibold">Bouwer geblokkeerd</h1>
            <p className="text-sm leading-6 text-muted-foreground">
              Profielgegevens en verbouwingen zijn verborgen. Deblokkeren herstelt geen oude volgrelatie.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" className="w-full" disabled={blockMutation.isPending}>
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
                  Jullie kunnen elkaars openbare profiel en verbouwingen daarna weer zien. Volgrelaties worden niet automatisch hersteld.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuleren</AlertDialogCancel>
                <AlertDialogAction disabled={blockMutation.isPending} onClick={() => void toggleBlock()}>
                  Deblokkeren
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {blockError ? <p className="text-sm text-destructive" role="alert">{blockError}</p> : null}
          <Link to={PRODUCT_ROUTES.landing} className="block text-xs text-muted-foreground underline">Terug naar Buildy</Link>
        </section>
      </main>
    );
  }

  const isFollowing = profile.viewerFollowStatus === "following";
  const isPending = profile.viewerFollowStatus === "pending";

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 md:px-8 py-12 md:py-20">
        <section className="flex flex-col md:flex-row md:items-start gap-8 md:gap-10 mb-12" aria-labelledby="profile-title">
          <Avatar className="h-28 w-28 md:h-32 md:w-32 shrink-0">
            <AvatarImage src={profile.avatar?.proxyPath ?? ""} alt="" />
            <AvatarFallback className="bg-muted text-foreground font-serif italic text-4xl">
              {profile.displayName[0]?.toUpperCase() ?? "?"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {profile.isPrivate && (
                <span className="eyebrow flex items-center gap-1.5"><Lock className="h-3 w-3" aria-hidden="true" /> Privéprofiel</span>
              )}
              {profile.isPro && <span className="eyebrow">Buildy Pro</span>}
            </div>
            <h1 id="profile-title" className="font-serif italic text-4xl md:text-5xl leading-tight">{profile.displayName}</h1>
            <p className="text-sm text-muted-foreground mt-2">@{profile.slug}</p>
            {profile.location && (
              <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-3 font-light">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> {profile.location}
              </p>
            )}
            {profile.bio && <p className="text-sm mt-4 leading-relaxed font-light max-w-xl whitespace-pre-wrap">{profile.bio}</p>}

            <dl className="flex flex-wrap gap-x-8 gap-y-3 mt-6">
              <div>
                <dd className="font-serif italic text-2xl leading-none tabular-nums">{profile.followerCount}</dd>
                <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-1">Volgers</dt>
              </div>
              <div>
                <dd className="font-serif italic text-2xl leading-none tabular-nums">{profile.followingCount}</dd>
                <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-1">Volgend</dt>
              </div>
            </dl>

            <div className="mt-6 flex flex-wrap gap-2">
              {isMe ? (
                <Button type="button" size="sm" variant="outline" onClick={signOut} className="rounded-full px-5 gap-1.5 text-muted-foreground">
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Uitloggen
                </Button>
              ) : user ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={toggleFollow}
                  disabled={followMutation.isPending}
                  aria-pressed={isFollowing}
                  className={`rounded-full px-5 text-[11px] font-bold uppercase tracking-widest gap-1.5 ${
                    isFollowing || isPending
                      ? "bg-foreground text-background hover:bg-foreground/90"
                      : "bg-accent text-accent-foreground hover:bg-accent/90"
                  }`}
                >
                  {followMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : isFollowing || isPending ? (
                    <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {isFollowing ? "Volgend" : isPending ? "Verzoek intrekken" : "Volgen"}
                </Button>
              ) : (
                <Button asChild size="sm" className="rounded-full px-5 gap-1.5">
                  <Link to={authPagePath(PRODUCT_ROUTES.profile(profile.slug))}>
                    <UserPlus className="h-3.5 w-3.5" aria-hidden="true" /> Log in om te volgen
                  </Link>
                </Button>
              )}
              {!isMe ? (
                <ReportDialog
                  compact
                  targetType="profile"
                  targetId={profile.id}
                  targetLabel={`Profiel van ${profile.displayName}`}
                />
              ) : null}
              {!isMe && user ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="rounded-full px-5 text-destructive hover:text-destructive"
                      disabled={blockMutation.isPending}
                    >
                      {blockMutation.isPending
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        : <Ban className="h-3.5 w-3.5" aria-hidden="true" />}
                      Blokkeren
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Deze bouwer blokkeren?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        Jullie zien elkaars profiel en verbouwingen niet meer. Bestaande volgrelaties worden ingetrokken.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Annuleren</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        disabled={blockMutation.isPending}
                        onClick={() => void toggleBlock()}
                      >
                        Blokkeren
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </div>
            {blockError ? <p className="mt-3 text-sm text-destructive" role="alert">{blockError}</p> : null}
          </div>
        </section>

        <section className="rounded-2xl border border-border/70 bg-card px-6 py-8 shadow-sm" aria-labelledby="profile-content-title">
          <h2 id="profile-content-title" className="font-serif italic text-2xl">Over deze bouwer</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Projecten, updates en uitgebreide statistieken worden alleen getoond via hun eigen afgeschermde API’s. Op dit profiel staan daarom uitsluitend de veilig vrijgegeven profielgegevens.
          </p>
          <Link to={PRODUCT_ROUTES.landing} className="inline-block mt-5 text-sm underline underline-offset-4">Terug naar Buildy</Link>
        </section>
      </div>
    </main>
  );
};

export default Profile;
