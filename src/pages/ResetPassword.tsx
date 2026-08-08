import { useEffect, useState } from "react";
import { useNavigate, Link, useSearchParams } from "@/lib/router";
import { useAuth } from "@/hooks/useAuth";
import {
  authClient,
  authErrorDetails,
  authErrorMessage,
  authPagePath,
  parsePasswordResetLink,
  safeNextPath,
} from "@/lib/authClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { usePageMeta } from "@/hooks/usePageMeta";

const ResetPassword = () => {
  usePageMeta({
    title: "Nieuw wachtwoord instellen — Buildy",
    description: "Kies een nieuw wachtwoord voor je Buildy account.",
    path: "/wachtwoord-resetten",
    noIndex: true,
  });
  const navigate = useNavigate();
  const { refetchSession } = useAuth();
  const [searchParams] = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const [resetLink] = useState(() => parsePasswordResetLink(
    typeof window === "undefined" ? "" : window.location.search,
  ));
  const [linkError, setLinkError] = useState(resetLink.errorCode);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cleanPath = nextPath === "/"
      ? "/wachtwoord-resetten"
      : `/wachtwoord-resetten?next=${encodeURIComponent(nextPath)}`;
    window.history.replaceState(window.history.state, "", cleanPath);
  }, [nextPath]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!resetLink.token) {
      setLinkError("INVALID_TOKEN");
      return;
    }
    if (password.length < 12) {
      toast.error("Gebruik een wachtwoord van minimaal 12 tekens.");
      return;
    }
    if (password.length > 128) {
      toast.error("Gebruik een wachtwoord van maximaal 128 tekens.");
      return;
    }
    if (password !== confirm) {
      toast.error("De wachtwoorden komen niet overeen.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await authClient.resetPassword({
        newPassword: password,
        token: resetLink.token,
      });
      if (error) {
        const details = authErrorDetails(error);
        console.error("Better Auth password reset failed", details);
        if (details.code === "INVALID_TOKEN" || details.code === "TOKEN_EXPIRED") {
          setLinkError(details.code);
        }
        toast.error(authErrorMessage(error, "reset-password"));
        return;
      }

      await refetchSession();
      toast.success("Je wachtwoord is gewijzigd. Log opnieuw in met je nieuwe wachtwoord.");
      navigate(authPagePath(nextPath, "password-reset"), { replace: true });
    } catch (error) {
      console.error("Better Auth password reset failed", authErrorDetails(error));
      toast.error(authErrorMessage(error, "reset-password"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <p className="eyebrow mb-4">Nieuw wachtwoord</p>
          <h1 className="font-serif italic text-4xl leading-tight">Stel je wachtwoord opnieuw in.</h1>
        </div>

        {linkError ? (
          <div className="text-center text-sm text-muted-foreground space-y-3" role="alert">
            <p>{authErrorMessage({ code: linkError }, "reset-password")}</p>
            <p className="text-xs">
              <Link
                to={nextPath === "/"
                  ? "/wachtwoord-vergeten"
                  : `/wachtwoord-vergeten?next=${encodeURIComponent(nextPath)}`}
                className="underline underline-offset-4"
              >
                Vraag een nieuwe reset-link aan
              </Link>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">Nieuw wachtwoord</Label>
              <Input
                id="new-password"
                name="new-password"
                type="password"
                autoComplete="new-password"
                placeholder="Minimaal 12 tekens"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={12}
                maxLength={128}
                className="h-11"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Herhaal wachtwoord</Label>
              <Input
                id="confirm-password"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                placeholder="Nogmaals je nieuwe wachtwoord"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                required
                minLength={12}
                maxLength={128}
                className="h-11"
              />
            </div>
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
