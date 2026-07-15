import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Lock, Loader2, Clock, Check } from "lucide-react";
import { toast } from "sonner";

interface Props {
  tripId: string;
}

type AccessInfo = {
  trip_exists: boolean;
  is_public: boolean | null;
  owner_id: string | null;
  title: string | null;
};

const RequestAccessCard = ({ tripId }: Props) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<AccessInfo | null>(null);
  const [followStatus, setFollowStatus] = useState<"none" | "pending" | "accepted">("none");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      setInfo(null);
      setFollowStatus("none");
      return;
    }
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("get_trip_access_info", { _trip_id: tripId });
      if (error) console.error("Trip access lookup failed:", error);
      const row = data?.[0] ?? null;
      setInfo(row);
      if (row?.trip_exists && !row.is_public) {
        const { data: f } = await supabase
          .from("follows")
          .select("status")
          .eq("project_id", tripId)
          .eq("user_id", user.id)
          .maybeSingle();
        if (f?.status === "pending" || f?.status === "accepted") {
          setFollowStatus(f.status);
        }
      }
      setLoading(false);
    })();
  }, [tripId, user]);

  const request = async () => {
    if (!user) {
      navigate("/auth");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc("request_project_follow", {
      _project_id: tripId,
    });
    setBusy(false);
    if (error) {
      toast.error("Verzoek kon niet worden verstuurd");
      return;
    }
    const nextStatus = data === "accepted" ? "accepted" : "pending";
    setFollowStatus(nextStatus);
    toast.success(nextStatus === "accepted"
      ? "Je hebt toegang tot dit project"
      : "Verzoek verstuurd — de eigenaar krijgt een melding");
  };

  const cancelRequest = async () => {
    if (!user) return;
    setBusy(true);
    const { error } = await supabase
      .from("follows")
      .delete()
      .eq("project_id", tripId)
      .eq("user_id", user.id)
      .eq("status", "pending");
    setBusy(false);
    if (error) {
      console.error("Cancel access request failed:", error);
      toast.error("Verzoek kon niet worden ingetrokken");
      return;
    }
    setFollowStatus("none");
    toast.success("Verzoek ingetrokken");
  };

  if (loading) {
    return (
      <div className="container py-20 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container py-20 flex justify-center">
        <div className="max-w-md w-full rounded-xl border bg-card p-8 text-center space-y-4 shadow-sm">
          <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center">
            <Lock className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-serif font-semibold">Dit project is mogelijk privé</h1>
            <p className="text-sm text-muted-foreground">Log in om toegang aan te vragen of te controleren.</p>
          </div>
          <Button className="w-full" onClick={() => navigate(`/auth?next=${encodeURIComponent(`/trip/${tripId}`)}`)}>
            Inloggen om door te gaan
          </Button>
          <Link to="/" className="block text-xs text-muted-foreground underline">Terug naar overzicht</Link>
        </div>
      </div>
    );
  }

  if (!info?.trip_exists) {
    return (
      <div className="container py-20 text-center space-y-3">
        <p className="text-muted-foreground">Project niet gevonden.</p>
        <Link to="/" className="text-sm underline">Terug naar overzicht</Link>
      </div>
    );
  }

  // Private project the user can't view
  return (
    <div className="container py-20 flex justify-center">
      <div className="max-w-md w-full rounded-xl border bg-card p-8 text-center space-y-4 shadow-sm">
        <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center">
          <Lock className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-serif font-semibold">
            {info.title || "Privéproject"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Dit project is privé. Vraag toegang aan de eigenaar om de updates te bekijken.
          </p>
        </div>
        {followStatus === "accepted" ? (
          <Button className="w-full gap-2" onClick={() => window.location.reload()}>
            <Check className="h-4 w-4" /> Toegang verleend — herladen
          </Button>
        ) : followStatus === "pending" ? (
          <Button disabled={busy} onClick={cancelRequest} className="w-full gap-2" variant="secondary">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
            Verzoek intrekken
          </Button>
        ) : (
          <Button disabled={busy} onClick={request} className="w-full gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            Vraag toegang
          </Button>
        )}
        <Link to="/" className="block text-xs text-muted-foreground underline">
          Terug naar overzicht
        </Link>
      </div>
    </div>
  );
};

export default RequestAccessCard;
