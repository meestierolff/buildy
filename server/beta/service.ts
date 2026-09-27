import type {
  BetaProvider,
  BetaReservation,
  ClientProductEventInput,
  ProductEventReceipt,
} from "../../shared/contracts/beta.js";
import {
  clientProductEventInputSchema,
  reserveBetaInviteInputSchema,
} from "../../shared/contracts/beta.js";
import type { AuthIdentityUser, BuildyAuthTransaction } from "../auth/identity.js";
import type { ProjectActor } from "../projects/actor.js";
import { canonicalJson } from "../security/canonicalJson.js";
import type { PrivacyBlindIndex } from "../security/dataProtection.js";
import {
  betaInviteCodeHash,
  betaInviteEmailHash,
  betaReservationTokenHash,
  deriveBetaReservationToken,
} from "./crypto.js";
import { BetaError } from "./errors.js";
import type {
  BetaRepository,
  BetaReservationRateLimitStorage,
  BetaReservationRequestContext,
} from "./types.js";

export interface InternalBetaReservation {
  cookieToken: string;
  provider: BetaProvider;
  publicResult: BetaReservation;
}

export class BetaService {
  private readonly tokenFactory: (idempotencyKey: string) => string;

  constructor(
    private readonly betaMode: boolean,
    private readonly repository: BetaRepository,
    private readonly rateLimits: BetaReservationRateLimitStorage,
    private readonly blindIndex: PrivacyBlindIndex,
    tokenFactory?: (idempotencyKey: string) => string,
  ) {
    this.tokenFactory = tokenFactory
      ?? ((idempotencyKey) => deriveBetaReservationToken(idempotencyKey, blindIndex));
  }

  status() {
    return {
      betaMode: this.betaMode,
      inviteRequiredForNewAccounts: this.betaMode,
      label: "Private bèta" as const,
    };
  }

  async reserveInvite(
    rawInput: unknown,
    context: BetaReservationRequestContext,
  ): Promise<InternalBetaReservation> {
    if (!this.betaMode) throw new BetaError("DISABLED");
    const input = reserveBetaInviteInputSchema.parse(rawInput);
    const codeHash = betaInviteCodeHash(input.inviteCode, this.blindIndex);
    const emailHash = input.email
      ? betaInviteEmailHash(input.email, this.blindIndex)
      : null;
    const sourceHash = this.blindIndex.create(
      "beta-reservation-source",
      `${context.networkIdentifier.slice(0, 128)}\0${context.userAgent.slice(0, 512)}`,
    );

    for (const rule of [
      { key: `beta-reservation:source:${sourceHash}`, max: 12, window: 60 * 60 },
      { key: `beta-reservation:invite:${codeHash}`, max: 8, window: 60 * 60 },
    ]) {
      const decision = await this.rateLimits.consume(rule.key, rule);
      if (!decision.allowed) {
        throw new BetaError("RATE_LIMITED", decision.retryAfter ?? undefined);
      }
    }

    const cookieToken = this.tokenFactory(input.idempotencyKey);
    const requestHash = this.blindIndex.create(
      "beta-reservation-request",
      canonicalJson({ codeHash, emailHash, provider: input.provider }),
    );
    const reserved = await this.repository.reserveInvite({
      codeHash,
      emailHash,
      idempotencyKey: input.idempotencyKey,
      provider: input.provider,
      requestHash,
      reservationTokenHash: betaReservationTokenHash(cookieToken, this.blindIndex),
    });

    return {
      cookieToken,
      provider: input.provider,
      publicResult: {
        reserved: true,
        expiresAt: reserved.expiresAt.toISOString(),
        replayed: reserved.replayed,
      },
    };
  }

  async completeRegistration(
    transaction: BuildyAuthTransaction,
    reservation: { provider: BetaProvider; token: string } | null,
    user: AuthIdentityUser,
  ): Promise<void> {
    if (!this.betaMode) return;
    if (!reservation || !user.email) throw new BetaError("INVITE_REQUIRED");
    await this.repository.completeSignup(transaction, {
      authUserId: user.id,
      emailHash: betaInviteEmailHash(user.email, this.blindIndex),
      provider: reservation.provider,
      reservationTokenHash: betaReservationTokenHash(reservation.token, this.blindIndex),
    });
  }

  async recordClientEvent(
    actor: ProjectActor,
    anonymousIdentifier: string,
    rawInput: unknown,
  ): Promise<ProductEventReceipt> {
    const event: ClientProductEventInput = clientProductEventInputSchema.parse(rawInput);
    const anonymousSubjectHash = this.blindIndex.create(
      "product-event-anonymous",
      anonymousIdentifier,
    );
    const limiterSubject = actor.kind === "authenticated"
      ? `user:${actor.appUserId}`
      : `anonymous:${anonymousSubjectHash}`;
    const decision = await this.rateLimits.consume(
      `product-events:${limiterSubject}`,
      { max: 120, window: 60 * 60 },
    );
    if (!decision.allowed) {
      throw new BetaError("RATE_LIMITED", decision.retryAfter ?? undefined);
    }
    return this.repository.recordClientEvent(actor, anonymousSubjectHash, event);
  }
}
