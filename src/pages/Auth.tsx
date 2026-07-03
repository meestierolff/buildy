import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import BrandLogo from "@/components/BrandLogo";
import { toast } from "sonner";
import { usePageMeta } from "@/hooks/usePageMeta";

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
    description: "Log in op Buildy of maak een account om je verbouwing bij te houden en later een Bouwboek te maken.",
    path: "/auth",
    noIndex: true,
  });
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const navigate = useNavigate();

  const handleGoogle = async () => {
    setGoogleLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("Google login mislukt. Probeer het opnieuw.");
      setGoogleLoading(false);
      return;
    }
    if (result.redirected) return; // browser navigates away
    navigate("/");
  };

  const handleMagicLink = async () => {
    if (!email.trim()) {
      toast.error("Vul eerst je e-mailadres in.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) toast.error("Kon geen magic link sturen. Controleer je e-mailadres.");
    else toast.success("Magic link verstuurd. Check je inbox om in te loggen.");
    setLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    if (isLogin) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) toast.error("Ongeldige inloggegevens. Controleer je e-mail en wachtwoord.");
      else navigate("/");
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName }, emailRedirectTo: window.location.origin },
      });
      if (error) toast.error("Registratie is niet gelukt. Probeer het opnieuw of gebruik een ander e-mailadres.");
      else toast.success("Check je e-mail om je account te bevestigen!");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="text-center mb-12">
          <BrandLogo className="mb-10" imageClassName="h-10 w-10 rounded-xl" textClassName="text-xl" />
          <p className="eyebrow mb-4">{isLogin ? "Inloggen" : "Registreren"}</p>
          <h1 className="font-serif italic text-4xl md:text-5xl leading-tight">
            {isLogin ? "Welkom terug." : "Start je dagboek."}
          </h1>
          <p className="text-sm text-muted-foreground mt-4 font-light">
            {isLogin ? "Log in om je verbouwingen te volgen." : "Leg elke fase van je verbouwing vast."}
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          disabled={googleLoading || loading}
          onClick={handleGoogle}
          className="w-full h-11 rounded-full text-[12px] font-semibold border-border gap-2 mb-4"
        >
          <GoogleIcon />
          {googleLoading ? "Even wachten…" : isLogin ? "Inloggen met Google" : "Registreren met Google"}
        </Button>

        <div className="flex items-center gap-3 mb-4 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          <span className="flex-1 h-px bg-border" />
          <span>of met e-mail</span>
          <span className="flex-1 h-px bg-border" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <Input placeholder="Naam" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required className="h-11" />
          )}
          <Input type="email" placeholder="E-mailadres" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-11" />
          <Input type="password" placeholder="Wachtwoord" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className="h-11" />
          <Button
            type="submit"
            disabled={loading || googleLoading}
            className="w-full h-11 rounded-full text-[11px] font-bold uppercase tracking-[0.15em] bg-foreground text-background hover:bg-foreground/90"
          >
            {loading ? "Even wachten…" : isLogin ? "Inloggen" : "Account aanmaken"}
          </Button>
          {isLogin && (
            <Button
              type="button"
              variant="outline"
              disabled={loading || googleLoading}
              onClick={handleMagicLink}
              className="w-full h-11 rounded-full text-[11px] font-bold uppercase tracking-[0.15em] border-border"
            >
              Stuur magic link
            </Button>
          )}
        </form>

        {isLogin && (
          <p className="text-center text-xs text-muted-foreground mt-4">
            <Link to="/wachtwoord-vergeten" className="hover:text-foreground underline underline-offset-4">
              Wachtwoord vergeten?
            </Link>
          </p>
        )}

        <p className="text-center text-sm text-muted-foreground mt-8">
          {isLogin ? "Nog geen account? " : "Al een account? "}
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-foreground underline underline-offset-4 hover:text-accent transition-colors font-medium"
          >
            {isLogin ? "Registreer" : "Inloggen"}
          </button>
        </p>
      </div>
    </div>
  );
};

export default Auth;
