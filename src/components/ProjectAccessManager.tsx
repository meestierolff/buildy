import { useState, type ReactNode } from "react";
import { Check, Loader2, RefreshCw, Users, X } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  useRevokeProjectAccessMutation,
  useSocialProjectAccess,
  useSocialRequestDecisionMutation,
} from "@/hooks/useSocial";
import type { ProjectAccessEntry } from "../../shared/contracts/social";

interface Props {
  projectId: string;
  enabled: boolean;
}

export default function ProjectAccessManager({ projectId, enabled }: Props) {
  const accessQuery = useSocialProjectAccess(projectId, enabled);
  const decisionMutation = useSocialRequestDecisionMutation();
  const revokeMutation = useRevokeProjectAccessMutation();
  const [busyId, setBusyId] = useState<string | null>(null);
  const followers = accessQuery.data?.items ?? [];

  const respond = async (follower: ProjectAccessEntry, decision: "accept" | "reject") => {
    setBusyId(follower.requesterId);
    try {
      await decisionMutation.mutateAsync({
        actorId: follower.requesterId,
        decision,
        kind: "project",
        projectId,
      });
      toast.success(decision === "accept" ? "Toegang verleend" : "Verzoek afgewezen");
    } catch (error) {
      console.error("Project access decision failed", error);
      toast.error("Verzoek behandelen mislukt");
      await accessQuery.refetch();
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (follower: ProjectAccessEntry) => {
    setBusyId(follower.requesterId);
    try {
      await revokeMutation.mutateAsync({ projectId, requesterId: follower.requesterId });
      toast.success("Projecttoegang ingetrokken");
    } catch (error) {
      console.error("Revoke project access failed", error);
      toast.error("Toegang intrekken mislukt");
      await accessQuery.refetch();
    } finally {
      setBusyId(null);
    }
  };

  const pending = followers.filter((follower) => follower.status === "pending");
  const accepted = followers.filter((follower) => follower.status === "accepted");

  return (
    <div className="space-y-3">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Users className="h-4 w-4" aria-hidden="true" /> Toegang en volgers
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Behandel privéverzoeken en trek projecttoegang op ieder moment weer in.
        </p>
      </div>

      {accessQuery.isPending ? (
        <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Toegang laden…
        </div>
      ) : accessQuery.isError ? (
        <div className="rounded-lg border border-destructive/30 p-4 text-center" role="alert">
          <p className="text-xs text-muted-foreground">Toegangsverzoeken konden niet veilig worden geladen.</p>
          <Button className="mt-3 h-8 gap-1.5 text-xs" variant="outline" onClick={() => void accessQuery.refetch()}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Opnieuw proberen
          </Button>
        </div>
      ) : followers.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          Nog geen openstaande verzoeken of verleende toegang.
        </p>
      ) : (
        <div className="space-y-4">
          {pending.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Openstaande verzoeken</p>
              {pending.map((follower) => (
                <FollowerRow key={follower.requesterId} follower={follower}>
                  <Button
                    type="button"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    disabled={busyId === follower.requesterId}
                    onClick={() => void respond(follower, "accept")}
                    aria-label={`Geef ${follower.displayName} toegang`}
                  >
                    {busyId === follower.requesterId
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-8 w-8 rounded-full"
                    disabled={busyId === follower.requesterId}
                    onClick={() => void respond(follower, "reject")}
                    aria-label={`Wijs verzoek van ${follower.displayName} af`}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </FollowerRow>
              ))}
            </div>
          ) : null}

          {accepted.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Toegang verleend</p>
              {accepted.map((follower) => (
                <FollowerRow key={follower.requesterId} follower={follower}>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
                    disabled={busyId === follower.requesterId}
                    onClick={() => void remove(follower)}
                  >
                    Intrekken
                  </Button>
                </FollowerRow>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function FollowerRow({ follower, children }: { follower: ProjectAccessEntry; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2">
      <Avatar className="h-8 w-8">
        <AvatarImage src={follower.avatar?.proxyPath ?? ""} />
        <AvatarFallback className="text-xs">{follower.displayName[0]?.toUpperCase() || "?"}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 truncate text-sm">{follower.displayName}</span>
      <div className="flex shrink-0 gap-1">{children}</div>
    </div>
  );
}
