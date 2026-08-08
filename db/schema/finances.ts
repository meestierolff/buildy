import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { appUsers } from "./auth.js";
import { budgetItemKindEnum, optimisticVersion, timestamps } from "./common.js";
import { projects, updates } from "./projects.js";

export const projectBudgets = pgTable(
  "project_budgets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull(),
    ownerId: uuid("owner_id").notNull(),
    currency: text("currency").default("EUR").notNull(),
    plannedAmountMinor: integer("planned_amount_minor").default(0).notNull(),
    isShared: boolean("is_shared").default(false).notNull(),
    version: optimisticVersion(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: "project_budgets_project_owner_fk",
      columns: [table.projectId, table.ownerId],
      foreignColumns: [projects.id, projects.ownerId],
    }).onDelete("cascade"),
    uniqueIndex("project_budgets_project_uq").on(table.projectId),
    unique("project_budgets_id_project_uq").on(table.id, table.projectId),
    check("project_budgets_currency_ck", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("project_budgets_amount_ck", sql`${table.plannedAmountMinor} >= 0`),
    check("project_budgets_private_ck", sql`${table.isShared} = false`),
    check("project_budgets_version_ck", sql`${table.version} > 0`),
  ],
);

export const budgetItems = pgTable(
  "budget_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    budgetId: uuid("budget_id").notNull(),
    projectId: uuid("project_id").notNull(),
    updateId: uuid("update_id"),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    kind: budgetItemKindEnum("kind").notNull(),
    category: text("category").notNull(),
    description: text("description"),
    amountMinor: integer("amount_minor").notNull(),
    occurredOn: date("occurred_on"),
    sortOrder: integer("sort_order").default(0).notNull(),
    version: optimisticVersion(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: "budget_items_budget_project_fk",
      columns: [table.budgetId, table.projectId],
      foreignColumns: [projectBudgets.id, projectBudgets.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "budget_items_update_project_fk",
      columns: [table.updateId, table.projectId],
      foreignColumns: [updates.id, updates.projectId],
    }).onDelete("restrict"),
    index("budget_items_budget_kind_idx").on(table.budgetId, table.kind, table.occurredOn),
    index("budget_items_update_idx").on(table.updateId),
    check("budget_items_category_ck", sql`char_length(btrim(${table.category})) BETWEEN 1 AND 80`),
    check("budget_items_description_ck", sql`${table.description} IS NULL OR char_length(${table.description}) <= 500`),
    check("budget_items_amount_ck", sql`${table.amountMinor} >= 0`),
    check("budget_items_sort_version_ck", sql`${table.sortOrder} >= 0 AND ${table.version} > 0`),
  ],
);
