import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
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

const FollowButton = ({ projectId, size = "sm", variant = "outline", className }: FollowButtonProps) => {
  const { user } = useAuth();
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("follows")
      .select("id")
      .eq("user_id", user.id)
      .eq("project_id", projectId)
      .maybeSingle()
      .then(({ data }) => setFollowing(!!data));
  }, [user, projectId]);

  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      toast.error("Log in om projecten te volgen");
      return;
    }
    setLoading(true);
    if (following) {
      await supabase.from("follows").delete().eq("user_id", user.id).eq("project_id", projectId);
      setFollowing(false);
      toast.success("Niet meer gevolgd");
    } else {
      await supabase.from("follows").insert({ user_id: user.id, project_id: projectId });
      setFollowing(true);
      toast.success("Je volgt dit project nu");
    }
    setLoading(false);
  };

  return (
    <Button
      type="button"
      size={size}
      variant={following ? "default" : variant}
      onClick={toggle}
      disabled={loading}
      className={`gap-1.5 ${following ? "bg-accent text-accent-foreground hover:bg-accent/90" : (className ?? "")}`}
    >
      <Heart className={`h-4 w-4 ${following ? "fill-current" : ""}`} />
      {following ? "Gevolgd" : "Volgen"}
    </Button>
  );
};

export default FollowButton;
