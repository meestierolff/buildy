import { test, expect, BASE } from "./helpers";

const ownerId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";

test("preserves a draft and accepts only one synthetic update submit", async ({ page }) => {
  let updateRequests = 0;
  let updatePayload: Record<string, unknown> | null = null;

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const respond = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
      headers: { "access-control-allow-origin": "*" },
    });

    if (url.pathname === "/api/auth/get-session") {
      return respond({
        session: {
          id: "44444444-4444-4444-8444-444444444444",
          userId: ownerId,
          expiresAt: "2099-08-05T20:00:00.000Z",
          createdAt: "2026-08-01T12:00:00.000Z",
          updatedAt: "2026-08-04T12:00:00.000Z",
        },
        user: {
          id: ownerId,
          name: "Synthetische eigenaar",
          email: "owner@example.invalid",
          emailVerified: true,
          image: null,
          createdAt: "2026-08-01T12:00:00.000Z",
          updatedAt: "2026-08-04T12:00:00.000Z",
        },
      });
    }

    if (url.pathname === `/api/projects/${projectId}` && request.method() === "GET") {
      return respond({
        data: {
          id: projectId,
          slug: "synthetisch-renovatieproject",
          title: "Synthetisch renovatieproject",
          description: "Veilige testdata voor de registratieflow.",
          projectType: "Volledige renovatie",
          visibility: "private",
          progressPercentage: 10,
          version: 3,
          updatedAt: "2026-08-04T12:00:00.000Z",
          publishedAt: null,
          updateCount: 0,
          lastUpdateAt: null,
          owner: { id: ownerId, displayName: "Synthetische eigenaar", slug: "synthetische-eigenaar" },
          cover: null,
          startDate: "2026-02-01",
          expectedEndDate: "2026-11-30",
          contentRevision: 1,
          followerCount: 0,
          viewerAccess: "owner",
          canEdit: true,
          phases: [],
        },
        meta: { requestId: "55555555-5555-4555-8555-555555555555" },
      });
    }
    if (url.pathname === `/api/projects/${projectId}/updates` && request.method() === "POST") {
      updateRequests += 1;
      updatePayload = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
      await new Promise((resolve) => setTimeout(resolve, 150));
      return respond({
        data: {
          update: {
            id: "33333333-3333-4333-8333-333333333333",
            projectId,
            phase: null,
            title: "De eerste muur is open",
            room: null,
            description: null,
            updateDate: "2026-08-04",
            status: "published",
            isMilestone: false,
            sortOrder: 0,
            contentRevision: 1,
            version: 1,
            publishedAt: "2026-08-04T12:00:00.000Z",
            updatedAt: "2026-08-04T12:00:00.000Z",
            media: [],
          },
          replayed: false,
        },
        meta: { requestId: "66666666-6666-4666-8666-666666666666" },
      }, 201);
    }

    return route.continue();
  });

  await page.goto(`${BASE}/project/${projectId}`);
  await page.getByRole("button", { name: "Update toevoegen", exact: true }).click();
  const title = page.getByLabel("Titel *");
  await title.fill("De eerste muur is open");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toContainText("Concept bewaren?");
  await page.getByRole("button", { name: "Verder met update" }).click();
  await expect(title).toHaveValue("De eerste muur is open");

  await page.getByRole("button", { name: "Update plaatsen" }).evaluate((button) => {
    button.click();
    button.click();
  });

  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(updateRequests).toBe(1);
  expect(updatePayload).toMatchObject({
    expectedProjectVersion: 3,
    title: "De eerste muur is open",
    publish: true,
    media: [],
  });
  expect(updatePayload).not.toHaveProperty("userId");
  expect(updatePayload).not.toHaveProperty("user_id");
  expect(updatePayload).not.toHaveProperty("storagePath");
});
