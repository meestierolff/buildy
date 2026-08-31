import { useMemo, useState } from "react";
import { BookOpen, Images, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { usePageMeta } from "@/hooks/usePageMeta";
import {
  authClient,
  authErrorDetails,
  authErrorMessage,
  safeNextPath,
} from "@/lib/authClient";
import { useAppFeatures } from "@/lib/appFeatures";
import { Link, Navigate, useSearchParams } from "@/lib/router";

const GoogleIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8a12 12 0 1 1 0-24c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 1 0 24 44a20 20 0 0 0 19.6-16c.3-1.2.4-2.5.4-3.8 0-1.2-.1-2.5-.4-3.7z" />
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A12 12 0 0 1 12.7 28l-6.5 5A20 20 0 0 0 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2c-.4.4 6.6-4.8 6.6-14.8 0-1.2-.1-2.5-.4-3.5z" />
  </svg>
);

const Auth = () => {
  usePageMeta({
    title: "Doorgaan met Google — Buildy",
    description: "Log veilig in met Google om je verbouwing en Bouwboek bij te houden.",
    path: "/auth",
    noIndex: true,
  });

  const { user, loading: authLoading, error: sessionError } = useAuth();
  const [searchParams] = useSearchParams();
  const nextPath = useMemo(() => safeNextPath(searchParams.get("next")), [searchParams]);
  const [googleLoading, setGoogleLoading] = useState(false);
  const { googleSignInEnabled } = useAppFeatures();
  const callbackError = searchParams.get("error");
  const feedback = callbackError
    ? authErrorMessage({ code: callbackError }, "google")
    : sessionError
      ? authErrorMessage(sessionError, "session")
      : null;

  const handleGoogle = async () => {
    if (!googleSignInEnabled) {
      toast.error("Google-login is nu niet beschikbaar.");
      return;
    }

    setGoogleLoading(true);
    try {
      const authorizationUrl = await authClient.beginGoogleSignIn(nextPath);
      window.location.assign(authorizationUrl);
    } catch (error) {
      console.error("Google sign-in failed", authErrorDetails(error));
      toast.error(authErrorMessage(error, "google"));
    } finally {
      setGoogleLoading(false);
    }
  };

  if (!authLoading && user) return <Navigate to={nextPath} replace />;

  return (
    <div className="bg-background px-5 py-8 sm:px-6 md:py-14">
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
              <p className="eyebrow">Inloggen of beginnen</p>
              <h1 id="auth-title" className="mt-3 font-serif text-4xl leading-tight sm:text-5xl">
                Ga verder met je verbouwverhaal.
              </h1>
              <p className="mt-4 text-sm font-light leading-relaxed text-muted-foreground">
                Kies je Google-account. We herkennen vanzelf of je al een Buildy-account hebt.
              </p>
            </div>

            {googleSignInEnabled ? (
              <Button
                type="button"
                variant="outline"
                disabled={googleLoading || authLoading}
                onClick={() => void handleGoogle()}
                className="h-12 w-full rounded-full border-border text-sm font-semibold hover:border-foreground hover:bg-background hover:text-foreground"
              >
                <GoogleIcon />
                {googleLoading ? "Even wachten…" : "Doorgaan met Google"}
              </Button>
            ) : (
              <div className="border-l-2 border-border bg-muted/20 p-4 text-sm text-muted-foreground" role="status">
                Google-login is in deze omgeving nog niet beschikbaar.
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
    </div>
  );
};

export default Auth;
