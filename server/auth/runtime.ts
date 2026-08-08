import { getRuntimeConfig } from "../config/runtime.js";
import { getBuildyDatabase } from "../db/client.js";
import { resolveAuthConfiguration } from "./config.js";
import { AuthUnavailableError } from "./errors.js";
import {
  createBuildyAuth,
  type AuthEngine,
  type AuthRegistrationGate,
  type AuthRateLimitStorage,
} from "./factory.js";
import type { AuthIdentityProvisioner } from "./identity.js";
import type { AuthEmailOutbox } from "./outbox.js";

export interface DefaultAuthDependencies {
  identityProvisioner: AuthIdentityProvisioner;
  outbox: AuthEmailOutbox;
  rateLimitStorage: AuthRateLimitStorage;
  registrationGate: AuthRegistrationGate;
}

let dependencies: DefaultAuthDependencies | undefined;
let engine: AuthEngine | undefined;

/** Install the durable outbox during server composition, before the first request. */
export function configureDefaultAuthRuntime(next: DefaultAuthDependencies): void {
  if (engine || dependencies) {
    throw new Error("De standaard auth-runtime is al geconfigureerd.");
  }
  if (!next.outbox || typeof next.outbox.enqueue !== "function") {
    throw new AuthUnavailableError("email_outbox_unconfigured");
  }
  if (
    !next.identityProvisioner ||
    typeof next.identityProvisioner.provisionForAuthUser !== "function" ||
    typeof next.identityProvisioner.ensureForSession !== "function" ||
    !next.registrationGate ||
    typeof next.registrationGate.authorizeNewUser !== "function" ||
    typeof next.registrationGate.withRequest !== "function" ||
    !next.rateLimitStorage ||
    typeof next.rateLimitStorage.consume !== "function"
  ) {
    throw new AuthUnavailableError("configuration_invalid");
  }
  dependencies = next;
}

export function resolveDefaultAuthEngine(): AuthEngine {
  if (engine) return engine;
  if (!dependencies) throw new AuthUnavailableError("email_outbox_unconfigured");

  try {
    const config = resolveAuthConfiguration(getRuntimeConfig());
    engine = createBuildyAuth({
      config,
      database: getBuildyDatabase(config.databaseUrl),
      identityProvisioner: dependencies.identityProvisioner,
      outbox: dependencies.outbox,
      rateLimitStorage: dependencies.rateLimitStorage,
      registrationGate: dependencies.registrationGate,
    });
    return engine;
  } catch (error) {
    if (error instanceof AuthUnavailableError) throw error;
    throw new AuthUnavailableError("initialization_failed");
  }
}

export function resetDefaultAuthRuntimeForTests(): void {
  dependencies = undefined;
  engine = undefined;
}
