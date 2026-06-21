import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { usePageMeta } from "@/hooks/usePageMeta";

const ResetPassword = () => {
  usePageMeta({
    title: "Nieuw wachtwoord instellen — Buildy",
    description: "Kies een nieuw wachtwoord voor je Buildy account.",
    path: "/wachtwoord-resetten",
    noIndex: true,
  });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Supabase plaatst de tokens als hash-fragment of detecteert ze automatisch.
    // We luisteren naar PASSWORD_RECOVERY of een bestaande session.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Wachtwoord moet minstens 6 tekens zijn.");
      return;
    }
    if (password !== confirm) {
      toast.error("De wachtwoorden komen niet overeen.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error("Wachtwoord opslaan mislukt. Probeer de link opnieuw.");
      return;
    }
    toast.success("Wachtwoord bijgewerkt — je bent ingelogd.");
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <p className="eyebrow mb-4">Nieuw wachtwoord</p>
          <h1 className="font-serif italic text-4xl leading-tight">Stel je wachtwoord opnieuw in.</h1>
        </div>

        {!ready ? (
          <div className="text-center text-sm text-muted-foreground space-y-3">
            <p>We checken je reset-link…</p>
            <p className="text-xs">
              Heb je geen geldige link? <Link to="/wachtwoord-vergeten" className="underline underline-offset-4">Vraag een nieuwe aan</Link>.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="password"
              placeholder="Nieuw wachtwoord"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="h-11"
              autoFocus
            />
            <Input
              type="password"
              placeholder="Herhaal wachtwoord"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={6}
              className="h-11"
            />
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-full text-[11px] font-bold uppercase tracking-[0.15em] bg-foreground text-background hover:bg-foreground/90"
            >
              {loading ? "Even wachten…" : "Wachtwoord opslaan"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
