import AxeBuilder from "@axe-core/playwright";

import { BASE, expect, test } from "./helpers";

const PUBLIC_ROUTES = [
  { label: "landing", path: "/" },
  { label: "ontdekken", path: "/ontdekken" },
  { label: "auth", path: "/auth" },
] as const;

for (const route of PUBLIC_ROUTES) {
  test(`${route.label} heeft geen ernstige toegankelijkheidsproblemen`, async ({ page }) => {
    await page.goto(`${BASE}${route.path}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#root")).toBeVisible();

    const result = await new AxeBuilder({ page }).analyze();
    const blocking = result.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        description: violation.description,
        targets: violation.nodes.flatMap((node) => node.target.map(String)),
      }));

    expect(blocking).toEqual([]);
  });
}
