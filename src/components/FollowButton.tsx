import { useEffect, useState } from "react";
import { Heart, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface FollowButtonProps {
  projectId: string;
  size?: "sm" | "default";
  variant?: "default" | "outline";
  className?: string;
}

type FollowStatus = "none" | "pending" | "accepted";

const FollowButton = ({ projectId, size = "sm", variant = "outline", className }: FollowButtonProps) => {
  const { user } = useAuth();
  const [status, setStatus] = useState<FollowStatus>("none");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) { setStatus("none"); return; }
    supabase
      .from("follows")
      .select("status")
      .eq("user_id", user.id)
      .eq("project_id", projectId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) setStatus("none");
        else setStatus((data as any).status === "accepted" ? "accepted" : "pending");
      });
  }, [user, projectId]);

  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      toast.error("Log in om projecten te volgen");
      return;
    }
    setLoading(true);
    if (status !== "none") {
      const { error } = await supabase.from("follows").delete().eq("user_id", user.id).eq("project_id", projectId);
      if (error) toast.error("Kon niet bijwerken");
      else {
        setStatus("none");
        toast.success(status === "pending" ? "Verzoek ingetrokken" : "Niet meer gevolgd");
      }
    } else {
      const { data, error } = await supabase
        .from("follows")
        .insert({ user_id: user.id, project_id: projectId })
        .select("status")
        .single();
      if (error) {
        toast.error("Volgen mislukt");
      } else {
        const newStatus = (data as any).status === "accepted" ? "accepted" : "pending";
        setStatus(newStatus);
        toast.success(newStatus === "accepted" ? "Je volgt dit project nu" : "Volgverzoek verstuurd");
      }
    }
    setLoading(false);
  };

  const label = status === "accepted" ? "Gevolgd" : status === "pending" ? "In afwachting" : "Volgen";
  const Icon = status === "pending" ? Clock : Heart;

  return (
    <Button
      type="button"
      size={size}
      variant={status === "accepted" ? "default" : variant}
      onClick={toggle}
      disabled={loading}
      className={`gap-1.5 ${status === "accepted" ? "bg-accent text-accent-foreground hover:bg-accent/90" : (className ?? "")}`}
    >
      <Icon className={`h-4 w-4 ${status === "accepted" ? "fill-current" : ""}`} />
      {label}
    </Button>
  );
};

export default FollowButton;
