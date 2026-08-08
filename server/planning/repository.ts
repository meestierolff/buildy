import { eq, sql } from "drizzle-orm";
import { outboxEvents } from "../../db/schema/index.js";
import type {
  Floorplan,
  FloorplanBoard,
  PlanningMutationResult,
  ProjectBudget,
} from "../../shared/contracts/planning.js";
import type { BuildyDatabase } from "../db/client.js";
import type { ProjectActor } from "../projects/actor.js";
import { PlanningError } from "./errors.js";
import type {
  CreateBudgetCommand,
  CreateBudgetItemCommand,
  CreateFloorplanCommand,
  CreatePinCommand,
  DeleteBudgetCommand,
  DeleteBudgetItemCommand,
  DeleteFloorplanCommand,
  DeletePinCommand,
  PlanningRepository,
  UpdateBudgetCommand,
  UpdateBudgetItemCommand,
  UpdateFloorplanCommand,
  UpdatePinCommand,
} from "./types.js";

type TransactionCallback = Parameters<BuildyDatabase["transaction"]>[0];
type DatabaseTransaction = Parameters<TransactionCallback>[0];

type CommandIdentity = {
  actorId: string;
  projectId: string;
  idempotencyKey: string;
  requestHash: string;
};

type ResourceType = PlanningMutationResult["resourceType"];

type MutationRecord = {
  id: string;
  version: number | null;
};

type PlanningOutboxPayload = {
  schemaVersion: 1;
  requestHash: string;
  resourceId: string;
  resourceType: ResourceType;
  resourceVersion: number | null;
};

type RawFloorplan = Omit<Floorplan, "floorNumber" | "sortOrder" | "version" | "pins"> & {
  floorNumber: number | string | null;
  sortOrder: number | string;
  version: number | string;
  pins: Array<Floorplan["pins"][number] & {
    version: number | string;
    x: number | string;
    y: number | string;
  }>;
};

type RawFloorplanBoard = {
  project_id: string;
  viewer_access: "owner" | "granted" | "public";
  floorplans: RawFloorplan[] | string;
};

type RawBudgetItem = ProjectBudget["items"][number] & {
  amountMinor: number | string;
  sortOrder: number | string;
  version: number | string;
};

type RawProjectBudget = {
  id: string;
  project_id: string;
  currency: string;
  planned_amount_minor: number | string;
  version: number | string;
  allocated_amount_minor: number | string;
  actual_amount_minor: number | string;
  items: RawBudgetItem[] | string;
};

function actorIdFor(viewer: ProjectActor): string | null {
  return viewer.kind === "authenticated" ? viewer.appUserId : null;
}

function jsonArray<T>(value: T[] | string): T[] {
  if (typeof value !== "string") return value;
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new PlanningError("RESOURCE_NOT_FOUND");
  return parsed as T[];
}

function safeInteger(value: number | string): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) throw new PlanningError("INVALID_STATE");
  return numeric;
}

function mapFloorplanBoard(row: RawFloorplanBoard): FloorplanBoard {
  const floorplans = jsonArray(row.floorplans).map((floorplan) => ({
    ...floorplan,
    floorNumber: floorplan.floorNumber === null ? null : safeInteger(floorplan.floorNumber),
    sortOrder: safeInteger(floorplan.sortOrder),
    version: safeInteger(floorplan.version),
    pins: floorplan.pins.map((pin) => ({
      ...pin,
      x: Number(pin.x),
      y: Number(pin.y),
      version: safeInteger(pin.version),
    })),
  }));
  return {
    projectId: row.project_id,
    viewerAccess: row.viewer_access,
    canEdit: row.viewer_access === "owner",
    floorplans,
  };
}

function mapBudget(row: RawProjectBudget): ProjectBudget {
  const plannedAmountMinor = safeInteger(row.planned_amount_minor);
  const allocatedAmountMinor = safeInteger(row.allocated_amount_minor);
  const actualAmountMinor = safeInteger(row.actual_amount_minor);
  const remainingAmountMinor = plannedAmountMinor - actualAmountMinor;
  if (!Number.isSafeInteger(remainingAmountMinor)) throw new PlanningError("INVALID_STATE");
  return {
    id: row.id,
    projectId: row.project_id,
    currency: row.currency,
    plannedAmountMinor,
    version: safeInteger(row.version),
    totals: {
      allocatedAmountMinor,
      actualAmountMinor,
      remainingAmountMinor,
    },
    items: jsonArray(row.items).map((item) => ({
      ...item,
      amountMinor: safeInteger(item.amountMinor),
      sortOrder: safeInteger(item.sortOrder),
      version: safeInteger(item.version),
    })),
  };
}

async function setActor(transaction: DatabaseTransaction, actorId: string | null): Promise<void> {
  await transaction.execute(sql`select set_config('app.actor_id', ${actorId ?? ""}, true)`);
}

async function lockOwnedProject(
  transaction: DatabaseTransaction,
  actorId: string,
  projectId: string,
): Promise<void> {
  const result = await transaction.execute<{ id: string }>(sql`
    select project.id
    from projects project
    join app_users actor
      on actor.id = project.owner_id
     and actor.id = ${actorId}::uuid
     and actor.status = 'active'
     and actor.deleted_at is null
    where project.id = ${projectId}::uuid
      and project.owner_id = ${actorId}::uuid
      and project.lifecycle_status = 'active'
      and project.deleted_at is null
      and not app_users_are_blocked(${actorId}::uuid, project.owner_id)
    for update of project
  `);
  if (!result.rows[0]) throw new PlanningError("RESOURCE_NOT_FOUND");
}

async function lockIdempotencyKey(
  transaction: DatabaseTransaction,
  idempotencyKey: string,
): Promise<void> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0))`,
  );
}

function isPlanningPayload(value: unknown): value is PlanningOutboxPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<PlanningOutboxPayload>;
  return payload.schemaVersion === 1
    && typeof payload.requestHash === "string"
    && typeof payload.resourceId === "string"
    && typeof payload.resourceType === "string"
    && (payload.resourceVersion === null || Number.isInteger(payload.resourceVersion));
}

async function replayedMutation(
  transaction: DatabaseTransaction,
  command: CommandIdentity,
  resourceType: ResourceType,
  eventType: string,
): Promise<PlanningMutationResult | null> {
  const records = await transaction
    .select({ eventType: outboxEvents.eventType, payload: outboxEvents.payload })
    .from(outboxEvents)
    .where(eq(outboxEvents.idempotencyKey, command.idempotencyKey))
    .limit(1);
  const existing = records[0];
  if (!existing) return null;
  if (
    existing.eventType !== eventType
    || !isPlanningPayload(existing.payload)
    || existing.payload.requestHash !== command.requestHash
    || existing.payload.resourceType !== resourceType
  ) {
    throw new PlanningError("IDEMPOTENCY_CONFLICT");
  }
  return {
    resourceType,
    id: existing.payload.resourceId,
    version: existing.payload.resourceVersion,
    replayed: true,
  };
}

export function buildPlanningOutboxRecord(
  command: CommandIdentity,
  resourceType: ResourceType,
  eventType: string,
  resource: MutationRecord,
) {
  const payload: PlanningOutboxPayload = {
    schemaVersion: 1,
    requestHash: command.requestHash,
    resourceId: resource.id,
    resourceType,
    resourceVersion: resource.version,
  };
  return {
    aggregateType: "project" as const,
    aggregateId: command.projectId,
    eventType,
    idempotencyKey: command.idempotencyKey,
    payload,
  };
}

async function appendMutationEvent(
  transaction: DatabaseTransaction,
  command: CommandIdentity,
  resourceType: ResourceType,
  eventType: string,
  resource: MutationRecord,
): Promise<void> {
  await transaction.insert(outboxEvents).values(
    buildPlanningOutboxRecord(command, resourceType, eventType, resource),
  );
}

function databaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? databaseErrorCode(error.cause) : undefined;
}

function translateDatabaseError(error: unknown): never {
  if (error instanceof PlanningError) throw error;
  const code = databaseErrorCode(error);
  if (code === "23503") throw new PlanningError("RESOURCE_NOT_FOUND", { cause: error });
  if (code === "23505" || code === "23514" || code === "23P01") {
    throw new PlanningError("INVALID_STATE", { cause: error });
  }
  throw error;
}

async function runMutation(
  database: BuildyDatabase,
  command: CommandIdentity,
  resourceType: ResourceType,
  eventType: string,
  mutation: (transaction: DatabaseTransaction) => Promise<MutationRecord>,
): Promise<PlanningMutationResult> {
  try {
    return await database.transaction(async (transaction) => {
      await setActor(transaction, command.actorId);
      await lockOwnedProject(transaction, command.actorId, command.projectId);
      await lockIdempotencyKey(transaction, command.idempotencyKey);
      const replay = await replayedMutation(transaction, command, resourceType, eventType);
      if (replay) return replay;
      const resource = await mutation(transaction);
      await appendMutationEvent(transaction, command, resourceType, eventType, resource);
      return { resourceType, ...resource, replayed: false };
    });
  } catch (error) {
    translateDatabaseError(error);
  }
}

async function assertReadyFloorplanAsset(
  transaction: DatabaseTransaction,
  actorId: string,
  projectId: string,
  assetId: string,
): Promise<void> {
  const result = await transaction.execute<{ id: string }>(sql`
    select asset.id
    from media_assets asset
    where asset.id = ${assetId}::uuid
      and asset.project_id = ${projectId}::uuid
      and asset.owner_id = ${actorId}::uuid
      and asset.original_asset_id is null
      and asset.purpose = 'floorplan'
      and asset.status = 'ready'
      and asset.is_current
      and asset.deleted_at is null
      and asset.ready_at is not null
      and asset.detected_content_type like 'image/%'
      and asset.size_bytes is not null
      and asset.sha256 is not null
      and asset.width_pixels > 0
      and asset.height_pixels > 0
    for share
  `);
  if (!result.rows[0]) throw new PlanningError("RESOURCE_NOT_FOUND");
}

async function assertReadyFloorplan(
  transaction: DatabaseTransaction,
  actorId: string,
  projectId: string,
  floorplanId: string,
): Promise<void> {
  const result = await transaction.execute<{ id: string }>(sql`
    select floorplan.id
    from floorplans floorplan
    join media_assets asset
      on asset.id = floorplan.media_asset_id
     and asset.project_id = floorplan.project_id
     and asset.owner_id = floorplan.owner_id
    where floorplan.id = ${floorplanId}::uuid
      and floorplan.project_id = ${projectId}::uuid
      and floorplan.owner_id = ${actorId}::uuid
      and asset.original_asset_id is null
      and asset.purpose = 'floorplan'
      and asset.status = 'ready'
      and asset.is_current
      and asset.deleted_at is null
      and asset.ready_at is not null
      and asset.detected_content_type like 'image/%'
      and asset.size_bytes is not null
      and asset.sha256 is not null
      and asset.width_pixels > 0
      and asset.height_pixels > 0
    for share of floorplan, asset
  `);
  if (!result.rows[0]) throw new PlanningError("RESOURCE_NOT_FOUND");
}

async function assertProjectUpdate(
  transaction: DatabaseTransaction,
  actorId: string,
  projectId: string,
  updateId: string | null | undefined,
): Promise<void> {
  if (!updateId) return;
  const result = await transaction.execute<{ id: string }>(sql`
    select project_update.id
    from updates project_update
    where project_update.id = ${updateId}::uuid
      and project_update.project_id = ${projectId}::uuid
      and project_update.project_owner_id = ${actorId}::uuid
      and project_update.author_id = ${actorId}::uuid
      and project_update.status in ('draft', 'published')
      and project_update.deleted_at is null
    for share
  `);
  if (!result.rows[0]) throw new PlanningError("RESOURCE_NOT_FOUND");
}

async function lockBudget(
  transaction: DatabaseTransaction,
  actorId: string,
  projectId: string,
): Promise<{ id: string; version: number }> {
  const result = await transaction.execute<{ id: string; version: number }>(sql`
    select budget.id, budget.version
    from project_budgets budget
    where budget.project_id = ${projectId}::uuid
      and budget.owner_id = ${actorId}::uuid
      and budget.is_shared = false
    for update
  `);
  const budget = result.rows[0];
  if (!budget) throw new PlanningError("RESOURCE_NOT_FOUND");
  return { id: budget.id, version: Number(budget.version) };
}

async function explainVersionFailure(
  transaction: DatabaseTransaction,
  query: ReturnType<typeof sql>,
): Promise<never> {
  const result = await transaction.execute<{ version: number }>(query);
  if (result.rows[0]) throw new PlanningError("VERSION_CONFLICT");
  throw new PlanningError("RESOURCE_NOT_FOUND");
}

export class PostgresPlanningRepository implements PlanningRepository {
  constructor(private readonly database: BuildyDatabase) {}

  async listFloorplans(viewer: ProjectActor, projectId: string): Promise<FloorplanBoard | null> {
    return this.database.transaction(async (transaction) => {
      const actorId = actorIdFor(viewer);
      await setActor(transaction, actorId);
      const result = await transaction.execute<RawFloorplanBoard>(sql`
        select
          project.id as project_id,
          case
            when project.owner_id = ${actorId}::uuid then 'owner'
            when accepted_access.id is not null then 'granted'
            else 'public'
          end as viewer_access,
          coalesce((
            select jsonb_agg(entry.document order by entry.sort_order, entry.id)
            from (
              select
                floorplan.sort_order,
                floorplan.id,
                jsonb_build_object(
                  'id', floorplan.id,
                  'name', floorplan.name,
                  'floorNumber', floorplan.floor_number,
                  'sortOrder', floorplan.sort_order,
                  'version', floorplan.version,
                  'media', jsonb_build_object(
                    'id', asset.id,
                    'status', 'ready',
                    'contentType', asset.detected_content_type,
                    'width', asset.width_pixels,
                    'height', asset.height_pixels,
                    'proxyPath', '/api/media/' || asset.id::text
                  ),
                  'pins', coalesce((
                    select jsonb_agg(jsonb_build_object(
                      'id', pin.id,
                      'updateId', pin.update_id,
                      'x', pin.x,
                      'y', pin.y,
                      'label', pin.label,
                      'version', pin.version,
                      'update', jsonb_build_object(
                        'title', project_update.title,
                        'updateDate', project_update.update_date,
                        'status', project_update.status
                      )
                    ) order by pin.created_at, pin.id)
                    from floorplan_pins pin
                    join updates project_update
                      on project_update.id = pin.update_id
                     and project_update.project_id = pin.project_id
                    where pin.floorplan_id = floorplan.id
                      and pin.project_id = project.id
                      and project_update.status in ('draft', 'published')
                      and project_update.deleted_at is null
                      and (
                        project.owner_id = ${actorId}::uuid
                        or project_update.status = 'published'
                      )
                  ), '[]'::jsonb)
                ) as document
              from floorplans floorplan
              join media_assets asset
                on asset.id = floorplan.media_asset_id
               and asset.project_id = floorplan.project_id
               and asset.owner_id = floorplan.owner_id
              where floorplan.project_id = project.id
                and asset.original_asset_id is null
                and asset.purpose = 'floorplan'
                and asset.status = 'ready'
                and asset.is_current
                and asset.deleted_at is null
                and asset.ready_at is not null
                and asset.detected_content_type like 'image/%'
                and asset.size_bytes is not null
                and asset.sha256 is not null
                and asset.width_pixels > 0
                and asset.height_pixels > 0
            ) entry
          ), '[]'::jsonb) as floorplans
        from projects project
        left join project_access_requests accepted_access
          on accepted_access.project_id = project.id
         and accepted_access.requester_id = ${actorId}::uuid
         and accepted_access.status = 'accepted'
        where project.id = ${projectId}::uuid
          and project.lifecycle_status = 'active'
          and project.deleted_at is null
          and not app_users_are_blocked(${actorId}::uuid, project.owner_id)
          and (
            project.owner_id = ${actorId}::uuid
            or project.visibility = 'public'
            or accepted_access.id is not null
          )
        limit 1
      `);
      const row = result.rows[0];
      return row ? mapFloorplanBoard(row) : null;
    });
  }

  async createFloorplan(command: CreateFloorplanCommand): Promise<PlanningMutationResult> {
    return runMutation(this.database, command, "floorplan", "floorplan.created.v1", async (transaction) => {
      await assertReadyFloorplanAsset(
        transaction, command.actorId, command.projectId, command.input.mediaAssetId,
      );
      const result = await transaction.execute<{ id: string; version: number }>(sql`
        insert into floorplans (
          id, project_id, owner_id, media_asset_id, name, floor_number, sort_order, version
        ) values (
          ${command.floorplanId}::uuid,
          ${command.projectId}::uuid,
          ${command.actorId}::uuid,
          ${command.input.mediaAssetId}::uuid,
          ${command.input.name},
          ${command.input.floorNumber ?? null},
          ${command.input.sortOrder},
          1
        )
        returning id, version
      `);
      return result.rows[0]!;
    });
  }

  async updateFloorplan(command: UpdateFloorplanCommand): Promise<PlanningMutationResult> {
    return runMutation(this.database, command, "floorplan", "floorplan.updated.v1", async (transaction) => {
      await assertReadyFloorplan(transaction, command.actorId, command.projectId, command.floorplanId);
      const hasFloorNumber = Object.hasOwn(command.input, "floorNumber");
      const result = await transaction.execute<{ id: string; version: number }>(sql`
        update floorplans floorplan
        set
          name = case when ${command.input.name !== undefined} then ${command.input.name ?? null} else floorplan.name end,
          floor_number = case when ${hasFloorNumber} then ${command.input.floorNumber ?? null} else floorplan.floor_number end,
          sort_order = case when ${command.input.sortOrder !== undefined} then ${command.input.sortOrder ?? null} else floorplan.sort_order end,
          version = floorplan.version + 1,
          updated_at = statement_timestamp()
        where floorplan.id = ${command.floorplanId}::uuid
          and floorplan.project_id = ${command.projectId}::uuid
          and floorplan.owner_id = ${command.actorId}::uuid
          and floorplan.version = ${command.input.expectedVersion}
        returning floorplan.id, floorplan.version
      `);
      const row = result.rows[0];
      if (row) return row;
      return explainVersionFailure(transaction, sql`
        select floorplan.version
        from floorplans floorplan
        where floorplan.id = ${command.floorplanId}::uuid
          and floorplan.project_id = ${command.projectId}::uuid
          and floorplan.owner_id = ${command.actorId}::uuid
        limit 1
      `);
    });
  }

  async deleteFloorplan(command: DeleteFloorplanCommand): Promise<PlanningMutationResult> {
    return runMutation(this.database, command, "floorplan", "floorplan.deleted.v1", async (transaction) => {
      const result = await transaction.execute<{ id: string }>(sql`
        delete from floorplans floorplan
        where floorplan.id = ${command.floorplanId}::uuid
          and floorplan.project_id = ${command.projectId}::uuid
          and floorplan.owner_id = ${command.actorId}::uuid
          and floorplan.version = ${command.input.expectedVersion}
        returning floorplan.id
      `);
      const row = result.rows[0];
      if (row) return { id: row.id, version: null };
      return explainVersionFailure(transaction, sql`
        select floorplan.version from floorplans floorplan
        where floorplan.id = ${command.floorplanId}::uuid
          and floorplan.project_id = ${command.projectId}::uuid
          and floorplan.owner_id = ${command.actorId}::uuid
        limit 1
      `);
    });
  }

  async createPin(command: CreatePinCommand): Promise<PlanningMutationResult> {
    return runMutation(this.database, command, "floorplan_pin", "floorplan.pin.created.v1", async (transaction) => {
      await assertReadyFloorplan(transaction, command.actorId, command.projectId, command.floorplanId);
      await assertProjectUpdate(transaction, command.actorId, command.projectId, command.input.updateId);
      const result = await transaction.execute<{ id: string; version: number }>(sql`
        insert into floorplan_pins (
          id, project_id, floorplan_id, update_id, x, y, label, version
        ) values (
          ${command.pinId}::uuid,
          ${command.projectId}::uuid,
          ${command.floorplanId}::uuid,
          ${command.input.updateId}::uuid,
          ${command.input.x}::numeric,
          ${command.input.y}::numeric,
          ${command.input.label ?? null},
          1
        )
        returning id, version
      `);
      return result.rows[0]!;
    });
  }

  async updatePin(command: UpdatePinCommand): Promise<PlanningMutationResult> {
    return runMutation(this.database, command, "floorplan_pin", "floorplan.pin.updated.v1", async (transaction) => {
      await assertReadyFloorplan(transaction, command.actorId, command.projectId, command.floorplanId);
      const hasLabel = Object.hasOwn(command.input, "label");
      const result = await transaction.execute<{ id: string; version: number }>(sql`
        update floorplan_pins pin
        set
          x = case when ${command.input.x !== undefined} then ${command.input.x ?? null}::numeric else pin.x end,
          y = case when ${command.input.y !== undefined} then ${command.input.y ?? null}::numeric else pin.y end,
          label = case when ${hasLabel} then ${command.input.label ?? null} else pin.label end,
          version = pin.version + 1,
          updated_at = statement_timestamp()
        where pin.id = ${command.pinId}::uuid
          and pin.project_id = ${command.projectId}::uuid
          and pin.floorplan_id = ${command.floorplanId}::uuid
          and pin.version = ${command.input.expectedVersion}
        returning pin.id, pin.version
      `);
      const row = result.rows[0];
      if (row) return row;
      return explainVersionFailure(transaction, sql`
        select pin.version from floorplan_pins pin
        where pin.id = ${command.pinId}::uuid
          and pin.project_id = ${command.projectId}::uuid
          and pin.floorplan_id = ${command.floorplanId}::uuid
        limit 1
      `);
    });
  }

  async deletePin(command: DeletePinCommand): Promise<PlanningMutationResult> {
    return runMutation(this.database, command, "floorplan_pin", "floorplan.pin.deleted.v1", async (transaction) => {
      await assertReadyFloorplan(transaction, command.actorId, command.projectId, command.floorplanId);
      const result = await transaction.execute<{ id: string }>(sql`
        delete from floorplan_pins pin
        where pin.id = ${command.pinId}::uuid
          and pin.project_id = ${command.projectId}::uuid
          and pin.floorplan_id = ${command.floorplanId}::uuid
          and pin.version = ${command.input.expectedVersion}
        returning pin.id
      `);
      const row = result.rows[0];
      if (row) return { id: row.id, version: null };
      return explainVersionFailure(transaction, sql`
        select pin.version from floorplan_pins pin
        where pin.id = ${command.pinId}::uuid
          and pin.project_id = ${command.projectId}::uuid
          and pin.floorplan_id = ${command.floorplanId}::uuid
        limit 1
      `);
    });
  }

  async getBudget(actorId: string, projectId: string): Promise<ProjectBudget | null> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, actorId);
      const result = await transaction.execute<RawProjectBudget>(sql`
        select
          budget.id,
          budget.project_id,
          budget.currency,
          budget.planned_amount_minor,
          budget.version,
          coalesce(items.allocated_amount_minor, 0)::text as allocated_amount_minor,
          coalesce(items.actual_amount_minor, 0)::text as actual_amount_minor,
          coalesce(items.documents, '[]'::jsonb) as items
        from projects project
        join project_budgets budget
          on budget.project_id = project.id
         and budget.owner_id = project.owner_id
        left join lateral (
          select
            coalesce(sum(item.amount_minor) filter (where item.kind = 'planned'), 0) as allocated_amount_minor,
            coalesce(sum(item.amount_minor) filter (where item.kind = 'actual'), 0) as actual_amount_minor,
            jsonb_agg(jsonb_build_object(
              'id', item.id,
              'updateId', item.update_id,
              'kind', item.kind,
              'category', item.category,
              'description', item.description,
              'amountMinor', item.amount_minor,
              'occurredOn', item.occurred_on,
              'sortOrder', item.sort_order,
              'version', item.version
            ) order by item.sort_order, item.created_at, item.id) as documents
          from budget_items item
          where item.budget_id = budget.id
            and item.project_id = project.id
        ) items on true
        where project.id = ${projectId}::uuid
          and project.owner_id = ${actorId}::uuid
          and project.lifecycle_status = 'active'
          and project.deleted_at is null
          and budget.is_shared = false
          and not app_users_are_blocked(${actorId}::uuid, project.owner_id)
        limit 1
      `);
      const row = result.rows[0];
      return row ? mapBudget(row) : null;
    });
  }

  async createBudget(command: CreateBudgetCommand): Promise<PlanningMutationResult> {
    return runMutation(this.database, command, "budget", "budget.created.v1", async (transaction) => {
      const result = await transaction.execute<{ id: string; version: number }>(sql`
        insert into project_budgets (
          id, project_id, owner_id, currency, planned_amount_minor, is_shared, version
        ) values (
          ${command.budgetId}::uuid,
          ${command.projectId}::uuid,
          ${command.actorId}::uuid,
          ${command.currency},
          ${command.input.plannedAmountMinor},
          false,
          1
        )
        returning id, version
      `);
      return result.rows[0]!;
    });
  }

  async updateBudget(command: UpdateBudgetCommand): Promise<PlanningMutationResult> {
    return runMutation(this.database, command, "budget", "budget.updated.v1", async (transaction) => {
      const result = await transaction.execute<{ id: string; version: number }>(sql`
        update project_budgets budget
        set
          planned_amount_minor = ${command.input.plannedAmountMinor},
          version = budget.version + 1,
          updated_at = statement_timestamp()
        where budget.project_id = ${command.projectId}::uuid
          and budget.owner_id = ${command.actorId}::uuid
          and budget.is_shared = false
          and budget.version = ${command.input.expectedVersion}
        returning budget.id, budget.version
      `);
      const row = result.rows[0];
      if (row) return row;
      return explainVersionFailure(transaction, sql`
        select budget.version from project_budgets budget
        where budget.project_id = ${command.projectId}::uuid
          and budget.owner_id = ${command.actorId}::uuid
          and budget.is_shared = false
        limit 1
      `);
    });
  }

  async deleteBudget(command: DeleteBudgetCommand): Promise<PlanningMutationResult> {
    return runMutation(this.database, command, "budget", "budget.deleted.v1", async (transaction) => {
      const result = await transaction.execute<{ id: string }>(sql`
        delete from project_budgets budget
        where budget.project_id = ${command.projectId}::uuid
          and budget.owner_id = ${command.actorId}::uuid
          and budget.is_shared = false
          and budget.version = ${command.input.expectedVersion}
        returning budget.id
      `);
      const row = result.rows[0];
      if (row) return { id: row.id, version: null };
      return explainVersionFailure(transaction, sql`
        select budget.version from project_budgets budget
        where budget.project_id = ${command.projectId}::uuid
          and budget.owner_id = ${command.actorId}::uuid
          and budget.is_shared = false
        limit 1
      `);
    });
  }

  async createBudgetItem(command: CreateBudgetItemCommand): Promise<PlanningMutationResult> {
    return runMutation(this.database, command, "budget_item", "budget.item.created.v1", async (transaction) => {
      const budget = await lockBudget(transaction, command.actorId, command.projectId);
      await assertProjectUpdate(transaction, command.actorId, command.projectId, command.input.updateId);
      const result = await transaction.execute<{ id: string; version: number }>(sql`
        insert into budget_items (
          id, budget_id, project_id, update_id, created_by_id, kind, category,
          description, amount_minor, occurred_on, sort_order, version
        ) values (
          ${command.itemId}::uuid,
          ${budget.id}::uuid,
          ${command.projectId}::uuid,
          ${command.input.updateId ?? null}::uuid,
          ${command.actorId}::uuid,
          ${command.input.kind}::budget_item_kind,
          ${command.input.category},
          ${command.input.description ?? null},
          ${command.input.amountMinor},
          ${command.input.occurredOn ?? null}::date,
          ${command.input.sortOrder},
          1
        )
        returning id, version
      `);
      return result.rows[0]!;
    });
  }

  async updateBudgetItem(command: UpdateBudgetItemCommand): Promise<PlanningMutationResult> {
    return runMutation(this.database, command, "budget_item", "budget.item.updated.v1", async (transaction) => {
      const budget = await lockBudget(transaction, command.actorId, command.projectId);
      if (Object.hasOwn(command.input, "updateId")) {
        await assertProjectUpdate(transaction, command.actorId, command.projectId, command.input.updateId);
      }
      const hasUpdateId = Object.hasOwn(command.input, "updateId");
      const hasDescription = Object.hasOwn(command.input, "description");
      const hasOccurredOn = Object.hasOwn(command.input, "occurredOn");
      const result = await transaction.execute<{ id: string; version: number }>(sql`
        update budget_items item
        set
          update_id = case when ${hasUpdateId} then ${command.input.updateId ?? null}::uuid else item.update_id end,
          kind = case when ${command.input.kind !== undefined} then ${command.input.kind ?? null}::budget_item_kind else item.kind end,
          category = case when ${command.input.category !== undefined} then ${command.input.category ?? null} else item.category end,
          description = case when ${hasDescription} then ${command.input.description ?? null} else item.description end,
          amount_minor = case when ${command.input.amountMinor !== undefined} then ${command.input.amountMinor ?? null} else item.amount_minor end,
          occurred_on = case when ${hasOccurredOn} then ${command.input.occurredOn ?? null}::date else item.occurred_on end,
          sort_order = case when ${command.input.sortOrder !== undefined} then ${command.input.sortOrder ?? null} else item.sort_order end,
          version = item.version + 1,
          updated_at = statement_timestamp()
        where item.id = ${command.itemId}::uuid
          and item.budget_id = ${budget.id}::uuid
          and item.project_id = ${command.projectId}::uuid
          and item.version = ${command.input.expectedVersion}
        returning item.id, item.version
      `);
      const row = result.rows[0];
      if (row) return row;
      return explainVersionFailure(transaction, sql`
        select item.version from budget_items item
        where item.id = ${command.itemId}::uuid
          and item.budget_id = ${budget.id}::uuid
          and item.project_id = ${command.projectId}::uuid
        limit 1
      `);
    });
  }

  async deleteBudgetItem(command: DeleteBudgetItemCommand): Promise<PlanningMutationResult> {
    return runMutation(this.database, command, "budget_item", "budget.item.deleted.v1", async (transaction) => {
      const budget = await lockBudget(transaction, command.actorId, command.projectId);
      const result = await transaction.execute<{ id: string }>(sql`
        delete from budget_items item
        where item.id = ${command.itemId}::uuid
          and item.budget_id = ${budget.id}::uuid
          and item.project_id = ${command.projectId}::uuid
          and item.version = ${command.input.expectedVersion}
        returning item.id
      `);
      const row = result.rows[0];
      if (row) return { id: row.id, version: null };
      return explainVersionFailure(transaction, sql`
        select item.version from budget_items item
        where item.id = ${command.itemId}::uuid
          and item.budget_id = ${budget.id}::uuid
          and item.project_id = ${command.projectId}::uuid
        limit 1
      `);
    });
  }
}
