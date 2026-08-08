import { z } from "zod";
import { ProjectError } from "./errors.js";

const baseCursorSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
}).strict();

const dashboardCursorSchema = baseCursorSchema.extend({
  kind: z.literal("dashboard"),
  timestamp: z.string().datetime(),
});

const discoveryCursorSchema = baseCursorSchema.extend({
  kind: z.literal("discovery"),
  timestamp: z.string().datetime(),
});

const timelineCursorSchema = baseCursorSchema.extend({
  kind: z.literal("timeline"),
  updateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sortOrder: z.number().int().nonnegative(),
});

export type DashboardCursor = z.infer<typeof dashboardCursorSchema>;
export type DiscoveryCursor = z.infer<typeof discoveryCursorSchema>;
export type TimelineCursor = z.infer<typeof timelineCursorSchema>;
export type ProjectCursor = DashboardCursor | DiscoveryCursor | TimelineCursor;

export function encodeProjectCursor(cursor: ProjectCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeProjectCursor(
  value: string | undefined,
  kind: "dashboard",
): DashboardCursor | undefined;
export function decodeProjectCursor(
  value: string | undefined,
  kind: "discovery",
): DiscoveryCursor | undefined;
export function decodeProjectCursor(
  value: string | undefined,
  kind: "timeline",
): TimelineCursor | undefined;
export function decodeProjectCursor(
  value: string | undefined,
  kind: ProjectCursor["kind"],
): ProjectCursor | undefined {
  if (!value) return undefined;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (kind === "dashboard") return dashboardCursorSchema.parse(decoded);
    if (kind === "discovery") return discoveryCursorSchema.parse(decoded);
    return timelineCursorSchema.parse(decoded);
  } catch {
    throw new ProjectError("INVALID_CURSOR");
  }
}
