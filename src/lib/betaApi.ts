import type {
  BetaProvider,
  ClientProductEventInput,
  ReserveBetaInviteInput,
} from "../../shared/contracts/beta";
import {
  betaReservationResponseSchema,
  betaStatusResponseSchema,
  productEventReceiptResponseSchema,
} from "../../shared/contracts/beta";
import { apiRequest } from "./apiClient";

type ClientProductEventWithoutId<T = ClientProductEventInput> = T extends unknown
  ? Omit<T, "eventId">
  : never;

export async function getBetaStatus() {
  return (await apiRequest("/api/beta/status", betaStatusResponseSchema)).data;
}

export async function reserveBetaInvite(input: ReserveBetaInviteInput) {
  return (await apiRequest(
    "/api/beta/reservations",
    betaReservationResponseSchema,
    { method: "POST", body: input },
  )).data;
}

export function createBetaReservationKey(): string {
  return `beta-reservation:v1:${crypto.randomUUID()}`;
}

export async function recordProductEvent(
  event: ClientProductEventWithoutId,
): Promise<void> {
  await apiRequest(
    "/api/product-events",
    productEventReceiptResponseSchema,
    {
      method: "POST",
      body: { ...event, eventId: crypto.randomUUID() } as ClientProductEventInput,
    },
  );
}

export function recordSignupStarted(method: BetaProvider): void {
  void recordProductEvent({
    eventName: "signup_started",
    properties: { schemaVersion: 1, method },
  }).catch(() => undefined);
}
