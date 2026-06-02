import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { usePageMeta } from "@/hooks/usePageMeta";

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
  const navigate = useNavigate();

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
          <Link to="/" className="inline-flex items-center gap-2 mb-10">
            <div className="w-8 h-8 bg-foreground rounded-md flex items-center justify-center">
              <svg className="w-4 h-4 text-background" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <span className="text-lg font-semibold tracking-tight">Buildy</span>
          </Link>
          <p className="eyebrow mb-4">{isLogin ? "Inloggen" : "Registreren"}</p>
          <h1 className="font-serif italic text-4xl md:text-5xl leading-tight">
            {isLogin ? "Welkom terug." : "Start je dagboek."}
          </h1>
          <p className="text-sm text-muted-foreground mt-4 font-light">
            {isLogin ? "Log in om je verbouwingen te volgen." : "Leg elke fase van je verbouwing vast."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <Input placeholder="Naam" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required className="h-11" />
          )}
          <Input type="email" placeholder="E-mailadres" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-11" />
          <Input type="password" placeholder="Wachtwoord" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className="h-11" />
          <Button
            type="submit"
            disabled={loading}
            className="w-full h-11 rounded-full text-[11px] font-bold uppercase tracking-[0.15em] bg-foreground text-background hover:bg-foreground/90"
          >
            {loading ? "Even wachten…" : isLogin ? "Inloggen" : "Account aanmaken"}
          </Button>
          {isLogin && (
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={handleMagicLink}
              className="w-full h-11 rounded-full text-[11px] font-bold uppercase tracking-[0.15em] border-border"
            >
              Stuur magic link
            </Button>
          )}
        </form>

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
