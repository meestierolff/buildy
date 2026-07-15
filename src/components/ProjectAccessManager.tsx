import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Users, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ProjectFollower {
  user_id: string;
  status: "pending" | "accepted";
  display_name: string;
  avatar_url: string | null;
}

interface Props {
  projectId: string;
  enabled: boolean;
}

export default function ProjectAccessManager({ projectId, enabled }: Props) {
  const [followers, setFollowers] = useState<ProjectFollower[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    const { data: rows, error } = await supabase
      .from("follows")
      .select("user_id, status")
      .eq("project_id", projectId)
      .in("status", ["pending", "accepted"]);
    if (error) {
      console.error("Project followers load failed:", error);
      toast.error("Projectvolgers laden mislukt");
      setLoading(false);
      return;
    }

    const ids = (rows || []).map((row) => row.user_id);
    const { data: profiles, error: profileError } = ids.length
      ? await supabase.rpc("get_profiles_basic", { _ids: ids })
      : { data: [], error: null };
    if (profileError) console.error("Project follower profiles load failed:", profileError);
    const profilesById = new Map((profiles || []).map((profile) => [profile.user_id, profile]));
    setFollowers((rows || []).map<ProjectFollower>((row) => {
      const profile = profilesById.get(row.user_id);
      return {
        user_id: row.user_id,
        status: row.status === "accepted" ? "accepted" : "pending",
        display_name: profile?.display_name || "Gebruiker",
        avatar_url: profile?.avatar_url || null,
      };
    }).sort((a, b) => {
      if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
      return a.display_name.localeCompare(b.display_name, "nl");
    }));
    setLoading(false);
  }, [enabled, projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const respond = async (follower: ProjectFollower, accept: boolean) => {
    setBusyId(follower.user_id);
    const { data, error } = await supabase.rpc("respond_to_project_follow", {
      _project_id: projectId,
      _follower_id: follower.user_id,
      _accept: accept,
    });
    if (error) {
      console.error("Project follow response failed:", error);
      toast.error("Verzoek behandelen mislukt");
    } else if (!data) {
      toast.info("Dit verzoek bestond niet meer");
      await load();
    } else if (accept) {
      setFollowers((current) => current.map((item) => item.user_id === follower.user_id
        ? { ...item, status: "accepted" }
        : item));
      toast.success("Toegang verleend");
    } else {
      setFollowers((current) => current.filter((item) => item.user_id !== follower.user_id));
      toast.success("Verzoek afgewezen");
    }
    setBusyId(null);
  };

  const remove = async (follower: ProjectFollower) => {
    setBusyId(follower.user_id);
    const { error } = await supabase
      .from("follows")
      .delete()
      .eq("project_id", projectId)
      .eq("user_id", follower.user_id);
    if (error) {
      console.error("Remove project follower failed:", error);
      toast.error("Volger verwijderen mislukt");
    } else {
      setFollowers((current) => current.filter((item) => item.user_id !== follower.user_id));
      toast.success("Projectvolger verwijderd");
    }
    setBusyId(null);
  };

  const pending = followers.filter((follower) => follower.status === "pending");
  const accepted = followers.filter((follower) => follower.status === "accepted");

  return (
    <div className="space-y-3">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Users className="h-4 w-4" /> Toegang en volgers
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Behandel privéverzoeken en trek projecttoegang op ieder moment weer in.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Volgers laden…
        </div>
      ) : followers.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          Nog geen projectvolgers of openstaande verzoeken.
        </p>
      ) : (
        <div className="space-y-4">
          {pending.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Openstaande verzoeken</p>
              {pending.map((follower) => (
                <FollowerRow key={follower.user_id} follower={follower}>
                  <Button
                    type="button"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    disabled={busyId === follower.user_id}
                    onClick={() => respond(follower, true)}
                    aria-label={`Geef ${follower.display_name} toegang`}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-8 w-8 rounded-full"
                    disabled={busyId === follower.user_id}
                    onClick={() => respond(follower, false)}
                    aria-label={`Wijs verzoek van ${follower.display_name} af`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </FollowerRow>
              ))}
            </div>
          )}

          {accepted.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Projectvolgers</p>
              {accepted.map((follower) => (
                <FollowerRow key={follower.user_id} follower={follower}>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
                    disabled={busyId === follower.user_id}
                    onClick={() => remove(follower)}
                  >
                    Verwijder
                  </Button>
                </FollowerRow>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FollowerRow({
  follower,
  children,
}: {
  follower: ProjectFollower;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2">
      <Avatar className="h-8 w-8">
        <AvatarImage src={follower.avatar_url || ""} />
        <AvatarFallback className="text-xs">{follower.display_name[0]?.toUpperCase() || "?"}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 truncate text-sm">{follower.display_name}</span>
      <div className="flex shrink-0 gap-1">{children}</div>
    </div>
  );
}
