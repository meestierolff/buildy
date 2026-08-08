import { sql } from "drizzle-orm";
import { z } from "zod";
import type { ProductEventReceipt } from "../../shared/contracts/beta.js";
import type { BuildyDatabase } from "../db/client.js";
import type { ProjectActor } from "../projects/actor.js";
import { BetaError } from "./errors.js";
import type {
  BetaRepository,
  CompleteBetaSignupCommand,
  ReserveBetaInviteCommand,
  ReservedBetaInvite,
} from "./types.js";
import type { BuildyAuthTransaction } from "../auth/identity.js";

const reservationRowSchema = z.object({
  reservation_expires_at: z.coerce.date(),
  replayed: z.boolean(),
});
const eventRowSchema = z.object({
  accepted: z.literal(true),
  replayed: z.boolean(),
});

function databaseDetails(error: unknown): { code?: string; message?: string } {
  if (!error || typeof error !== "object") return {};
  const direct = {
    code: "code" in error && typeof error.code === "string" ? error.code : undefined,
    message: "message" in error && typeof error.message === "string" ? error.message : undefined,
  };
  if (direct.code) return direct;
  return "cause" in error ? databaseDetails(error.cause) : direct;
}

function translateDatabaseError(error: unknown): never {
  if (error instanceof BetaError) throw error;
  const detail = databaseDetails(error);
  if (detail.code === "23505" || detail.message?.includes("idempotency")) {
    throw new BetaError("IDEMPOTENCY_CONFLICT", undefined, { cause: error });
  }
  if (["22023", "23503", "23514", "55000"].includes(detail.code ?? "")) {
    throw new BetaError("INVALID_STATE", undefined, { cause: error });
  }
  throw error;
}

function actorId(actor: ProjectActor): string | null {
  return actor.kind === "authenticated" ? actor.appUserId : null;
}

export class PostgresBetaRepository implements BetaRepository {
  constructor(private readonly database: BuildyDatabase) {}

  async reserveInvite(command: ReserveBetaInviteCommand): Promise<ReservedBetaInvite> {
    try {
      const result = await this.database.execute(sql`
        select reservation_expires_at, replayed
        from public.app_reserve_beta_invite(
          ${command.codeHash},
          ${command.emailHash},
          ${command.reservationTokenHash},
          ${command.provider},
          ${command.idempotencyKey},
          ${command.requestHash}
        )
      `);
      const parsed = reservationRowSchema.safeParse(result.rows[0]);
      if (!parsed.success) throw new BetaError("INVITE_INVALID");
      return {
        expiresAt: parsed.data.reservation_expires_at,
        replayed: parsed.data.replayed,
      };
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async completeSignup(
    transaction: BuildyAuthTransaction,
    command: CompleteBetaSignupCommand,
  ): Promise<void> {
    try {
      const result = await transaction.execute(sql`
        select app_user_id, replayed
        from public.app_complete_beta_signup(
          ${command.reservationTokenHash},
          ${command.emailHash},
          ${command.authUserId},
          ${command.provider}
        )
      `);
      if (!result.rows[0]) throw new BetaError("INVITE_REQUIRED");
    } catch (error) {
      if (error instanceof BetaError) throw error;
      const detail = databaseDetails(error);
      if (["22023", "23503", "23514", "55000"].includes(detail.code ?? "")) {
        throw new BetaError("INVITE_REQUIRED", undefined, { cause: error });
      }
      throw error;
    }
  }

  async recordClientEvent(
    actor: ProjectActor,
    anonymousSubjectHash: string,
    event: Parameters<BetaRepository["recordClientEvent"]>[2],
  ): Promise<ProductEventReceipt> {
    try {
      return await this.database.transaction(async (transaction) => {
        await transaction.execute(sql`
          select set_config('app.actor_id', ${actorId(actor) ?? ""}, true)
        `);
        const result = await transaction.execute(sql`
          select accepted, replayed
          from public.app_record_client_product_event(
            ${event.eventId}::uuid,
            ${event.eventName},
            ${anonymousSubjectHash},
            ${JSON.stringify(event.properties)}::jsonb
          )
        `);
        return eventRowSchema.parse(result.rows[0]);
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }
}
