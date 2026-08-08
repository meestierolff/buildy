import { randomBytes } from "node:crypto";
import type { PrivacyBlindIndex } from "../security/dataProtection.js";

export const BETA_INVITE_CODE = /^BLDY_[A-Za-z0-9_-]{32}$/;
export const BETA_OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function generateBetaInviteCode(): string {
  return `BLDY_${randomBytes(24).toString("base64url")}`;
}

export function generateBetaReservationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function deriveBetaReservationToken(
  idempotencyKey: string,
  blindIndex: PrivacyBlindIndex,
): string {
  if (!/^beta-reservation:v1:[0-9a-f-]{36}$/.test(idempotencyKey)) {
    throw new TypeError("Ongeldige bèta-idempotentiesleutel.");
  }
  return Buffer.from(
    blindIndex.create("beta-reservation-cookie", idempotencyKey),
    "hex",
  ).toString("base64url");
}

export function betaInviteCodeHash(code: string, blindIndex: PrivacyBlindIndex): string {
  if (!BETA_INVITE_CODE.test(code)) throw new TypeError("Ongeldig bèta-uitnodigingsformaat.");
  return blindIndex.create("beta-invite-code", code);
}

export function betaInviteEmailHash(email: string, blindIndex: PrivacyBlindIndex): string {
  const normalized = email.normalize("NFKC").trim().toLowerCase();
  if (!normalized || normalized.length > 254 || !normalized.includes("@")) {
    throw new TypeError("Ongeldig bèta-e-mailadres.");
  }
  return blindIndex.create("beta-invite-email", normalized);
}

export function betaReservationTokenHash(
  token: string,
  blindIndex: PrivacyBlindIndex,
): string {
  if (!BETA_OPAQUE_TOKEN.test(token)) throw new TypeError("Ongeldig bèta-reserveringstoken.");
  return blindIndex.create("beta-reservation-token", token);
}
