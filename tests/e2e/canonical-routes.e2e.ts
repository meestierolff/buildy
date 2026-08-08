import { BASE, expect, test } from "./helpers";

test("een oude projectlink behoudt query en fragment op de canonieke route", async ({ page }) => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  await page.goto(
    `${BASE}/trip/${projectId}?tab=fotos&filter=voor%20en%20na#update-bestaand`,
    { waitUntil: "domcontentloaded" },
  );

  await expect.poll(() => {
    const url = new URL(page.url());
    return `${url.pathname}${url.search}${url.hash}`;
  }).toBe(`/project/${projectId}?tab=fotos&filter=voor%20en%20na#update-bestaand`);
});
