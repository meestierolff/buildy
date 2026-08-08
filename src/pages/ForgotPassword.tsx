import { useState } from "react";
import { Link, useSearchParams } from "@/lib/router";
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

const ForgotPassword = () => {
  usePageMeta({
    title: "Wachtwoord vergeten — Buildy",
    description: "Vraag een nieuwe wachtwoord-link aan voor je Buildy account.",
    path: "/wachtwoord-vergeten",
    noIndex: true,
  });
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [searchParams] = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const resetPath = nextPath === "/"
    ? "/wachtwoord-resetten"
    : `/wachtwoord-resetten?next=${encodeURIComponent(nextPath)}`;
  const loginPath = authPagePath(nextPath);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;
    setLoading(true);
    try {
      const { error } = await authClient.requestPasswordReset({
        email: normalizedEmail,
        redirectTo: resetPath,
      });
      if (error) {
        console.error("Better Auth password-reset request failed", authErrorDetails(error));
        toast.error(authErrorMessage(error, "forgot-password"));
        return;
      }
      setEmail(normalizedEmail);
      setSent(true);
      toast.success("Als dit adres bij Buildy bekend is, staat de reset-link zo in je inbox.");
    } catch (error) {
      console.error("Better Auth password-reset request failed", authErrorDetails(error));
      toast.error(authErrorMessage(error, "forgot-password"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <p className="eyebrow mb-4">Wachtwoord vergeten</p>
          <h1 className="font-serif italic text-4xl leading-tight">Geen probleem.</h1>
          <p className="text-sm text-muted-foreground mt-4 font-light">
            Vul je e-mail in, dan sturen we je een link om een nieuw wachtwoord in te stellen.
          </p>
        </div>

        {sent ? (
          <div className="text-center space-y-4">
            <p className="text-sm">
              Als <strong>{email}</strong> bij Buildy bekend is, ontvang je een link om je wachtwoord
              opnieuw in te stellen. De link is één uur geldig.
            </p>
            <Link to={loginPath} className="text-xs uppercase tracking-[0.2em] font-bold underline underline-offset-4">
              Terug naar inloggen
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="forgot-password-email">E-mailadres</Label>
              <Input
                id="forgot-password-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="jij@voorbeeld.nl"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-11"
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-full text-[11px] font-bold uppercase tracking-[0.15em] bg-foreground text-background hover:bg-foreground/90"
            >
              {loading ? "Even wachten…" : "Stuur reset-link"}
            </Button>
            <p className="text-center text-xs text-muted-foreground mt-4">
              <Link to={loginPath} className="hover:text-foreground underline underline-offset-4">
                Terug naar inloggen
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
};

export default ForgotPassword;
