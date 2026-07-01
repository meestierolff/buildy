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
    (async () => {
      const { data } = await supabase.rpc("get_trip_access_info", { _trip_id: tripId });
      const row = (data && (data as any[])[0]) || null;
      setInfo(row);
      if (row?.trip_exists && !row.is_public && user) {
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
    const { error } = await supabase.from("follows").insert({
      project_id: tripId,
      user_id: user.id,
      status: "pending",
    });
    setBusy(false);
    if (error) {
      toast.error("Verzoek kon niet worden verstuurd");
      return;
    }
    setFollowStatus("pending");
    toast.success("Verzoek verstuurd — de eigenaar krijgt een melding");
  };

  if (loading) {
    return (
      <div className="container py-20 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
          <Button disabled className="w-full gap-2" variant="secondary">
            <Clock className="h-4 w-4" /> Verzoek in behandeling
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
