import { useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "@/lib/router";
import { BookOpen, Check, Eye, EyeOff, Images, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  authClient,
  authErrorDetails,
  authErrorMessage,
  authPagePath,
  safeNextPath,
} from "@/lib/authClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useBetaStatus } from "@/hooks/useBeta";
import BetaBadge from "@/components/BetaBadge";
import { ApiClientError } from "@/lib/apiClient";
import { EMAIL_AUTH_ENABLED, GOOGLE_SIGNIN_ENABLED, SIMPLE_APP_MODE } from "@/lib/appFeatures";
import {
  createBetaReservationKey,
  recordSignupStarted,
  reserveBetaInvite,
} from "@/lib/betaApi";

const GoogleIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8a12 12 0 1 1 0-24c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 1 0 24 44a20 20 0 0 0 19.6-16c.3-1.2.4-2.5.4-3.8 0-1.2-.1-2.5-.4-3.7z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A12 12 0 0 1 12.7 28l-6.5 5A20 20 0 0 0 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2c-.4.4 6.6-4.8 6.6-14.8 0-1.2-.1-2.5-.4-3.5z" />
  </svg>
);

type EmailStatus = "registration" | "verification" | "magic-link" | null;

const Auth = () => {
  usePageMeta({
    title: "Inloggen of registreren — Buildy",
    description: "Log in op Buildy of maak een account om je verbouwing bij te houden en later een Bouwboek te maken.",
    path: "/auth",
    noIndex: true,
  });

  const {
    user,
    loading: authLoading,
    error: sessionError,
    refetchSession,
  } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const nextPath = useMemo(() => safeNextPath(searchParams.get("next")), [searchParams]);
  const [isLogin, setIsLogin] = useState(searchParams.get("mode") !== "register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [emailStatus, setEmailStatus] = useState<EmailStatus>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const reservationAttempt = useRef<{ key: string; signature: string } | null>(null);
  const betaStatusQuery = useBetaStatus();
  const betaMode = betaStatusQuery.data?.betaMode ?? true;

  const authReturnPath = useMemo(() => authPagePath(nextPath), [nextPath]);
  const forgotPasswordPath = nextPath === "/"
    ? "/wachtwoord-vergeten"
    : `/wachtwoord-vergeten?next=${encodeURIComponent(nextPath)}`;
  const verificationReturnPath = useMemo(
    () => authPagePath(nextPath, "verified"),
    [nextPath],
  );
  const callbackError = searchParams.get("error");
  const feedback = callbackError
    ? { tone: "error" as const, message: authErrorMessage({ code: callbackError }, "sign-in") }
    : sessionError
      ? { tone: "error" as const, message: authErrorMessage(sessionError, "session") }
      : searchParams.get("verified") === "1"
        ? { tone: "success" as const, message: "Je e-mailadres is bevestigd. Je kunt nu inloggen." }
        : searchParams.get("reset") === "success"
          ? { tone: "success" as const, message: "Je wachtwoord is gewijzigd. Log opnieuw in." }
          : null;

  const prepareRegistration = async (provider: "email" | "google"): Promise<boolean> => {
    recordSignupStarted(provider);
    if (!betaMode) return true;
    const code = inviteCode.trim();
    if (!code) {
      toast.error("Vul je persoonlijke bèta-uitnodiging in.");
      return false;
    }
    const normalizedEmail = provider === "email" ? email.trim().toLowerCase() : undefined;
    const signature = JSON.stringify({ code, normalizedEmail, provider });
    if (reservationAttempt.current?.signature !== signature) {
      reservationAttempt.current = {
        key: createBetaReservationKey(),
        signature,
      };
    }
    try {
      await reserveBetaInvite({
        inviteCode: code,
        provider,
        ...(normalizedEmail ? { email: normalizedEmail } : {}),
        idempotencyKey: reservationAttempt.current.key,
      });
      return true;
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 429) {
        toast.error("Je hebt dit te vaak geprobeerd. Wacht even en probeer opnieuw.");
      } else {
        toast.error("Deze uitnodiging kan niet worden gebruikt. Vraag zo nodig een nieuwe aan.");
      }
      return false;
    }
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    try {
      if (!isLogin && !await prepareRegistration("google")) return;
      const { data, error } = await authClient.signIn.social({
        callbackURL: nextPath,
        errorCallbackURL: authReturnPath,
        newUserCallbackURL: nextPath,
        provider: "google",
      });
      if (error) {
        console.error("Better Auth Google sign-in failed", authErrorDetails(error));
        toast.error(authErrorMessage(error, "google"));
        return;
      }
      if (data && !data.redirect) {
        await refetchSession();
        navigate(nextPath, { replace: true });
      }
    } catch (error) {
      console.error("Better Auth Google sign-in failed", authErrorDetails(error));
      toast.error(authErrorMessage(error, "google"));
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleMagicLink = async () => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      toast.error("Vul eerst je e-mailadres in.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await authClient.signIn.magicLink({
        callbackURL: nextPath,
        email: normalizedEmail,
        errorCallbackURL: authReturnPath,
        newUserCallbackURL: nextPath,
      });
      if (error) {
        console.error("Better Auth magic-link request failed", authErrorDetails(error));
        toast.error(authErrorMessage(error, "magic-link"));
        return;
      }
      setEmailStatus("magic-link");
    } catch (error) {
      console.error("Better Auth magic-link request failed", authErrorDetails(error));
      toast.error(authErrorMessage(error, "magic-link"));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim();
    const normalizedName = displayName.trim();

    if (!isLogin && normalizedName.length < 2) {
      toast.error("Vul een naam van minimaal 2 tekens in.");
      return;
    }
    if (!isLogin && password.length < 12) {
      toast.error("Gebruik een wachtwoord van minimaal 12 tekens.");
      return;
    }
    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await authClient.signIn.email({
          callbackURL: nextPath,
          email: normalizedEmail,
          password,
        });
        if (error) {
          const details = authErrorDetails(error);
          console.error("Better Auth email sign-in failed", details);
          if (details.code === "EMAIL_NOT_VERIFIED") {
            const verification = await authClient.sendVerificationEmail({
              callbackURL: verificationReturnPath,
              email: normalizedEmail,
            });
            if (!verification.error) {
              setEmailStatus("verification");
              return;
            }
          }
          toast.error(authErrorMessage(error, "sign-in"));
          return;
        }
        await refetchSession();
        navigate(nextPath, { replace: true });
        return;
      }

      if (!await prepareRegistration("email")) return;

      const { error } = await authClient.signUp.email({
        callbackURL: verificationReturnPath,
        email: normalizedEmail,
        name: normalizedName,
        password,
      });
      if (error) {
        console.error("Better Auth email sign-up failed", authErrorDetails(error));
        toast.error(authErrorMessage(error, "sign-up"));
        return;
      }
      if (SIMPLE_APP_MODE) {
        await refetchSession();
        navigate(nextPath, { replace: true });
        return;
      }
      setEmailStatus("registration");
    } catch (error) {
      console.error("Better Auth email flow failed", authErrorDetails(error));
      toast.error(authErrorMessage(error, isLogin ? "sign-in" : "sign-up"));
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setIsLogin((current) => !current);
    setEmailStatus(null);
    setPassword("");
    setInviteCode("");
    reservationAttempt.current = null;
  };

  if (!authLoading && user) return <Navigate to={nextPath} replace />;

  return (
    <div className="bg-background px-5 py-8 sm:px-6 md:py-14">
      <div className="mx-auto grid max-w-5xl overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_80px_-42px_hsl(var(--foreground)/0.28)] lg:min-h-[680px] lg:grid-cols-[0.92fr_1.08fr]">
        <aside className="relative hidden overflow-hidden bg-foreground p-10 text-background lg:flex lg:flex-col lg:justify-between" aria-label="Wat je met Buildy kunt doen">
          <div className="absolute inset-0 opacity-[0.08] blueprint-grid" />
          <div className="relative">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-background/65">Jouw verbouwingsverhaal</p>
            <h2 className="mt-5 max-w-sm font-serif text-5xl italic leading-[0.98]">
              Van eerste schets tot boek op tafel.
            </h2>
            <p className="mt-5 max-w-sm text-sm font-light leading-relaxed text-background/70">
              Eén rustige plek voor de keuzes, foto's en mijlpalen waar je later nog vaak doorheen wilt bladeren.
            </p>
          </div>

          <div className="relative space-y-3">
            {[
              { icon: Images, title: "Leg iedere fase vast", text: "Updates, foto's, planning en budget bij elkaar." },
              { icon: Users, title: "Deel op jouw manier", text: "Houd je project privé of laat anderen meekijken." },
              { icon: BookOpen, title: "Maak een echt Bouwboek", text: "Bundel je tijdlijn later tot een gedrukt fotoboek." },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="flex gap-4 rounded-xl border border-background/10 bg-background/[0.06] p-4 backdrop-blur-sm">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-background/60">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="flex items-center px-5 py-9 sm:px-10 lg:px-14" aria-labelledby="auth-title">
          <div className="mx-auto w-full max-w-md">
            {feedback && !emailStatus && (
              <div
                className={`mb-6 rounded-xl border px-4 py-3 text-sm ${
                  feedback.tone === "success"
                    ? "border-accent/30 bg-accent/10 text-foreground"
                    : "border-destructive/30 bg-destructive/10 text-foreground"
                }`}
                role={feedback.tone === "error" ? "alert" : "status"}
                aria-live="polite"
              >
                {feedback.message}
              </div>
            )}
            {emailStatus ? (
              <div className="text-center" role="status" aria-live="polite">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent/12 text-accent">
                  <Check className="h-6 w-6" aria-hidden="true" />
                </div>
                <p className="eyebrow mt-7">Check je inbox</p>
                <h1 id="auth-title" className="mt-3 font-serif text-4xl italic leading-tight sm:text-5xl">De link is onderweg.</h1>
                <p className="mx-auto mt-4 max-w-sm text-sm font-light leading-relaxed text-muted-foreground">
                  {emailStatus === "registration" || emailStatus === "verification"
                    ? "Bevestig je e-mailadres om je account af te ronden. Daarna kun je meteen je eerste project starten."
                    : "Open de magic link op dit apparaat om veilig in te loggen, zonder wachtwoord."}
                </p>
                <p className="mt-4 break-all text-sm font-semibold text-foreground">{email.trim()}</p>
                <Button type="button" variant="pillOutline" size="pill" className="mt-8" onClick={() => setEmailStatus(null)}>
                  Ander e-mailadres
                </Button>
              </div>
            ) : (
              <>
                <div className="mb-8">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <p className="eyebrow">{isLogin ? "Inloggen" : betaMode ? "Registreren op uitnodiging" : "Gratis beginnen"}</p>
                    {!isLogin ? <BetaBadge /> : null}
                  </div>
                  <h1 id="auth-title" className="font-serif text-4xl italic leading-tight sm:text-5xl">
                    {isLogin ? "Welkom terug." : "Start je dagboek."}
                  </h1>
                  <p className="mt-3 text-sm font-light leading-relaxed text-muted-foreground">
                    {isLogin
                      ? "Ga verder met je verbouwing en Bouwboek."
                      : betaMode
                        ? "Buildy is in private bèta. Met je persoonlijke uitnodiging maak je een account."
                        : "Maak je eerste project. Je kiest zelf wat je deelt."}
                  </p>
                </div>

                {GOOGLE_SIGNIN_ENABLED && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={googleLoading || loading || authLoading}
                      onClick={handleGoogle}
                      className="h-12 w-full rounded-full border-border text-xs font-semibold hover:border-foreground hover:bg-background hover:text-foreground"
                    >
                      <GoogleIcon />
                      {googleLoading ? "Even wachten…" : isLogin ? "Inloggen met Google" : "Registreren met Google"}
                    </Button>

                    <div className="my-6 flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground" aria-hidden="true">
                      <span className="h-px flex-1 bg-border" />
                      <span>of met e-mail</span>
                      <span className="h-px flex-1 bg-border" />
                    </div>
                  </>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  {!isLogin && betaMode && (
                    <div className="space-y-2">
                      <Label htmlFor="beta-invite" className="text-xs font-semibold">Bèta-uitnodiging</Label>
                      <Input
                        id="beta-invite"
                        name="invite"
                        autoComplete="one-time-code"
                        placeholder="BLDY_…"
                        value={inviteCode}
                        onChange={(event) => {
                          setInviteCode(event.target.value);
                          reservationAttempt.current = null;
                        }}
                        required
                        minLength={37}
                        maxLength={37}
                        spellCheck={false}
                        className="h-12 rounded-lg bg-background font-mono"
                      />
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        Je code wordt alleen gebruikt om deze registratie te autoriseren en verschijnt nooit in je profiel.
                      </p>
                    </div>
                  )}
                  {!isLogin && (
                    <div className="space-y-2">
                      <Label htmlFor="display-name" className="text-xs font-semibold">Naam</Label>
                      <Input
                        id="display-name"
                        name="name"
                        autoComplete="name"
                        placeholder="Bijv. Sol"
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        required
                        minLength={2}
                        maxLength={60}
                        className="h-12 rounded-lg bg-background"
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="auth-email" className="text-xs font-semibold">E-mailadres</Label>
                    <Input
                      id="auth-email"
                      name="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="jij@voorbeeld.nl"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                      className="h-12 rounded-lg bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="auth-password" className="text-xs font-semibold">Wachtwoord</Label>
                      {isLogin && EMAIL_AUTH_ENABLED && (
                        <Link to={forgotPasswordPath} className="text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground">
                          Wachtwoord vergeten?
                        </Link>
                      )}
                    </div>
                    <div className="relative">
                      <Input
                        id="auth-password"
                        name="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete={isLogin ? "current-password" : "new-password"}
                        placeholder={isLogin ? "Je wachtwoord" : "Minimaal 12 tekens"}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        required
                        minLength={isLogin ? 1 : 12}
                        maxLength={128}
                        className="h-12 rounded-lg bg-background pr-12"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((visible) => !visible)}
                        className="absolute right-1 top-1 flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={showPassword ? "Verberg wachtwoord" : "Toon wachtwoord"}
                        aria-pressed={showPassword}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <Button type="submit" variant="pill" disabled={loading || googleLoading || authLoading} className="h-12 w-full">
                    {loading ? "Even wachten…" : isLogin ? "Inloggen" : "Account aanmaken"}
                  </Button>
                  {isLogin && EMAIL_AUTH_ENABLED && (
                    <Button type="button" variant="pillOutline" disabled={loading || googleLoading || authLoading} onClick={handleMagicLink} className="h-12 w-full">
                      Stuur magic link
                    </Button>
                  )}
                </form>

                <p className="mt-7 text-center text-sm text-muted-foreground">
                  {isLogin ? "Nog geen account? " : "Al een account? "}
                  <button onClick={switchMode} className="rounded-sm font-semibold text-foreground underline underline-offset-4 transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {isLogin ? "Registreer" : "Inloggen"}
                  </button>
                </p>
                {!isLogin && (
                  <p className="mt-5 text-center text-[11px] leading-relaxed text-muted-foreground">
                    Door een account te maken ga je akkoord met onze <Link to="/voorwaarden" className="underline underline-offset-2 hover:text-foreground">voorwaarden</Link>. Lees in de <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">privacyverklaring</Link> hoe we je gegevens verwerken.
                  </p>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default Auth;
