import { Heart, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjectFollowMutation, useSocialProjectState } from "@/hooks/useSocial";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface FollowButtonProps {
  projectId: string;
  size?: "sm" | "default";
  variant?: "default" | "outline";
  className?: string;
}

const FollowButton = ({
  projectId,
  size = "sm",
  variant = "outline",
  className,
}: FollowButtonProps) => {
  const { user } = useAuth();
  const mutation = useProjectFollowMutation();
  const stateQuery = useSocialProjectState(projectId, Boolean(user && projectId));

  const toggle = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!user) {
      toast.error("Log in om projecten te volgen");
      return;
    }

    if (stateQuery.isError) {
      await stateQuery.refetch();
      return;
    }

    try {
      if (stateQuery.data?.followStatus === "following") {
        await mutation.mutateAsync({ action: "remove", projectId });
        toast.success("Je volgt dit project niet meer");
        return;
      }

      const result = await mutation.mutateAsync({ action: "follow", projectId });
      if (result.state === "following" || result.state === "accepted") {
        toast.success("Je volgt dit project nu");
        return;
      }

      toast.error("Dit project kan nu niet worden gevolgd");
    } catch (error) {
      console.error("Project follow update failed", error);
      toast.error("Volgen bijwerken mislukt");
    }
  };

  const isFollowing = stateQuery.data?.followStatus === "following";
  const loading = Boolean(user) && stateQuery.isPending;
  const label = stateQuery.isError
    ? "Status opnieuw laden"
    : isFollowing
      ? "Volgend"
      : "Volgen";

  return (
    <Button
      type="button"
      size={size}
      variant={isFollowing ? "default" : variant}
      onClick={toggle}
      disabled={mutation.isPending || loading || !projectId}
      aria-pressed={isFollowing}
      aria-label={label}
      className={`gap-1.5 ${isFollowing ? "bg-accent text-accent-foreground hover:bg-accent/90" : ""} ${className ?? ""}`}
    >
      {mutation.isPending || loading
        ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        : <Heart className={`h-4 w-4 ${isFollowing ? "fill-current" : ""}`} aria-hidden="true" />}
      {label}
    </Button>
  );
};

export default FollowButton;
