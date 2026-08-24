import { useMemo, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "@/lib/router";
import { BookOpen, Images, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  authClient,
  authErrorDetails,
  authErrorMessage,
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
import { useAppFeatures } from "@/lib/appFeatures";
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

const Auth = () => {
  usePageMeta({
    title: "Inloggen of registreren — Buildy",
    description: "Log veilig in met Google om je verbouwing en Bouwboek bij te houden.",
    path: "/auth",
    noIndex: true,
  });

  const { user, loading: authLoading, error: sessionError } = useAuth();
  const [searchParams] = useSearchParams();
  const nextPath = useMemo(() => safeNextPath(searchParams.get("next")), [searchParams]);
  const [isLogin, setIsLogin] = useState(searchParams.get("mode") !== "register");
  const [googleLoading, setGoogleLoading] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const reservationAttempt = useRef<{ key: string; signature: string } | null>(null);
  const betaStatusQuery = useBetaStatus();
  const appFeatures = useAppFeatures();
  const betaMode = betaStatusQuery.data?.betaMode ?? appFeatures.betaMode;
  const googleSignInEnabled = appFeatures.googleSignInEnabled;
  const callbackError = searchParams.get("error");
  const feedback = callbackError
    ? authErrorMessage({ code: callbackError }, "google")
    : sessionError
      ? authErrorMessage(sessionError, "session")
      : null;

  const prepareRegistration = async (): Promise<boolean> => {
    recordSignupStarted("google");
    if (!betaMode) return true;
    const code = inviteCode.trim();
    if (!code) {
      toast.error("Vul je persoonlijke bèta-uitnodiging in.");
      return false;
    }
    if (reservationAttempt.current?.signature !== code) {
      reservationAttempt.current = { key: createBetaReservationKey(), signature: code };
    }
    try {
      await reserveBetaInvite({
        inviteCode: code,
        provider: "google",
        idempotencyKey: reservationAttempt.current.key,
      });
      return true;
    } catch (error) {
      toast.error(
        error instanceof ApiClientError && error.status === 429
          ? "Je hebt dit te vaak geprobeerd. Wacht even en probeer opnieuw."
          : "Deze uitnodiging kan niet worden gebruikt. Vraag zo nodig een nieuwe aan.",
      );
      return false;
    }
  };

  const handleGoogle = async () => {
    if (!googleSignInEnabled) {
      toast.error("Google-login is nu niet beschikbaar.");
      return;
    }
    setGoogleLoading(true);
    try {
      if (!isLogin && !await prepareRegistration()) return;
      const authorizationUrl = await authClient.beginGoogleSignIn(nextPath);
      window.location.assign(authorizationUrl);
    } catch (error) {
      console.error("Google sign-in failed", authErrorDetails(error));
      toast.error(authErrorMessage(error, "google"));
    } finally {
      setGoogleLoading(false);
    }
  };

  const switchMode = () => {
    setIsLogin((current) => !current);
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
            <h2 className="mt-5 max-w-sm font-serif text-5xl italic leading-[0.98]">Van eerste schets tot boek op tafel.</h2>
            <p className="mt-5 max-w-sm text-sm font-light leading-relaxed text-background/70">
              Eén rustige plek voor de keuzes, foto&apos;s en mijlpalen waar je later nog vaak doorheen wilt bladeren.
            </p>
          </div>
          <div className="relative space-y-3">
            {[
              { icon: Images, title: "Leg iedere fase vast", text: "Bouwmomenten, foto's, planning en budget bij elkaar." },
              { icon: Users, title: "Deel op jouw manier", text: "Houd je verbouwing privé of laat anderen meekijken." },
              { icon: BookOpen, title: "Maak een echt Bouwboek", text: "Bundel je Verhaal later tot een gedrukt Bouwboek." },
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
            {feedback ? (
              <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-foreground" role="alert">
                {feedback}
              </div>
            ) : null}
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
                  ? "Ga veilig verder met je verbouwing en Bouwboek."
                  : betaMode
                    ? "Gebruik je persoonlijke uitnodiging en kies daarna je Google-account."
                    : "Kies je Google-account en maak je eerste verbouwing."}
              </p>
            </div>

            {!isLogin && betaMode ? (
              <div className="mb-5 space-y-2">
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
              </div>
            ) : null}

            {googleSignInEnabled ? (
              <Button
                type="button"
                variant="outline"
                disabled={googleLoading || authLoading}
                onClick={handleGoogle}
                className="h-12 w-full rounded-full border-border text-xs font-semibold hover:border-foreground hover:bg-background hover:text-foreground"
              >
                <GoogleIcon />
                {googleLoading ? "Even wachten…" : isLogin ? "Inloggen met Google" : "Registreren met Google"}
              </Button>
            ) : (
              <div className="rounded-xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground" role="status">
                Inloggen is nog niet beschikbaar in deze omgeving.
              </div>
            )}

            <p className="mt-7 text-center text-sm text-muted-foreground">
              {isLogin ? "Nog geen account? " : "Al een account? "}
              <button type="button" onClick={switchMode} className="rounded-sm font-semibold text-foreground underline underline-offset-4 transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {isLogin ? "Registreer" : "Inloggen"}
              </button>
            </p>
            {!isLogin ? (
              <p className="mt-5 text-center text-[11px] leading-relaxed text-muted-foreground">
                Door een account te maken ga je akkoord met onze <Link to="/voorwaarden" className="underline underline-offset-2 hover:text-foreground">voorwaarden</Link>. Lees in de <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">privacyverklaring</Link> hoe we je gegevens verwerken.
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
};

export default Auth;
