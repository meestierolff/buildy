import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Hammer, MessageCircle, AtSign, UserPlus, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatDistanceToNow } from "date-fns";
import { nl } from "date-fns/locale";
import { toast } from "sonner";

interface Notif {
  id: string;
  type: string;
  message: string | null;
  read: boolean;
  created_at: string;
  project_id: string | null;
  step_id: string | null;
  actor_id: string | null;
}

interface ActorProfile {
  display_name: string;
  avatar_url: string | null;
}

const iconFor = (type: string) => {
  if (type === "comment" || type === "reply") return MessageCircle;
  if (type === "mention") return AtSign;
  if (type === "follow_request" || type === "user_follow_request" || type === "new_follower" || type === "new_user_follower" || type === "follow_accepted" || type === "user_follow_accepted") return UserPlus;
  return Hammer;
};

const formatNotifMessage = (n: Notif, actor: ActorProfile | undefined): string => {
  if (!n.message) return "Nieuwe melding";
  const actorName = actor?.display_name || "Iemand";
  
  if (n.message === "Nieuw volgverzoek") {
    return `${actorName} wil je volgen`;
  }
  if (n.message.startsWith("Nieuw volgverzoek voor ")) {
    const projectPart = n.message.replace("Nieuw volgverzoek voor ", "");
    return `${actorName} vraagt toegang tot ${projectPart}`;
  }
  return n.message;
};

const NotificationBell = () => {
  const { user } = useAuth();
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [actorProfiles, setActorProfiles] = useState<Record<string, ActorProfile>>({});
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchActorProfiles = async (notifications: Notif[]) => {
    const actorIds = Array.from(
      new Set(notifications.map((n) => n.actor_id).filter((id): id is string => Boolean(id)))
    );
    if (actorIds.length === 0) return;

    const missingIds = actorIds.filter((id) => !actorProfiles[id]);
    if (missingIds.length === 0) return;

    const { data, error } = await supabase.rpc("get_profiles_basic", { _ids: missingIds });
    if (error) {
      console.error("Failed to load notification actor profiles:", error);
      return;
    }
    if (data) {
      setActorProfiles((prev) => {
        const next = { ...prev };
        for (const p of data) {
          next[p.user_id] = { display_name: p.display_name, avatar_url: p.avatar_url };
        }
        return next;
      });
    }
  };

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    const loaded = data || [];
    setNotifs(loaded);
    await fetchActorProfiles(loaded);
  };

  useEffect(() => {
    if (!user) return;
    load();
    const channel = supabase
      .channel(`notif-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => setNotifs((prev) => {
          const next = payload.new as Notif;
          if (prev.some((item) => item.id === next.id)) return prev;
          const updated = [next, ...prev].slice(0, 20);
          fetchActorProfiles([next]);
          return updated;
        })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const unread = notifs.filter((n) => !n.read).length;

  const markAllRead = async () => {
    if (!user || unread === 0) return;
    const { error } = await supabase.from("notifications").update({ read: true }).eq("user_id", user.id).eq("read", false);
    if (error) {
      console.error("Mark notifications read failed:", error);
      return;
    }
    setNotifs((p) => p.map((n) => ({ ...n, read: true })));
  };

  const approve = async (n: Notif) => {
    if (!n.actor_id) return;
    setBusyId(n.id);
    let handled = false;
    let error: unknown = null;
    if (n.type === "follow_request" && n.project_id) {
      const result = await supabase.rpc("respond_to_project_follow", {
        _project_id: n.project_id,
        _follower_id: n.actor_id,
        _accept: true,
      });
      handled = result.data === true;
      error = result.error;
    } else if (n.type === "user_follow_request" && user) {
      const result = await supabase.rpc("respond_to_user_follow", {
        _follower_id: n.actor_id,
        _accept: true,
      });
      handled = result.data === true;
      error = result.error;
    }

    if (error) {
      console.error("Approve follow request failed:", error);
      toast.error("Goedkeuren mislukt");
      setBusyId(null);
      return;
    }
    toast.success(handled ? "Volgverzoek goedgekeurd" : "Dit verzoek bestond niet meer");
    const { error: deleteError } = await supabase.from("notifications").delete().eq("id", n.id);
    if (deleteError) console.error("Remove handled notification failed:", deleteError);
    setNotifs((prev) => prev.filter((x) => x.id !== n.id));
    setBusyId(null);
  };

  const reject = async (n: Notif) => {
    if (!n.actor_id) return;
    setBusyId(n.id);
    let handled = false;
    let error: unknown = null;
    if (n.type === "follow_request" && n.project_id) {
      const result = await supabase.rpc("respond_to_project_follow", {
        _project_id: n.project_id,
        _follower_id: n.actor_id,
        _accept: false,
      });
      handled = result.data === true;
      error = result.error;
    } else if (n.type === "user_follow_request" && user) {
      const result = await supabase.rpc("respond_to_user_follow", {
        _follower_id: n.actor_id,
        _accept: false,
      });
      handled = result.data === true;
      error = result.error;
    }

    if (error) {
      console.error("Reject follow request failed:", error);
      toast.error("Afwijzen mislukt");
      setBusyId(null);
      return;
    }
    toast.success(handled ? "Verzoek afgewezen" : "Dit verzoek bestond niet meer");
    const { error: deleteError } = await supabase.from("notifications").delete().eq("id", n.id);
    if (deleteError) console.error("Remove handled notification failed:", deleteError);
    setNotifs((prev) => prev.filter((x) => x.id !== n.id));
    setBusyId(null);
  };

  if (!user) return null;

  const isRequest = (t: string) => t === "follow_request" || t === "user_follow_request";

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) markAllRead(); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={unread ? `Meldingen, ${unread} ongelezen` : "Meldingen"} className="relative rounded-full hover:bg-muted text-foreground h-9 w-9">
          <Bell className="h-4 w-4" strokeWidth={1.75} />
          {unread > 0 && (
            <span className="absolute top-1 right-1 h-4 min-w-4 px-1 rounded-full bg-accent text-accent-foreground text-[10px] font-bold flex items-center justify-center">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="px-4 py-2 border-b font-semibold text-sm">Meldingen</div>
        <div className="max-h-96 overflow-y-auto">
          {notifs.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Nog geen meldingen</p>
          ) : (
            notifs.map((n) => {
              const Icon = iconFor(n.type);
              const request = isRequest(n.type);
              const actor = n.actor_id ? actorProfiles[n.actor_id] : undefined;
              const displayMessage = formatNotifMessage(n, actor);
              const userNotification = n.type === "new_user_follower" || n.type === "user_follow_accepted" || n.type === "user_follow_request";
              const href = request
                ? n.actor_id
                  ? `/profile/${n.actor_id}`
                  : "#"
                : n.project_id
                  ? `/trip/${n.project_id}${n.step_id ? `?step=${n.step_id}` : ""}`
                  : userNotification && n.actor_id
                    ? `/profile/${n.actor_id}`
                    : "/vrienden";

              const Body = (
                <div className={`flex items-start gap-3 px-4 py-3 border-b last:border-0 ${!n.read ? "bg-accent/5" : ""} ${request ? "" : "hover:bg-muted/60 transition-colors"}`}>
                  <div className="relative mt-0.5 shrink-0">
                    {actor ? (
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={actor.avatar_url || ""} />
                        <AvatarFallback className="bg-accent/20 text-accent font-semibold text-xs">
                          {actor.display_name?.[0]?.toUpperCase() || "?"}
                        </AvatarFallback>
                      </Avatar>
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-accent/15 text-accent flex items-center justify-center">
                        <Icon className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">{displayMessage}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: nl })}
                    </p>
                    {request && (
                      <div className="flex gap-2 mt-2">
                        <Button size="sm" className="h-7 px-2 text-xs gap-1" disabled={busyId === n.id} onClick={() => approve(n)}>
                          <Check className="h-3 w-3" /> Goedkeuren
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" disabled={busyId === n.id} onClick={() => reject(n)}>
                          <X className="h-3 w-3" /> Afwijzen
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
              return request && n.actor_id ? (
                <div key={n.id}>
                  {Body}
                </div>
              ) : request ? (
                <div key={n.id}>{Body}</div>
              ) : (
                <Link key={n.id} to={href} onClick={() => setOpen(false)}>{Body}</Link>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;

