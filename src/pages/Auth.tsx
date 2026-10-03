import { useMemo, useState, type FormEvent } from "react";
import { BookOpen, Eye, EyeOff, Images, Loader2, Users } from "lucide-react";
import { MIN_PASSWORD_LENGTH, usernameSchema, usernameSignInInputSchema, usernameSignUpInputSchema } from "../../shared/contracts/auth";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { usePageMeta } from "@/hooks/usePageMeta";
import {
  authClient,
  authErrorMessage,
  safeNextPath,
} from "@/lib/authClient";
import { useAppFeatures } from "@/lib/appFeatures";
import { Link, Navigate, useSearchParams } from "@/lib/router";

const Auth = () => {
  usePageMeta({
    title: "Inloggen — Buildy",
    description: "Log in of maak een account om je verbouwing en Bouwboek bij te houden.",
    path: "/auth",
    noIndex: true,
  });

  const { user, loading: authLoading, error: sessionError, refetchSession } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const nextPath = useMemo(() => safeNextPath(searchParams.get("next")), [searchParams]);
  const registering = searchParams.get("mode") === "register";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});
  const [destination, setDestination] = useState<string | null>(null);
  const suggestedUsername = username.includes("@") ? usernameSchema.safeParse(username.split("@")[0]) : null;
  const { passwordSignInEnabled } = useAppFeatures();
  const feedback = formError ?? (sessionError
      ? authErrorMessage(sessionError, "session")
      : null);

  const switchMode = () => {
    const next = new URLSearchParams(searchParams);
    if (registering) next.delete("mode");
    else next.set("mode", "register");
    setSearchParams(next, { replace: true });
    setPassword("");
    setShowPassword(false);
    setFormError(null);
    setFieldErrors({});
  };

  const changeUsername = (value: string) => {
    setUsername(value);
    setFieldErrors((current) => ({ ...current, username: undefined }));
    setFormError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!passwordSignInEnabled || submitting) return;
    setFormError(null);
    setFieldErrors({});
    const schema = registering ? usernameSignUpInputSchema : usernameSignInInputSchema;
    const parsed = schema.safeParse({ username, password, next: nextPath });
    if (!parsed.success) {
      const usernameIssue = parsed.error.issues.find((issue) => issue.path[0] === "username");
      const passwordIssue = parsed.error.issues.find((issue) => issue.path[0] === "password");
      setFieldErrors({
        username: usernameIssue ? (username.includes("@")
          ? "Gebruik een gebruikersnaam, geen e-mailadres."
          : "Gebruik 3–32 tekens: letters, cijfers, punten, streepjes of underscores. Begin met een letter of cijfer.") : undefined,
        password: passwordIssue ? (registering
          ? `Kies een wachtwoord van ${MIN_PASSWORD_LENGTH} tot 128 tekens.`
          : "Vul je wachtwoord in (maximaal 128 tekens).") : undefined,
      });
      const field = event.currentTarget.elements.namedItem(usernameIssue ? "username" : "password");
      if (field instanceof HTMLInputElement) field.focus();
      return;
    }
    setSubmitting(true);
    try {
      const credentials = { username, password, next: nextPath };
      const next = await (registering ? authClient.signUp(credentials) : authClient.signIn(credentials));
      setDestination(safeNextPath(next));
      setPassword("");
      const refreshed = await refetchSession();
      if (!refreshed?.user || !refreshed.session) {
        setFormError("Je sessie kon niet worden bevestigd. Probeer opnieuw in te loggen.");
      }
    } catch (error) {
      setFormError(authErrorMessage(error, registering ? "sign-up" : "sign-in"));
    } finally {
      setSubmitting(false);
    }
  };

  if (!authLoading && user) return <Navigate to={destination ?? nextPath} replace />;

  return (
    <main className="bg-background px-5 py-8 sm:px-6 md:py-14">
      <div className="mx-auto grid max-w-5xl overflow-hidden border border-border bg-card shadow-[0_24px_80px_-42px_hsl(var(--foreground)/0.28)] lg:min-h-[640px] lg:grid-cols-[0.92fr_1.08fr]">
        <aside
          className="relative hidden overflow-hidden bg-foreground p-10 text-background lg:flex lg:flex-col lg:justify-between"
          aria-label="Wat je met Buildy kunt doen"
        >
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-background/65">Jouw verbouwingsverhaal</p>
            <h2 className="mt-5 max-w-sm font-serif text-5xl leading-[0.98]">Van eerste foto tot Bouwboek.</h2>
            <p className="mt-5 max-w-sm text-sm font-light leading-relaxed text-background/70">
              Leg ieder Bouwmoment vast, laat je dierbaren meekijken en bewaar het hele verhaal op één rustige plek.
            </p>
          </div>
          <ul className="divide-y divide-background/15 border-y border-background/15">
            {[
              { icon: Images, title: "Vastleggen", text: "Foto's en korte updates vormen samen je Verhaal." },
              { icon: Users, title: "Samen beleven", text: "Jij kiest wie veilig mag meekijken en reageren." },
              { icon: BookOpen, title: "Bewaren", text: "Je Bouwboek groeit automatisch met je verbouwing mee." },
            ].map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4 py-4">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-background/60">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </aside>

        <section className="flex items-center px-5 py-10 sm:px-10 lg:px-14" aria-labelledby="auth-title">
          <div className="mx-auto w-full max-w-md">
            {feedback ? (
              <div className="mb-6 border-l-2 border-destructive bg-destructive/10 px-4 py-3 text-sm text-foreground" role="alert">
                {feedback}
              </div>
            ) : null}

            <div className="mb-8">
              <p className="eyebrow">{registering ? "Een plek voor jouw verhaal" : "Welkom terug"}</p>
              <h1 id="auth-title" className="mt-3 font-serif text-4xl leading-tight sm:text-5xl">
                {registering ? "Je verhaal begint hier." : "Ga verder met je verbouwverhaal."}
              </h1>
              <p className="mt-4 text-sm font-light leading-relaxed text-muted-foreground">
                {registering
                  ? "Kies een gebruikersnaam en wachtwoord. Je verbouwing begint privé."
                  : "Log in met je gebruikersnaam en wachtwoord. Je verhaal wacht op je."}
              </p>
            </div>

            {passwordSignInEnabled ? (
              <form method="post" onSubmit={(event) => void handleSubmit(event)} className="space-y-5" aria-label={registering ? "Account maken" : "Inloggen"} aria-busy={submitting} noValidate>
                <div className="space-y-2">
                  <Label htmlFor="auth-username">Gebruikersnaam</Label>
                  <Input id="auth-username" name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="jouwnaam" value={username} onChange={(event) => changeUsername(event.target.value)} disabled={submitting} maxLength={32} required aria-invalid={Boolean(fieldErrors.username)} aria-describedby={`auth-username-help${fieldErrors.username ? " auth-username-error" : ""}`} className="h-12" />
                  <p id="auth-username-help" className="text-xs leading-relaxed text-muted-foreground">{registering ? "Kies een naam zonder spaties. Je e-mailadres is niet nodig." : "Je gebruikersnaam, zonder e-mailadres."}</p>
                  {suggestedUsername?.success ? (
                    <button type="button" onClick={() => changeUsername(suggestedUsername.data)} disabled={submitting} className="text-sm font-medium underline underline-offset-4 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      Gebruik {suggestedUsername.data}
                    </button>
                  ) : null}
                  {fieldErrors.username ? <p id="auth-username-error" role="alert" className="text-xs text-destructive">{fieldErrors.username}</p> : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="auth-password">Wachtwoord</Label>
                  <div className="relative">
                    <Input id="auth-password" name="password" type={showPassword ? "text" : "password"} autoComplete={registering ? "new-password" : "current-password"} value={password} onChange={(event) => { setPassword(event.target.value); setFieldErrors((current) => ({ ...current, password: undefined })); setFormError(null); }} disabled={submitting} minLength={registering ? MIN_PASSWORD_LENGTH : 1} maxLength={256} required aria-invalid={Boolean(fieldErrors.password)} aria-describedby={[registering && "auth-password-help", fieldErrors.password && "auth-password-error"].filter(Boolean).join(" ") || undefined} className="h-12 pr-12" />
                    <button type="button" onClick={() => setShowPassword((shown) => !shown)} aria-label={showPassword ? "Wachtwoord verbergen" : "Wachtwoord tonen"} aria-pressed={showPassword} className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={submitting}>
                      {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  </div>
                  {registering ? <p id="auth-password-help" className="text-xs leading-relaxed text-muted-foreground">Minimaal {MIN_PASSWORD_LENGTH} tekens.</p> : null}
                  {fieldErrors.password ? <p id="auth-password-error" role="alert" className="text-xs text-destructive">{fieldErrors.password}</p> : null}
                </div>
                <Button type="submit" disabled={submitting || authLoading} className="h-12 w-full rounded-full text-sm font-semibold">
                  {submitting ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Even wachten…</> : registering ? "Account maken" : "Inloggen"}
                </Button>
                <p className="text-center text-sm text-muted-foreground">
                  {registering ? "Al een account?" : "Voor het eerst hier?"}{" "}
                  <button type="button" onClick={switchMode} disabled={submitting} className="font-semibold text-foreground underline underline-offset-4 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{registering ? "Inloggen" : "Account maken"}</button>
                </p>
              </form>
            ) : (
              <div className="border-l-2 border-border bg-muted/20 p-4 text-sm text-muted-foreground" role="status">
                Inloggen is in deze omgeving nog niet beschikbaar.
              </div>
            )}

            <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">
              Door verder te gaan accepteer je onze{" "}
              <Link to="/voorwaarden" className="underline underline-offset-2 hover:text-foreground">voorwaarden</Link>
              {" "}en lees je in de{" "}
              <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">privacyverklaring</Link>
              {" "}hoe we je gegevens beschermen.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
};

export default Auth;
