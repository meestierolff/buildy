import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/wachtwoord-resetten`,
    });
    setLoading(false);
    if (error) {
      toast.error("Kon geen reset-link versturen. Probeer het opnieuw.");
      return;
    }
    setSent(true);
    toast.success("Check je inbox voor de reset-link.");
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
              We hebben een mail gestuurd naar <strong>{email}</strong>. Open die om je wachtwoord te resetten.
            </p>
            <Link to="/auth" className="text-xs uppercase tracking-[0.2em] font-bold underline underline-offset-4">
              Terug naar inloggen
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="email"
              placeholder="E-mailadres"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-11"
            />
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-full text-[11px] font-bold uppercase tracking-[0.15em] bg-foreground text-background hover:bg-foreground/90"
            >
              {loading ? "Even wachten…" : "Stuur reset-link"}
            </Button>
            <p className="text-center text-xs text-muted-foreground mt-4">
              <Link to="/auth" className="hover:text-foreground underline underline-offset-4">
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
