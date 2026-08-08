import type {
  BetaProvider,
  ClientProductEventInput,
  ProductEventReceipt,
} from "../../shared/contracts/beta.js";
import type { BuildyAuthTransaction } from "../auth/identity.js";
import type { ProjectActor } from "../projects/actor.js";

export type BetaReservationRateLimitStorage = {
  consume(
    key: string,
    rule: { max: number; window: number },
  ): Promise<{ allowed: boolean; retryAfter: number | null }>;
};

export interface BetaReservationRequestContext {
  networkIdentifier: string;
  userAgent: string;
}

export interface ReservedBetaInvite {
  expiresAt: Date;
  replayed: boolean;
}

export interface ReserveBetaInviteCommand {
  codeHash: string;
  emailHash: string | null;
  idempotencyKey: string;
  provider: BetaProvider;
  requestHash: string;
  reservationTokenHash: string;
}

export interface CompleteBetaSignupCommand {
  authUserId: string;
  emailHash: string;
  provider: BetaProvider;
  reservationTokenHash: string;
}

export interface BetaRepository {
  completeSignup(
    transaction: BuildyAuthTransaction,
    command: CompleteBetaSignupCommand,
  ): Promise<void>;
  recordClientEvent(
    actor: ProjectActor,
    anonymousSubjectHash: string,
    event: ClientProductEventInput,
  ): Promise<ProductEventReceipt>;
  reserveInvite(command: ReserveBetaInviteCommand): Promise<ReservedBetaInvite>;
}
