import { formatDistanceToNow } from "date-fns";
import { nl } from "date-fns/locale";
import {
  Archive,
  AtSign,
  Check,
  Hammer,
  MessageCircle,
  Smile,
  UserPlus,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { EngagementNotification } from "../../../shared/contracts/engagement";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useNotificationMutation } from "@/hooks/useEngagement";
import { useSocialRequestDecisionMutation } from "@/hooks/useSocial";
import { Link } from "@/lib/router";
import {
  notificationHref,
  notificationMessage,
  notificationRequestKind,
} from "./presentation";

function iconFor(type: string) {
  if (type === "comment.created" || type === "comment.reply") return MessageCircle;
  if (type === "comment.mention") return AtSign;
  if (type === "reaction.created") return Smile;
  if (type.startsWith("profile.follow.")) return UserPlus;
  return Hammer;
}

interface NotificationListProps {
  notifications: readonly EngagementNotification[];
  compact?: boolean;
  onNavigate?: () => void;
}

const NotificationList = ({
  notifications,
  compact = false,
  onNavigate,
}: NotificationListProps) => {
  const readMutation = useNotificationMutation();
  const archiveMutation = useNotificationMutation();
  const decisionMutation = useSocialRequestDecisionMutation();
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const updateStatus = async (
    notificationId: string,
    action: "read" | "archive",
  ) => {
    setBusyAction(`${notificationId}:${action}`);
    try {
      const mutation = action === "read" ? readMutation : archiveMutation;
      await mutation.mutateAsync({ action, notificationId });
      if (action === "archive") toast.success("Melding gearchiveerd");
    } catch (error) {
      console.error("Notification status update failed", error);
      toast.error(action === "read"
        ? "Melding kon niet als gelezen worden gemarkeerd"
        : "Melding kon niet worden gearchiveerd");
    } finally {
      setBusyAction(null);
    }
  };

  const decide = async (
    notification: EngagementNotification,
    decision: "accept" | "reject",
  ) => {
    const kind = notificationRequestKind(notification);
    const actor = notification.actor;
    const projectId = notification.projectId;
    if (!kind || !actor || (kind === "project" && !projectId)) return;

    setBusyAction(`${notification.id}:${decision}`);
    let decisionCompleted = false;
    try {
      await decisionMutation.mutateAsync(kind === "profile"
        ? { kind, decision, actorId: actor.id }
        : { kind, decision, actorId: actor.id, projectId: projectId as string });
      decisionCompleted = true;
      await archiveMutation.mutateAsync({
        action: "archive",
        notificationId: notification.id,
      });
      toast.success(decision === "accept" ? "Verzoek goedgekeurd" : "Verzoek afgewezen");
    } catch (error) {
      console.error("Social request decision failed", error);
      toast.error(decisionCompleted
        ? "Verzoek verwerkt, maar de melding kon niet worden verborgen"
        : decision === "accept" ? "Goedkeuren mislukt" : "Afwijzen mislukt");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <ul className={compact ? "divide-y divide-border" : "space-y-3"} role="list">
      {notifications.map((notification) => {
        const Icon = iconFor(notification.type);
        const requestKind = notificationRequestKind(notification);
        const actor = notification.actor;
        const busy = busyAction?.startsWith(`${notification.id}:`) ?? false;

        return (
          <li
            key={notification.id}
            className={compact
              ? notification.status === "unread" ? "bg-accent/5" : undefined
              : `border bg-card ${notification.status === "unread" ? "border-accent/40" : "border-border"}`}
          >
            <div className={compact ? "px-4 py-3" : "p-4 sm:p-5"}>
              <Link
                to={notificationHref(notification)}
                onClick={onNavigate}
                className="flex min-h-11 items-start gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div className="relative mt-0.5 shrink-0">
                  {actor ? (
                    <Avatar className={compact ? "h-8 w-8" : "h-10 w-10"}>
                      <AvatarImage src={actor.avatar?.proxyPath ?? ""} alt="" />
                      <AvatarFallback className="bg-accent/20 text-xs font-semibold text-accent">
                        {actor.displayName[0]?.toUpperCase() ?? "?"}
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <span className={`flex items-center justify-center rounded-full bg-accent/15 text-accent ${compact ? "h-8 w-8" : "h-10 w-10"}`}>
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                  )}
                  {notification.status === "unread" ? (
                    <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-background" aria-label="Ongelezen" />
                  ) : null}
                </div>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm leading-snug">{notificationMessage(notification)}</span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true, locale: nl })}
                  </span>
                </span>
              </Link>

              {requestKind ? (
                <div className="ml-11 mt-2 flex flex-wrap gap-2 sm:ml-[3.25rem]">
                  <Button
                    size="sm"
                    className="min-h-9 gap-1"
                    disabled={busy}
                    onClick={() => void decide(notification, "accept")}
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden="true" /> Goedkeuren
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-9 gap-1"
                    disabled={busy}
                    onClick={() => void decide(notification, "reject")}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" /> Afwijzen
                  </Button>
                </div>
              ) : null}

              {!compact ? (
                <div className="ml-11 mt-3 flex flex-wrap gap-2 sm:ml-[3.25rem]">
                  {notification.status === "unread" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="min-h-9"
                      disabled={busy}
                      onClick={() => void updateStatus(notification.id, "read")}
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" /> Markeer als gelezen
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="min-h-9 text-muted-foreground"
                    disabled={busy}
                    onClick={() => void updateStatus(notification.id, "archive")}
                  >
                    <Archive className="h-3.5 w-3.5" aria-hidden="true" /> Archiveren
                  </Button>
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export default NotificationList;
