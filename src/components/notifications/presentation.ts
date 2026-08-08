import type { EngagementNotification } from "../../../shared/contracts/engagement";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";

export function notificationMessage(notification: EngagementNotification): string {
  const actor = notification.actor?.displayName ?? "Iemand";
  switch (notification.type) {
    case "profile.follow.requested":
      return `${actor} wil je volgen`;
    case "profile.followed":
      return `${actor} volgt je nu`;
    case "profile.follow.accepted":
      return `${actor} heeft je volgverzoek geaccepteerd`;
    case "profile.follow.rejected":
      return `${actor} heeft je volgverzoek afgewezen`;
    case "project.followed":
      return `${actor} volgt je project`;
    case "project.access.requested":
      return `${actor} vraagt toegang tot je project`;
    case "project.access.accepted":
      return "Je toegangsverzoek is geaccepteerd";
    case "project.access.rejected":
      return "Je toegangsverzoek is afgewezen";
    case "comment.created":
      return `${actor} reageerde op je update`;
    case "comment.reply":
      return `${actor} antwoordde op je reactie`;
    case "comment.mention":
      return `${actor} noemde je in een reactie`;
    case "reaction.created":
      return `${actor} reageerde op je bijdrage`;
    default:
      return "Nieuwe melding";
  }
}

export function notificationHref(notification: EngagementNotification): string {
  if (notification.projectId && notification.updateId) {
    return PRODUCT_ROUTES.projectUpdate(notification.projectId, notification.updateId);
  }
  if (notification.projectId) return PRODUCT_ROUTES.project(notification.projectId);
  if (notification.actor) return PRODUCT_ROUTES.profile(notification.actor.slug);
  return PRODUCT_ROUTES.connections;
}

export function notificationRequestKind(
  notification: EngagementNotification,
): "profile" | "project" | null {
  if (notification.type === "profile.follow.requested" && notification.actor) return "profile";
  if (
    notification.type === "project.access.requested"
    && notification.actor
    && notification.projectId
  ) return "project";
  return null;
}
