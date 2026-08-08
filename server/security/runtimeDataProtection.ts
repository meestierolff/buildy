import type { RuntimeConfig } from "../config/runtime.js";
import { AuthUnavailableError } from "../auth/errors.js";
import { DataProtectionKeyring, PrivacyBlindIndex } from "./dataProtection.js";

const KEY_VERSION = /^[1-9][0-9]{0,8}$/;
const MAX_KEYRING_VERSIONS = 16;

function parseKeyring(rawValue: string): Readonly<Record<number, string>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new AuthUnavailableError("configuration_invalid");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AuthUnavailableError("configuration_invalid");
  }

  const entries = Object.entries(parsed);
  if (
    entries.length < 1 ||
    entries.length > MAX_KEYRING_VERSIONS ||
    entries.some(([version, key]) => !KEY_VERSION.test(version) || typeof key !== "string")
  ) {
    throw new AuthUnavailableError("configuration_invalid");
  }

  return Object.fromEntries(entries.map(([version, key]) => [Number(version), key as string]));
}

export interface RuntimeDataProtection {
  blindIndex: PrivacyBlindIndex;
  keyring: DataProtectionKeyring;
}

export function resolveRuntimeDataProtection(config: RuntimeConfig): RuntimeDataProtection {
  if (
    !config.PII_ENCRYPTION_KEYS ||
    !config.PII_ENCRYPTION_CURRENT_VERSION ||
    !config.PII_BLIND_INDEX_KEY
  ) {
    throw new AuthUnavailableError("configuration_missing");
  }

  try {
    return {
      blindIndex: new PrivacyBlindIndex(config.PII_BLIND_INDEX_KEY),
      keyring: new DataProtectionKeyring({
        currentVersion: config.PII_ENCRYPTION_CURRENT_VERSION,
        keys: parseKeyring(config.PII_ENCRYPTION_KEYS),
      }),
    };
  } catch (error) {
    if (error instanceof AuthUnavailableError) throw error;
    throw new AuthUnavailableError("configuration_invalid");
  }
}
