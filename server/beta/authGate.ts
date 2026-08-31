import { AsyncLocalStorage } from "node:async_hooks";
import type { BetaProvider } from "../../shared/contracts/beta.js";
import { AuthRegistrationRejectedError } from "../auth/errors.js";
import type { AuthRegistrationGate } from "../auth/factory.js";
import type { AuthIdentityUser, BuildyAuthTransaction } from "../auth/identity.js";
import { BETA_OPAQUE_TOKEN } from "./crypto.js";
import { BetaError } from "./errors.js";
import type { BetaService } from "./service.js";

export const BETA_RESERVATION_COOKIE = "buildy_beta_reservation";

type ReservationContext = { provider: BetaProvider; token: string } | null;

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header || header.length > 16_384) return null;
  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 1 || segment.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(segment.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function parseBetaReservationCookie(request: Request): ReservationContext {
  const value = cookieValue(request, BETA_RESERVATION_COOKIE);
  if (!value) return null;
  const match = /^v1\.(email|google)\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match || !BETA_OPAQUE_TOKEN.test(match[2])) return null;
  return { provider: match[1] as BetaProvider, token: match[2] };
}

export function betaReservationCookie(
  provider: BetaProvider,
  token: string,
  secure: boolean,
): string {
  if (!BETA_OPAQUE_TOKEN.test(token)) throw new TypeError("Ongeldig bètareserveringstoken.");
  return [
    `${BETA_RESERVATION_COOKIE}=v1.${provider}.${token}`,
    "Path=/api/auth",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=600",
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

export function clearBetaReservationCookie(secure: boolean): string {
  return [
    `${BETA_RESERVATION_COOKIE}=`,
    "Path=/api/auth",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

export class BetaRegistrationGate implements AuthRegistrationGate {
  private readonly context = new AsyncLocalStorage<ReservationContext>();

  constructor(private readonly service: BetaService) {}

  withRequest<Result>(request: Request, next: () => Promise<Result>): Promise<Result> {
    return this.context.run(parseBetaReservationCookie(request), next);
  }

  async authorizeNewUser(
    transaction: BuildyAuthTransaction,
    user: AuthIdentityUser,
  ): Promise<void> {
    try {
      await this.service.completeRegistration(
        transaction,
        this.context.getStore() ?? null,
        user,
      );
    } catch (error) {
      if (error instanceof BetaError) {
        throw new AuthRegistrationRejectedError({ cause: error });
      }
      throw error;
    }
  }
}
