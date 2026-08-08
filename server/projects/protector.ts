import type { DataProtectionKeyring } from "../security/dataProtection.js";
import type { ProjectPrivateDetailsProtector } from "./types.js";

export class KeyringProjectPrivateDetailsProtector implements ProjectPrivateDetailsProtector {
  constructor(
    private readonly keyring: DataProtectionKeyring,
    readonly currentKeyVersion: number,
  ) {
    if (!Number.isSafeInteger(currentKeyVersion) || currentKeyVersion < 1) {
      throw new Error("Projectencryptiesleutelversie is ongeldig.");
    }
  }

  protect(plaintext: string, context: string): string {
    return this.keyring.encrypt(plaintext, context);
  }
}
