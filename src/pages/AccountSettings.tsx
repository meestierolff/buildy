import { useEffect, useState, type FormEvent } from "react";
import {
  Download,
  FileArchive,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  MapPin,
  MonitorSmartphone,
  Save,
  ShieldAlert,
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
import { usePageMeta } from "@/hooks/usePageMeta";
import { useAppFeatures } from "@/lib/appFeatures";
import { ApiClientError } from "@/lib/apiClient";
import { authClient, authErrorMessage } from "@/lib/authClient";
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
  const emailAuthEnabled = appFeatures.emailAuthEnabled;
  usePageMeta({
    title: "Account & instellingen — Buildy",
    description: "Beheer je profiel, privacy en wachtwoord.",
    path: "/account",
    noIndex: true,
  });
  const { user, loading: authLoading, signOut } = useAuth();
  const profileQuery = useOwnProfile(Boolean(user));
  const profileMutation = useUpdateOwnProfileMutation();
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY_PROFILE);
  const [draftVersion, setDraftVersion] = useState<number | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [includeMediaInExport, setIncludeMediaInExport] = useState(true);
  const [deletionConfirmation, setDeletionConfirmation] = useState("");
  const [deletionPassword, setDeletionPassword] = useState("");
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

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Account laden…</span>
      </div>
    );
  }

  if (!user) return <Navigate to="/auth?next=/account" replace />;

  const setField = <Key extends keyof ProfileDraft>(key: Key, value: ProfileDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile) return;

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

    if (Object.keys(changes).length === 0) {
      toast.info("Er zijn geen profielwijzigingen om op te slaan.");
      return;
    }

    try {
      await profileMutation.mutateAsync({
        idempotencyKey: createClientIdempotencyKey("profile-update"),
        expectedVersion: profile.version,
        ...changes,
      });
      toast.success("Je profiel is bijgewerkt.");
    } catch (error) {
      console.error("Profile settings update failed", error);
      toast.error(
        error instanceof ApiClientError
          ? error.message
          : "Je profiel kon niet worden opgeslagen. Probeer het opnieuw.",
      );
    }
  };

  const sendPasswordReset = async () => {
    if (!user.email) return;
    setSendingReset(true);
    try {
      const { error } = await authClient.requestPasswordReset({
        email: user.email,
        redirectTo: `${window.location.origin}/wachtwoord-resetten`,
      });
      if (error) throw error;
      toast.success("Als dit account een wachtwoord heeft, ontvang je zo een reset-link.");
    } catch (error) {
      console.error("Password reset request failed", error);
      toast.error(authErrorMessage(error, "forgot-password"));
    } finally {
      setSendingReset(false);
    }
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword.length < 12) {
      toast.error("Gebruik een nieuw wachtwoord van minimaal 12 tekens.");
      return;
    }
    if (!currentPassword) {
      toast.error("Vul je huidige wachtwoord in.");
      return;
    }

    setSavingPassword(true);
    try {
      const { error } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: false,
      });
      if (error) throw error;
      setCurrentPassword("");
      setNewPassword("");
      toast.success("Je wachtwoord is bijgewerkt.");
    } catch (error) {
      console.error("Password change failed", error);
      toast.error(authErrorMessage(error, "reset-password"));
    } finally {
      setSavingPassword(false);
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

  const revokeSession = async (sessionId: string, isCurrent: boolean) => {
    try {
      await revokeSessionMutation.mutateAsync(sessionId);
      if (isCurrent) {
        await signOut();
        window.location.assign("/");
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
        ...(deletionPassword ? { currentPassword: deletionPassword } : {}),
        idempotencyKey: createClientIdempotencyKey("account-deletion"),
      });
      toast.success("Je account is voor veilige verwijdering ingepland.");
      await signOut();
      window.location.assign("/");
    } catch (error) {
      console.error("Account deletion request failed", error);
      toast.error(error instanceof ApiClientError
        ? error.message
        : "Je account kon niet voor verwijdering worden ingepland.");
    }
  };

  return (
    <main className="mx-auto max-w-3xl space-y-10 px-6 py-12 md:py-16">
      <header>
        <p className="eyebrow mb-2">Account</p>
        <h1 className="font-serif text-4xl italic leading-tight">Instellingen</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Beheer wat andere bouwers van je zien en houd je login veilig.
        </p>
      </header>

      <section className="rounded-xl border border-border bg-card p-6 md:p-8" aria-labelledby="profile-settings-title">
        <div className="mb-6 flex items-start gap-4">
          <Avatar className="h-14 w-14 border border-border">
            <AvatarImage src={profile?.avatar?.proxyPath ?? ""} alt="" />
            <AvatarFallback className="font-serif text-xl italic">
              {profile?.displayName[0]?.toUpperCase() ?? "?"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="profile-settings-title" className="text-base font-semibold">Profiel en privacy</h2>
                <p className="mt-1 text-sm text-muted-foreground">Deze gegevens komen uit je afgeschermde Buildy-profiel.</p>
              </div>
              {profile && (
                <Button asChild type="button" variant="outline" size="sm">
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
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => profileQuery.refetch()}>
              Opnieuw proberen
            </Button>
          </div>
        ) : (
          <form className="space-y-5" onSubmit={saveProfile}>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="profile-display-name">Weergavenaam</Label>
                <Input
                  id="profile-display-name"
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
                    className="pl-7"
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
                  Alleen geaccepteerde volgers kunnen je profielgegevens bekijken. Blokkades blijven altijd leidend.
                </p>
              </div>
              <Switch
                id="profile-private"
                checked={draft.isPrivate}
                onCheckedChange={(checked) => setField("isPrivate", checked)}
                aria-label="Privéprofiel"
              />
            </div>

            <Button type="submit" disabled={profileMutation.isPending} className="gap-2">
              {profileMutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                : <Save className="h-4 w-4" aria-hidden="true" />}
              Profiel opslaan
            </Button>
          </form>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-6 md:p-8" aria-labelledby="login-settings-title">
        <div className="mb-6 flex items-start gap-3">
          <UserRound className="mt-0.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <div>
            <h2 id="login-settings-title" className="text-base font-semibold">Login</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {emailAuthEnabled
                ? "Je login wordt beheerd door de beveiligde Buildy-authenticatie."
                : "Je logt in met Google. Wachtwoord- en e-maillogin zijn in deze bèta niet actief."}
            </p>
          </div>
        </div>

        <div className="mb-6 flex items-start gap-3 rounded-lg border bg-muted/20 p-4">
          <Mail className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">E-mail</p>
            <p className="mt-1 truncate text-sm">{user.email}</p>
          </div>
        </div>

        {emailAuthEnabled ? (
        <form onSubmit={changePassword} className="space-y-4">
          <div className="flex items-start gap-3">
            <KeyRound className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <div>
              <h3 className="text-sm font-semibold">Wachtwoord wijzigen</h3>
              <p className="mt-1 text-xs text-muted-foreground">Gebruik minimaal 12 tekens. Andere sessies blijven ongewijzigd.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="current-password">Huidig wachtwoord</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">Nieuw wachtwoord</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={savingPassword || !currentPassword || !newPassword}>
              {savingPassword ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Wachtwoord opslaan"}
            </Button>
            {emailAuthEnabled ? (
              <Button type="button" variant="outline" size="sm" disabled={sendingReset} onClick={sendPasswordReset}>
                {sendingReset ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Stuur reset-link"}
              </Button>
            ) : null}
          </div>
        </form>
        ) : null}
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
            <Button className="mt-3" type="button" size="sm" variant="outline" onClick={() => sessionsQuery.refetch()}>
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
                  <Button asChild type="button" size="sm" variant="outline" className="gap-2">
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
      <section className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 md:p-8" aria-labelledby="delete-account-title">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 text-destructive" aria-hidden="true" />
          <div className="flex-1">
            <h2 id="delete-account-title" className="text-base font-semibold">Account verwijderen</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Je account en projecten worden meteen afgeschermd. Verwijdering gebeurt daarna gecontroleerd op de achtergrond.
              Lopende bouwboekbestellingen blokkeren de aanvraag; wettelijke bestelgegevens blijven minimaal bewaard.
            </p>
          </div>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="destructive" className="mt-5 gap-2">
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Account verwijderen
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <form onSubmit={requestDeletion}>
              <AlertDialogHeader>
                <AlertDialogTitle>Weet je dit zeker?</AlertDialogTitle>
                <AlertDialogDescription>
                  Dit is niet ongedaan te maken. Typ VERWIJDEREN en bevestig zo nodig je wachtwoord.
                  Bij een zeer recente login mag het wachtwoordveld leeg blijven.
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
                <div className="space-y-2">
                  <Label htmlFor="delete-password">Huidig wachtwoord (indien van toepassing)</Label>
                  <Input
                    id="delete-password"
                    type="password"
                    value={deletionPassword}
                    onChange={(event) => setDeletionPassword(event.target.value)}
                    autoComplete="current-password"
                    maxLength={128}
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
      </section>
      ) : null}
    </main>
  );
};

export default AccountSettings;
