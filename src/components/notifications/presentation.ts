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
      return "Historische melding over een verbouwing";
    case "project.access.requested":
      return "Historisch toegangsverzoek";
    case "project.access.accepted":
      return "Historisch toegangsverzoek verwerkt";
    case "project.access.rejected":
      return "Historisch toegangsverzoek verwerkt";
    case "comment.created":
      return `${actor} reageerde op je Bouwmoment`;
    case "comment.reply":
      return `${actor} antwoordde op je reactie`;
    case "comment.mention":
      return `${actor} noemde je in een reactie`;
    case "reaction.created":
      return `${actor} reageerde op je bijdrage`;
    case "moderation.warning":
      return "Je hebt een bericht van het Buildy-team";
    case "update.published":
      return `${actor} plaatste een nieuw Bouwmoment`;
    case "order.payment.succeeded":
      return "Je betaling voor het Bouwboek is bevestigd";
    case "order.payment.failed":
      return "Je betaling voor het Bouwboek is mislukt";
    case "order.payment.expired":
      return "De betaalperiode voor je Bouwboek is verlopen";
    case "order.payment.partially_refunded":
      return "Je Bouwboekbetaling is gedeeltelijk terugbetaald";
    case "order.payment.refunded":
      return "Je Bouwboekbetaling is terugbetaald";
    case "order.manual_review":
      return "Je Bouwboekbestelling wordt handmatig gecontroleerd";
    case "order.fulfilment.ordered":
      return "Je Bouwboek is besteld bij de drukker";
    case "order.fulfilment.in_production":
      return "Je Bouwboek is in productie";
    case "order.fulfilment.shipped":
      return "Je Bouwboek is verzonden";
    case "order.fulfilment.completed":
      return "Je Bouwboekbestelling is afgerond";
    case "order.fulfilment.cancelled":
      return "Je Bouwboekbestelling is geannuleerd";
    case "order.fulfilment.refund_review":
      return "De terugbetaling van je Bouwboek wordt gecontroleerd";
    default:
      return "Nieuwe melding";
  }
}

export function notificationHref(notification: EngagementNotification): string {
  if (notification.orderId) return PRODUCT_ROUTES.order(notification.orderId);
  if (notification.projectId && notification.updateId) {
    return PRODUCT_ROUTES.projectUpdate(notification.projectId, notification.updateId);
  }
  if (notification.projectId) return PRODUCT_ROUTES.project(notification.projectId);
  if (notification.actor) return PRODUCT_ROUTES.profile(notification.actor.slug);
  return PRODUCT_ROUTES.connections;
}

export function notificationRequestKind(
  notification: EngagementNotification,
): "profile" | null {
  if (notification.type === "profile.follow.requested" && notification.actor) return "profile";
  return null;
}
