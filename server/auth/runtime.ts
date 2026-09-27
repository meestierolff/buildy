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
import type { DataProtectionKeyring, PrivacyBlindIndex } from "../security/dataProtection.js";

export interface DefaultAuthDependencies {
  blindIndex: PrivacyBlindIndex;
  identityProvisioner: AuthIdentityProvisioner;
  keyring: DataProtectionKeyring;
  rateLimitStorage: AuthRateLimitStorage;
  registrationGate: AuthRegistrationGate;
}

let dependencies: DefaultAuthDependencies | undefined;
let engine: AuthEngine | undefined;

/** Install server-owned account persistence dependencies before the first request. */
export function configureDefaultAuthRuntime(next: DefaultAuthDependencies): void {
  if (engine || dependencies) {
    throw new Error("De standaard auth-runtime is al geconfigureerd.");
  }
  if (
    !next.blindIndex ||
    typeof next.blindIndex.create !== "function" ||
    !next.keyring ||
    typeof next.keyring.encrypt !== "function" ||
    typeof next.keyring.decrypt !== "function" ||
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
  if (!dependencies) throw new AuthUnavailableError("configuration_missing");

  try {
    const config = resolveAuthConfiguration(getRuntimeConfig());
    engine = createBuildyAuth({
      config,
      database: getBuildyDatabase(config.databaseUrl),
      blindIndex: dependencies.blindIndex,
      identityProvisioner: dependencies.identityProvisioner,
      keyring: dependencies.keyring,
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
