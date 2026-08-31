import { BASE, expect, test } from "./helpers";
import {
  FIXED_NOW,
  SYNTHETIC_IDS,
  fulfillJson,
  installSyntheticApi,
  success,
} from "./syntheticApi";

const FOLLOW_NOTIFICATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMMENT_NOTIFICATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function actor() {
  return {
    id: SYNTHETIC_IDS.publicProfile,
    displayName: "Synthetische bouwer",
    slug: "synthetische-bouwer",
    avatar: null,
  };
}

async function installNotificationFixture(page: Parameters<typeof installSyntheticApi>[0]) {
  const statuses = new Map([
    [FOLLOW_NOTIFICATION_ID, "unread" as const],
    [COMMENT_NOTIFICATION_ID, "unread" as const],
  ]);
  const archived = new Set<string>();

  return installSyntheticApi(page, {
    handle: async ({ request, route, url }) => {
      if (request.method() === "GET" && url.pathname === "/api/notifications") {
        const items = [
          {
            id: FOLLOW_NOTIFICATION_ID,
            type: "profile.follow.requested",
            status: statuses.get(FOLLOW_NOTIFICATION_ID) ?? "read",
            actor: actor(),
            projectId: null,
            updateId: null,
            commentId: null,
            orderId: null,
            readAt: statuses.get(FOLLOW_NOTIFICATION_ID) === "read" ? FIXED_NOW : null,
            createdAt: FIXED_NOW,
          },
          {
            id: COMMENT_NOTIFICATION_ID,
            type: "comment.created",
            status: statuses.get(COMMENT_NOTIFICATION_ID) ?? "read",
            actor: actor(),
            projectId: SYNTHETIC_IDS.project,
            updateId: SYNTHETIC_IDS.update,
            commentId: COMMENT_NOTIFICATION_ID,
            orderId: null,
            readAt: statuses.get(COMMENT_NOTIFICATION_ID) === "read" ? FIXED_NOW : null,
            createdAt: FIXED_NOW,
          },
        ].filter((item) => !archived.has(item.id));
        const unreadCount = items.filter((item) => item.status === "unread").length;
        await fulfillJson(route, success({ items, nextCursor: null, unreadCount }));
        return true;
      }
      if (request.method() === "PATCH" && url.pathname === "/api/notifications") {
        const body = request.postDataJSON() as { action: "read_all" };
        const updatedCount = [...statuses.values()].filter((status) => status === "unread").length;
        if (body.action === "read_all") {
          statuses.forEach((_status, notificationId) => statuses.set(notificationId, "read"));
        }
        await fulfillJson(route, success({
          updatedCount,
          unreadCount: 0,
        }));
        return true;
      }
      const notificationMatch = url.pathname.match(/^\/api\/notifications\/([0-9a-f-]{36})$/);
      if (request.method() === "PATCH" && notificationMatch?.[1]) {
        const notificationId = notificationMatch[1];
        const body = request.postDataJSON() as { action: "read" | "archive" };
        if (body.action === "archive") archived.add(notificationId);
        else statuses.set(notificationId, "read");
        await fulfillJson(route, success({
          notificationId,
          status: body.action === "archive" ? "archived" : "read",
          replayed: false,
        }));
        return true;
      }
      if (
        request.method() === "POST"
        && url.pathname === `/api/social/follow-requests/${SYNTHETIC_IDS.publicProfile}/accept`
      ) {
        await fulfillJson(route, success({ state: "following", replayed: false }));
        return true;
      }
      return false;
    },
  });
}

test.describe("Notificaties", () => {
  test("markeert alle meldingen server-side gelezen en archiveert afzonderlijk", async ({ page }) => {
    const fixture = await installNotificationFixture(page);
    await page.goto(`${BASE}/notificaties`);

    await expect(page.getByRole("heading", { name: "Notificaties" })).toBeVisible();
    await page.getByRole("button", { name: "Alles gelezen" }).click();
    await expect(page.getByText("Alle meldingen gemarkeerd als gelezen")).toBeVisible();
    await expect(page.getByRole("button", { name: "Markeer als gelezen" })).toHaveCount(0);

    await page.getByRole("button", { name: "Archiveren" }).first().click();
    await expect(page.getByText("Melding gearchiveerd")).toBeVisible();
    await expect(page.getByText("Synthetische bouwer wil je volgen")).toHaveCount(0);

    expect(fixture.requests).toContainEqual(expect.objectContaining({
      method: "PATCH",
      pathname: "/api/notifications",
      body: { action: "read_all" },
    }));
    expect(fixture.requests).toContainEqual(expect.objectContaining({
      method: "PATCH",
      pathname: `/api/notifications/${FOLLOW_NOTIFICATION_ID}`,
      body: { action: "archive" },
    }));
    expect(fixture.unhandled).toEqual([]);
  });

  test("keurt een privé-volgverzoek goed en archiveert de bronmelding", async ({ page }) => {
    const fixture = await installNotificationFixture(page);
    await page.goto(`${BASE}/notificaties`);

    await page.getByRole("button", { name: "Goedkeuren" }).click();
    await expect(page.getByText("Verzoek goedgekeurd")).toBeVisible();
    await expect(page.getByText("Synthetische bouwer wil je volgen")).toHaveCount(0);

    expect(fixture.requests).toContainEqual(expect.objectContaining({
      method: "POST",
      pathname: `/api/social/follow-requests/${SYNTHETIC_IDS.publicProfile}/accept`,
    }));
    expect(fixture.requests).toContainEqual(expect.objectContaining({
      method: "PATCH",
      pathname: `/api/notifications/${FOLLOW_NOTIFICATION_ID}`,
      body: { action: "archive" },
    }));
    expect(fixture.unhandled).toEqual([]);
  });
});
