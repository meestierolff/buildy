import { describe, expect, it } from "vitest";

import {
  notificationHref,
  notificationMessage,
} from "@/components/notifications/presentation";
import type {
  EngagementNotification,
  EngagementNotificationType,
} from "../../shared/contracts/engagement";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const UPDATE_ID = "33333333-3333-4333-8333-333333333333";

function notification(
  type: EngagementNotificationType,
  overrides: Partial<EngagementNotification> = {},
): EngagementNotification {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    type,
    status: "unread",
    actor: null,
    projectId: null,
    updateId: null,
    commentId: null,
    orderId: null,
    readAt: null,
    createdAt: "2026-08-23T10:00:00.000Z",
    ...overrides,
  };
}

describe("product notification presentation", () => {
  it("links every order state to the canonical customer order route", () => {
    const messages: Record<EngagementNotificationType, string> = {
      "profile.follow.requested": "",
      "profile.followed": "",
      "profile.follow.accepted": "",
      "profile.follow.rejected": "",
      "project.followed": "",
      "project.access.requested": "",
      "project.access.accepted": "",
      "project.access.rejected": "",
      "comment.created": "",
      "comment.reply": "",
      "comment.mention": "",
      "reaction.created": "",
      "moderation.warning": "",
      "update.published": "",
      "order.payment.succeeded": "betaling",
      "order.payment.failed": "mislukt",
      "order.payment.expired": "verlopen",
      "order.payment.partially_refunded": "gedeeltelijk terugbetaald",
      "order.payment.refunded": "terugbetaald",
      "order.manual_review": "handmatig gecontroleerd",
      "order.fulfilment.ordered": "besteld bij de drukker",
      "order.fulfilment.in_production": "in productie",
      "order.fulfilment.shipped": "verzonden",
      "order.fulfilment.completed": "afgerond",
      "order.fulfilment.cancelled": "geannuleerd",
      "order.fulfilment.refund_review": "terugbetaling",
    };

    for (const [type, fragment] of Object.entries(messages)) {
      if (!type.startsWith("order.")) continue;
      const item = notification(type as EngagementNotificationType, { orderId: ORDER_ID });
      expect(notificationHref(item)).toBe(`/bestellingen/${ORDER_ID}`);
      expect(notificationMessage(item).toLowerCase()).toContain(fragment);
    }
  });

  it("presents a publication with its actor and canonical Bouwmoment link", () => {
    const item = notification("update.published", {
      actor: {
        id: "55555555-5555-4555-8555-555555555555",
        displayName: "Noor",
        slug: "noor-bouwt",
        avatar: null,
      },
      projectId: PROJECT_ID,
      updateId: UPDATE_ID,
    });

    expect(notificationMessage(item)).toBe("Noor plaatste een nieuw Bouwmoment");
    expect(notificationHref(item)).toBe(`/project/${PROJECT_ID}?update=${UPDATE_ID}`);
  });
});
