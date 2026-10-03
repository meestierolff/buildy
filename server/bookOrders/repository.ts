import { sql } from "drizzle-orm";
import { z } from "zod";
import { bookOrderSchema, type BookOrder, type UpdateBookOrderInput } from "../../shared/contracts/bookOrders.js";
import { photobookDocumentSchema, type PhotobookDocument } from "../../shared/contracts/photobooks.js";
import type { BuildyDatabase } from "../db/client.js";
import { HttpError } from "../http/errors.js";

export type StoredBookOrder = BookOrder & { cursorTime?: string; ownerId: string; deliveryCiphertext: string; document: PhotobookDocument; requestHash: string };
export type BookOrderAsset = { id: string; objectKey: string; sizeBytes: number };
export interface BookOrderRepository {
  list(actorId: string, projectId: string | null, cursor?: string): Promise<StoredBookOrder[]>;
  find(actorId: string, id: string): Promise<StoredBookOrder | null>;
  replay(actorId: string, key: string): Promise<StoredBookOrder | null>;
  create(input: { id: string; actorId: string; projectId: string; expectedVersion: number; checksum: string; quantity: number; deliveryCiphertext: string; key: string; requestHash: string }): Promise<{ order: StoredBookOrder; replayed: boolean }>;
  update(actorId: string, id: string, input: UpdateBookOrderInput): Promise<StoredBookOrder>;
  assets(actorId: string, orderId: string, requestId: string): Promise<BookOrderAsset[]>;
}

type Transaction = Parameters<Parameters<BuildyDatabase["transaction"]>[0]>[0];
async function setActor(tx: Transaction, id: string) { await tx.execute(sql`select set_config('app.actor_id', ${id}, true)`); }
function row(value: Record<string, unknown>): StoredBookOrder {
  const document = photobookDocumentSchema.parse(value.document);
  return {
    ...bookOrderSchema.parse({ id: value.id, projectId: value.project_id, title: document.cover.title,
      pageCount: document.pageCount, documentSha256: document.checksumSha256, quantity: value.quantity,
      status: value.status, reply: value.reply, version: value.version,
      createdAt: new Date(String(value.created_at)).toISOString(), updatedAt: new Date(String(value.updated_at)).toISOString() }),
    ownerId: z.string().uuid().parse(value.owner_id), deliveryCiphertext: z.string().parse(value.delivery_ciphertext),
    requestHash: z.string().parse(value.request_hash), document,
    cursorTime: typeof value.cursor_time === "string" ? value.cursor_time : undefined,
  };
}
const missing = () => new HttpError(404, "NOT_FOUND", "Deze boekaanvraag is niet beschikbaar.");
const conflict = () => new HttpError(409, "CONFLICT", "Het boek of de aanvraag is gewijzigd. Vernieuw en probeer opnieuw.");
export class PostgresBookOrderRepository implements BookOrderRepository {
  constructor(private readonly database: BuildyDatabase) {}
  async list(actorId: string, projectId: string | null, cursor?: string): Promise<StoredBookOrder[]> {
    return this.database.transaction(async tx => {
      await setActor(tx, actorId);
      const [cursorTime, cursorId] = cursor?.split("|") ?? [];
      const result = await tx.execute(sql`select *, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_time from public.book_requests where
        (${projectId}::uuid is null or (project_id = ${projectId}::uuid and owner_id = ${actorId}::uuid))
        and (${cursorTime ?? null}::timestamptz is null or (created_at, id) < (${cursorTime ?? null}::timestamptz, ${cursorId ?? null}::uuid))
        order by created_at desc, id desc limit ${projectId ? 100 : 51}`);
      return result.rows.map(row);
    });
  }
  async find(actorId: string, id: string): Promise<StoredBookOrder | null> {
    return this.database.transaction(async tx => {
      await setActor(tx, actorId);
      const result = await tx.execute(sql`select * from public.book_requests where id = ${id}::uuid`);
      return result.rows[0] ? row(result.rows[0]) : null;
    });
  }
  async replay(actorId: string, key: string): Promise<StoredBookOrder | null> {
    return this.database.transaction(async tx => {
      await setActor(tx, actorId);
      const result = await tx.execute(sql`select * from public.book_requests where owner_id = ${actorId}::uuid and idempotency_key = ${key}`);
      return result.rows[0] ? row(result.rows[0]) : null;
    });
  }
  async create(input: Parameters<BookOrderRepository["create"]>[0]) {
    return this.database.transaction(async tx => {
      await setActor(tx, input.actorId);
      // Serialize all submissions per owner: double taps and concurrent new keys cannot bypass limits.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`book-order:${input.actorId}`}, 0))`);
      const replay = await tx.execute(sql`select * from public.book_requests where owner_id = ${input.actorId}::uuid and idempotency_key = ${input.key}`);
      if (replay.rows[0]) {
        const order = row(replay.rows[0]);
        if (order.requestHash !== input.requestHash) throw conflict();
        return { order, replayed: true };
      }
      const duplicate = await tx.execute(sql`select * from public.book_requests where owner_id = ${input.actorId}::uuid and project_id = ${input.projectId}::uuid and status not in ('cancelled', 'shipped')`);
      if (duplicate.rows.length) throw new HttpError(409, "CONFLICT", "Er loopt al een boekaanvraag voor deze verbouwing.");
      const lifetime = await tx.execute<{ count: string }>(sql`select count(*)::text as count from public.book_requests where project_id = ${input.projectId}::uuid`);
      if (Number(lifetime.rows[0]?.count) >= 100) throw new HttpError(429, "RATE_LIMITED", "Voor deze verbouwing zijn al honderd boekaanvragen vastgelegd.");
      const recent = await tx.execute<{ count: string }>(sql`select count(*)::text as count from public.book_requests where owner_id = ${input.actorId}::uuid and created_at > statement_timestamp() - interval '1 day'`);
      if (Number(recent.rows[0]?.count) >= 10) throw new HttpError(429, "RATE_LIMITED", "Je hebt vandaag al tien boekaanvragen gedaan. Probeer morgen opnieuw.");
      const source = await tx.execute(sql`select draft.document from public.photobook_drafts draft
        join public.projects project on project.id = draft.project_id and project.owner_id = draft.owner_id
        where draft.project_id = ${input.projectId}::uuid and draft.owner_id = ${input.actorId}::uuid
          and draft.version = ${input.expectedVersion} and draft.document_sha256 = ${input.checksum}
          and draft.project_revision = project.content_revision and project.lifecycle_status = 'active'
        for update of draft, project`);
      if (!source.rows[0]) throw conflict();
      const document = photobookDocumentSchema.parse(source.rows[0].document);
      const result = await tx.execute(sql`insert into public.book_requests
        (id, owner_id, project_id, document, document_sha256, quantity, delivery_ciphertext, idempotency_key, request_hash)
        values (${input.id}::uuid, ${input.actorId}::uuid, ${input.projectId}::uuid, ${JSON.stringify(document)}::jsonb,
        ${input.checksum}, ${input.quantity}, ${input.deliveryCiphertext}, ${input.key}, ${input.requestHash}) returning *`);
      return { order: row(result.rows[0]!), replayed: false };
    });
  }
  async update(actorId: string, id: string, input: UpdateBookOrderInput): Promise<StoredBookOrder> {
    return this.database.transaction(async tx => {
      await setActor(tx, actorId);
      const owner = await tx.execute<{ owner_id: string }>(sql`select owner_id from public.book_requests where id = ${id}::uuid`);
      if (!owner.rows[0]) throw missing();
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`book-order:${owner.rows[0].owner_id}`}, 0))`);
      const currentResult = await tx.execute(sql`select * from public.book_requests where id = ${id}::uuid for update`);
      if (!currentResult.rows[0]) throw missing();
      const current = row(currentResult.rows[0]);
      // Retrying an already-applied transition is harmless, even after its version increment.
      if (current.status === input.status && current.reply === input.reply) return current;
      if (current.version !== input.expectedVersion) throw conflict();
      const allowed: Record<BookOrder["status"], BookOrder["status"][]> = {
        requested: ["requested", "accepted", "cancelled"], accepted: ["accepted", "printing", "cancelled"],
        printing: ["printing", "shipped", "cancelled"], shipped: ["shipped"], cancelled: ["cancelled"],
      };
      if (!allowed[current.status].includes(input.status)) throw conflict();
      const result = await tx.execute(sql`update public.book_requests set status = ${input.status}, reply = ${input.reply}, version = version + 1, updated_at = statement_timestamp() where id = ${id}::uuid returning *`);
      return row(result.rows[0]!);
    });
  }
  async assets(actorId: string, orderId: string, requestId: string): Promise<BookOrderAsset[]> {
    return this.database.transaction(async tx => {
      await setActor(tx, actorId);
      const result = await tx.execute(sql`select * from public.app_admin_book_order_assets(${orderId}::uuid, ${requestId}::uuid)`);
      return result.rows.map(value => ({ id: String(value.id), objectKey: String(value.object_key), sizeBytes: Number(value.size_bytes) }));
    });
  }
}
