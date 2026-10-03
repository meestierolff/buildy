import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Download,
  FileArchive,
  Loader2,
  Lock,
  LogOut,
  MapPin,
  MonitorSmartphone,
  Save,
  Camera,
  ChevronDown,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import {
  useAccountExports,
  useAccountSessions,
  useCreateAccountExportMutation,
  useRequestAccountDeletionMutation,
  useRevokeAccountSessionMutation,
} from "@/hooks/useAccount";
import { useOwnProfile, useUpdateOwnProfileMutation } from "@/hooks/useProfiles";
import { useModerationAdminSession } from "@/hooks/useModeration";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useAppFeatures } from "@/lib/appFeatures";
import { ApiClientError } from "@/lib/apiClient";
import { preparePrivateProjectImage, uploadProfileImage, type PreparedProjectImage } from "@/lib/privateMediaApi";
import { createClientIdempotencyKey } from "@/lib/clientIdempotency";
import { Link, Navigate } from "@/lib/router";
import type { UpdateOwnProfileInput } from "../../shared/contracts/profiles";
import type { AccountExportStatus } from "../../shared/contracts/account";

type ProfileDraft = {
  bio: string;
  displayName: string;
  isPrivate: boolean;
  location: string;
  slug: string;
};

const EMPTY_PROFILE: ProfileDraft = {
  bio: "",
  displayName: "",
  isPrivate: true,
  location: "",
  slug: "",
};

function normalizedOptional(value: string): string | null {
  return value.trim() || null;
}

const exportStatusLabels: Record<AccountExportStatus, string> = {
  requested: "In wachtrij",
  processing: "Wordt gemaakt",
  retry_scheduled: "Nieuwe poging gepland",
  ready: "Klaar om te downloaden",
  expired: "Verlopen",
  failed: "Mislukt",
  dead_letter: "Handmatige controle nodig",
  deleted: "Verwijderd",
};

function accountDate(value: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Onbekend apparaat";
  if (/iphone|ipad/i.test(userAgent)) return "iPhone of iPad";
  if (/android/i.test(userAgent)) return "Android-apparaat";
  if (/macintosh|mac os/i.test(userAgent)) return "Mac";
  if (/windows/i.test(userAgent)) return "Windows-computer";
  if (/linux/i.test(userAgent)) return "Linux-computer";
  return "Browserapparaat";
}

const AccountSettings = () => {
  const appFeatures = useAppFeatures();
  const accountLifecycleEnabled = appFeatures.accountLifecycleEnabled;
  usePageMeta({
    title: "Account & instellingen — Buildy",
    description: "Beheer je profiel, privacy en account.",
    path: "/account",
    noIndex: true,
  });
  const { user, loading: authLoading, signOut } = useAuth();
  const adminSession = useModerationAdminSession(Boolean(user) && !authLoading);
  const profileQuery = useOwnProfile(Boolean(user));
  const profileMutation = useUpdateOwnProfileMutation();
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY_PROFILE);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string>();
  const [avatarRemoved, setAvatarRemoved] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const avatarUpload = useRef<{ file: File; key: string; prepared?: PreparedProjectImage; assetId?: string }>();
  const [draftVersion, setDraftVersion] = useState<number | null>(null);
  const [includeMediaInExport, setIncludeMediaInExport] = useState(true);
  const [deletionConfirmation, setDeletionConfirmation] = useState("");
  const [leavingAccount, setLeavingAccount] = useState(false);
  const sessionsQuery = useAccountSessions(Boolean(user));
  const exportsQuery = useAccountExports(Boolean(user));
  const revokeSessionMutation = useRevokeAccountSessionMutation();
  const createExportMutation = useCreateAccountExportMutation();
  const deletionMutation = useRequestAccountDeletionMutation();

  const profile = profileQuery.data;

  useEffect(() => {
    if (!profile || profile.version === draftVersion) return;
    setDraft({
      bio: profile.bio ?? "",
      displayName: profile.displayName,
      isPrivate: profile.isPrivate,
      location: profile.location ?? "",
      slug: profile.slug,
    });
    setDraftVersion(profile.version);
  }, [draftVersion, profile]);

  useEffect(() => {
    if (!avatarFile) { setAvatarPreview(undefined); return; }
    const preview = URL.createObjectURL(avatarFile);
    setAvatarPreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [avatarFile]);

  if (authLoading || leavingAccount) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">{leavingAccount ? "Uitloggen…" : "Account laden…"}</span>
      </main>
    );
  }

  if (!user) return <Navigate to="/auth?next=/account" replace />;

  const setField = <Key extends keyof ProfileDraft>(key: Key, value: ProfileDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile || savingProfile) return;

    const displayName = draft.displayName.trim();
    const slug = draft.slug.trim().toLowerCase();
    const bio = normalizedOptional(draft.bio);
    const location = normalizedOptional(draft.location);
    const changes: Partial<UpdateOwnProfileInput> = {};
    if (displayName !== profile.displayName) changes.displayName = displayName;
    if (slug !== profile.slug) changes.slug = slug;
    if (bio !== profile.bio) changes.bio = bio;
    if (location !== profile.location) changes.location = location;
    if (draft.isPrivate !== profile.isPrivate) changes.isPrivate = draft.isPrivate;

    if (avatarRemoved && profile.avatar) changes.avatarAssetId = null;

    if (Object.keys(changes).length === 0 && !avatarFile) {
      toast.info("Er zijn geen profielwijzigingen om op te slaan.");
      return;
    }

    setSavingProfile(true);
    try {
      if (avatarFile) {
        if (avatarUpload.current?.file !== avatarFile) {
          avatarUpload.current = { file: avatarFile, key: createClientIdempotencyKey("avatar-upload") };
        }
        const upload = avatarUpload.current;
        upload.prepared ??= await preparePrivateProjectImage(avatarFile);
        upload.assetId ??= (await uploadProfileImage({
          idempotencyKey: upload.key,
          prepared: upload.prepared,
        })).id;
        changes.avatarAssetId = upload.assetId;
      }
      await profileMutation.mutateAsync({
        idempotencyKey: createClientIdempotencyKey("profile-update"),
        expectedVersion: profile.version,
        ...changes,
      });
      setAvatarFile(null);
      setAvatarRemoved(false);
      avatarUpload.current = undefined;
      toast.success("Je profiel is bijgewerkt.");
    } catch (error) {
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : error instanceof Error ? error.message : "Je profiel kon niet worden opgeslagen. Probeer het opnieuw.",
      );
    } finally {
      setSavingProfile(false);
    }
  };

  const requestExport = async () => {
    try {
      await createExportMutation.mutateAsync({
        idempotencyKey: createClientIdempotencyKey("account-export"),
        includeMedia: includeMediaInExport,
      });
      toast.success("Je data-export staat in de wachtrij.");
    } catch (error) {
      console.error("Account export request failed", error);
      toast.error(error instanceof ApiClientError
        ? error.message
        : "Je data-export kon niet worden aangevraagd.");
    }
  };

  const signOutAndReturnHome = async () => {
    // signOut clears the session before its refresh finishes. Keep this view
    // pending so it cannot redirect to /auth during the planned full navigation.
    setLeavingAccount(true);
    const signedOut = await signOut();
    if (!signedOut) {
      setLeavingAccount(false);
      return false;
    }
    window.location.assign("/");
    return true;
  };

  const revokeSession = async (sessionId: string, isCurrent: boolean) => {
    try {
      await revokeSessionMutation.mutateAsync(sessionId);
      if (isCurrent) {
        await signOutAndReturnHome();
        return;
      }
      toast.success("De sessie is ingetrokken.");
    } catch (error) {
      console.error("Session revoke failed", error);
      toast.error(error instanceof ApiClientError
        ? error.message
        : "De sessie kon niet worden ingetrokken.");
    }
  };

  const requestDeletion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (deletionConfirmation !== "VERWIJDEREN") {
      toast.error("Typ VERWIJDEREN om deze keuze te bevestigen.");
      return;
    }
    try {
      await deletionMutation.mutateAsync({
        confirmation: "VERWIJDEREN",
        idempotencyKey: createClientIdempotencyKey("account-deletion"),
      });
      toast.success("Je account is voor veilige verwijdering ingepland.");
      await signOutAndReturnHome();
    } catch (error) {
      console.error("Account deletion request failed", error);
      toast.error(error instanceof ApiClientError
        ? error.message
        : "Je account kon niet voor verwijdering worden ingepland.");
    }
  };

  const logout = async () => {
    await signOutAndReturnHome();
  };

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-7 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-5 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link to="/profiel" className="mb-2 inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground">← Mijn profiel</Link>
          <h1 className="text-3xl font-bold tracking-tight">Instellingen</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Beheer je profiel, privacy en account.
          </p>
        </div>
        <Button type="button" variant="outline" className="min-h-11 gap-2" onClick={() => void logout()}>
          <LogOut className="h-4 w-4" aria-hidden="true" /> Uitloggen
        </Button>
      </header>

      {adminSession.isSuccess && adminSession.data?.role === "admin" ? (
        <Button asChild variant="outline" className="min-h-11"><Link to="/admin/boeken">Boekbestellingen beheren</Link></Button>
      ) : null}

      <section className="rounded-xl border border-border bg-card p-6 md:p-8" aria-labelledby="profile-settings-title">
        <div className="mb-6 flex items-start gap-4">
          <Avatar className="h-14 w-14 border border-border">
            <AvatarImage src={avatarPreview ?? (avatarRemoved ? "" : profile?.avatar?.proxyPath ?? "")} alt="" />
            <AvatarFallback className="bg-secondary text-xl font-semibold text-primary">
              {profile?.displayName[0]?.toUpperCase() ?? "?"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="profile-settings-title" className="text-base font-semibold">Profiel en privacy</h2>
                <p className="mt-1 text-sm text-muted-foreground">Kies hoe andere bouwers je zien.</p>
              </div>
              {profile && (
                <Button asChild type="button" variant="outline" size="sm" className="min-h-11">
                  <Link to={`/profiel/${profile.slug}`}>Bekijk profiel</Link>
                </Button>
              )}
            </div>
          </div>
        </div>

        {profileQuery.isPending ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Profiel laden…
          </div>
        ) : profileQuery.isError || !profile ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm text-muted-foreground" role="alert">Je profiel kon niet veilig worden geladen.</p>
            <Button type="button" variant="outline" size="sm" className="mt-3 min-h-11" onClick={() => profileQuery.refetch()}>
              Opnieuw proberen
            </Button>
          </div>
        ) : (
          <form onSubmit={saveProfile}>
            <fieldset disabled={savingProfile || profileMutation.isPending} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="profile-avatar">Profielfoto</Label>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="profile-avatar" className="relative inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium focus-within:ring-2 focus-within:ring-ring">
                  <Camera className="h-4 w-4" aria-hidden="true" /> Foto kiezen
                  <input id="profile-avatar" type="file" className="sr-only" accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif" disabled={savingProfile} onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) { setAvatarFile(file); setAvatarRemoved(false); }
                    event.currentTarget.value = "";
                  }} />
                </label>
                {(avatarFile || (profile.avatar && !avatarRemoved)) && <Button type="button" variant="ghost" className="min-h-11" disabled={savingProfile} onClick={() => {
                  setAvatarFile(null); setAvatarRemoved(true); avatarUpload.current = undefined;
                }}>Foto verwijderen</Button>}
              </div>
              <p className="text-xs text-muted-foreground">Je foto wordt opgeslagen met je profielwijzigingen.</p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="profile-display-name">Weergavenaam</Label>
                <Input
                  id="profile-display-name"
                  className="min-h-11"
                  value={draft.displayName}
                  onChange={(event) => setField("displayName", event.target.value)}
                  minLength={1}
                  maxLength={80}
                  autoComplete="name"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-slug">Profielnaam</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">@</span>
                  <Input
                    id="profile-slug"
                    className="min-h-11 pl-7"
                    value={draft.slug}
                    onChange={(event) => setField("slug", event.target.value)}
                    minLength={1}
                    maxLength={80}
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    autoCapitalize="none"
                    autoCorrect="off"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-bio">Over jou</Label>
              <Textarea
                id="profile-bio"
                value={draft.bio}
                onChange={(event) => setField("bio", event.target.value)}
                maxLength={500}
                placeholder="Vertel kort wat je aan het verbouwen bent."
              />
              <p className="text-right text-xs text-muted-foreground">{draft.bio.length}/500</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-location" className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> Plaats of regio
              </Label>
              <Input
                id="profile-location"
                className="min-h-11"
                value={draft.location}
                onChange={(event) => setField("location", event.target.value)}
                maxLength={120}
                autoComplete="address-level2"
                placeholder="Bijvoorbeeld Utrecht"
              />
            </div>

            <div className="flex items-start justify-between gap-5 rounded-lg border bg-muted/30 p-4">
              <div>
                <Label htmlFor="profile-private" className="flex items-center gap-2">
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Privéprofiel
                </Label>
                <p className="mt-1 max-w-lg text-xs leading-relaxed text-muted-foreground">
                  Je keurt volgverzoeken eerst goed. Kies per verbouwing wie mag meekijken.
                </p>
              </div>
              <Switch
                id="profile-private"
                checked={draft.isPrivate}
                onCheckedChange={(checked) => setField("isPrivate", checked)}
                aria-label="Privéprofiel"
              />
            </div>

            <Button type="submit" disabled={savingProfile || profileMutation.isPending} className="min-h-11 gap-2">
              {savingProfile || profileMutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                : <Save className="h-4 w-4" aria-hidden="true" />}
              Profiel opslaan
            </Button>
            </fieldset>
          </form>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-6 md:p-8" aria-labelledby="login-settings-title">
        <div className="mb-6 flex items-start gap-3">
          <UserRound className="mt-0.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <div>
            <h2 id="login-settings-title" className="text-base font-semibold">Login</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Je logt in met je gebruikersnaam en wachtwoord.
            </p>
          </div>
        </div>

        <div className="mb-6 flex items-start gap-3 rounded-lg border bg-muted/20 p-4">
          <UserRound className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Gebruikersnaam</p>
            <p className="mt-1 truncate text-sm">{user.username ?? "Niet ingesteld"}</p>
          </div>
        </div>

      </section>

      <section className="rounded-xl border border-border bg-card p-6 md:p-8" aria-labelledby="sessions-title">
        <div className="mb-5 flex items-start gap-3">
          <MonitorSmartphone className="mt-0.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <div>
            <h2 id="sessions-title" className="text-base font-semibold">Actieve sessies</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Trek apparaten in die je niet herkent. Een recente login is nodig om deze lijst te bekijken.
            </p>
          </div>
        </div>

        {sessionsQuery.isPending ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Sessies laden…
          </div>
        ) : sessionsQuery.isError ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
            <p className="text-sm" role="alert">
              {sessionsQuery.error instanceof ApiClientError
                ? sessionsQuery.error.message
                : "Je sessies konden niet worden geladen."}
            </p>
            <Button className="mt-3 min-h-11" type="button" size="sm" variant="outline" onClick={() => sessionsQuery.refetch()}>
              Opnieuw proberen
            </Button>
          </div>
        ) : (
          <ul className="divide-y rounded-lg border" aria-label="Actieve sessies">
            {sessionsQuery.data.map((session) => (
              <li key={session.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{deviceLabel(session.userAgent)}</p>
                    {session.isCurrent && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                        Dit apparaat
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Gestart {accountDate(session.createdAt)} · verloopt {accountDate(session.expiresAt)}
                    {session.ipAddress ? ` · IP ${session.ipAddress}` : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-11"
                  disabled={revokeSessionMutation.isPending}
                  onClick={() => revokeSession(session.id, session.isCurrent)}
                >
                  {revokeSessionMutation.isPending && revokeSessionMutation.variables === session.id
                    ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    : session.isCurrent ? "Hier uitloggen" : "Sessie intrekken"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {accountLifecycleEnabled ? (
      <section className="rounded-xl border border-border bg-card p-6 md:p-8" aria-labelledby="export-title">
        <div className="mb-5 flex items-start gap-3">
          <FileArchive className="mt-0.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <div>
            <h2 id="export-title" className="text-base font-semibold">Je Buildy-data</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Maak een privé ZIP-archief met een controlemanifest. Het archief verloopt automatisch na zeven dagen.
            </p>
          </div>
        </div>

        <div className="flex items-start justify-between gap-5 rounded-lg border bg-muted/20 p-4">
          <div>
            <Label htmlFor="export-media">Foto&apos;s en bestanden toevoegen</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Zonder media bevat de export nog steeds je profiel, projecten, updates en accountgegevens.
            </p>
          </div>
          <Switch
            id="export-media"
            checked={includeMediaInExport}
            onCheckedChange={setIncludeMediaInExport}
          />
        </div>
        <Button
          type="button"
          className="mt-4 gap-2"
          disabled={createExportMutation.isPending || exportsQuery.data?.some((item) =>
            ["requested", "processing", "retry_scheduled"].includes(item.status))}
          onClick={requestExport}
        >
          {createExportMutation.isPending
            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            : <Download className="h-4 w-4" aria-hidden="true" />}
          Data-export aanvragen
        </Button>

        {exportsQuery.data && exportsQuery.data.length > 0 && (
          <ul className="mt-5 divide-y rounded-lg border" aria-label="Data-exports">
            {exportsQuery.data.map((item) => (
              <li key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">{exportStatusLabels[item.status]}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Aangevraagd {accountDate(item.createdAt)}
                    {item.expiresAt ? ` · beschikbaar tot ${accountDate(item.expiresAt)}` : ""}
                  </p>
                </div>
                {item.downloadPath && (
                  <Button asChild type="button" size="sm" variant="outline" className="min-h-11 gap-2">
                    <a href={item.downloadPath} download>
                      <Download className="h-4 w-4" aria-hidden="true" /> Download
                    </a>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      ) : null}

      {accountLifecycleEnabled ? (
      <details className="group rounded-xl border border-border bg-card px-6 md:px-8">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between text-sm text-muted-foreground [&::-webkit-details-marker]:hidden">
          Account verwijderen <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="pb-6" aria-labelledby="delete-account-title">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <h2 id="delete-account-title" className="text-base font-semibold">Account verwijderen</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Je account en projecten worden meteen afgeschermd. Verwijdering gebeurt daarna gecontroleerd op de achtergrond.
              Gegevens die wettelijk bewaard moeten blijven, worden niet voortijdig verwijderd.
            </p>
          </div>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="outline" className="mt-5 min-h-11 gap-2 text-destructive">
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Account verwijderen
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <form onSubmit={requestDeletion}>
              <AlertDialogHeader>
                <AlertDialogTitle>Weet je dit zeker?</AlertDialogTitle>
                <AlertDialogDescription>
                  Dit is niet ongedaan te maken. Typ VERWIJDEREN om te bevestigen.
                  Uit veiligheid moet je login jonger dan tien minuten zijn.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="my-5 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="delete-confirmation">Typ VERWIJDEREN</Label>
                  <Input
                    id="delete-confirmation"
                    value={deletionConfirmation}
                    onChange={(event) => setDeletionConfirmation(event.target.value)}
                    autoComplete="off"
                  />
                </div>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel type="button">Annuleren</AlertDialogCancel>
                <AlertDialogAction
                  type="submit"
                  disabled={deletionConfirmation !== "VERWIJDEREN" || deletionMutation.isPending}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deletionMutation.isPending
                    ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    : "Definitief verwijderen"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </form>
          </AlertDialogContent>
        </AlertDialog>
        </div>
      </details>
      ) : null}
    </main>
  );
};

export default AccountSettings;
