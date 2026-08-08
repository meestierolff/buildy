import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_PLAINTEXT_BYTES = 128 * 1024;
const KEY_VERSION = /^[1-9][0-9]{0,8}$/;

export class DataProtectionError extends Error {
  constructor(
    public readonly code: "INVALID_KEY" | "INVALID_ENVELOPE" | "UNKNOWN_KEY" | "DECRYPTION_FAILED" | "PAYLOAD_TOO_LARGE",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DataProtectionError";
  }
}

function decodeKey(value: string): Buffer {
  let key: Buffer;
  try {
    key = Buffer.from(value, "base64");
  } catch (error) {
    throw new DataProtectionError("INVALID_KEY", "Databeveiligingssleutel is geen geldige base64.", { cause: error });
  }
  if (key.length !== KEY_BYTES) {
    throw new DataProtectionError("INVALID_KEY", "Databeveiligingssleutel moet exact 256 bits zijn.");
  }
  return key;
}

function assertAdditionalData(value: string): Buffer {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.length < 1 || encoded.length > 512) {
    throw new DataProtectionError("INVALID_ENVELOPE", "Encryptiecontext ontbreekt of is te lang.");
  }
  return encoded;
}

function decodeEnvelopeSegment(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new DataProtectionError("INVALID_ENVELOPE", "Ciphertext-envelope is ongeldig.");
  }
  return Buffer.from(value, "base64url");
}

export interface DataProtectionKeyringConfig {
  currentVersion: number;
  keys: Readonly<Record<number, string>>;
}

/**
 * AES-256-GCM envelope encryption for small PII fields. Callers must bind the
 * ciphertext to a stable resource/field context (for example order:{id}:email)
 * so values cannot be copied between rows or columns.
 */
export class DataProtectionKeyring {
  private readonly currentVersion: number;
  private readonly keys = new Map<number, Buffer>();

  constructor(config: DataProtectionKeyringConfig) {
    if (!Number.isSafeInteger(config.currentVersion) || config.currentVersion < 1) {
      throw new DataProtectionError("INVALID_KEY", "Huidige sleutelversie is ongeldig.");
    }
    for (const [versionValue, encoded] of Object.entries(config.keys)) {
      if (!KEY_VERSION.test(versionValue)) {
        throw new DataProtectionError("INVALID_KEY", "Sleutelversie is ongeldig.");
      }
      this.keys.set(Number(versionValue), decodeKey(encoded));
    }
    if (!this.keys.has(config.currentVersion)) {
      throw new DataProtectionError("INVALID_KEY", "Huidige sleutel ontbreekt in de keyring.");
    }
    this.currentVersion = config.currentVersion;
  }

  encrypt(plaintext: string, additionalData: string): string {
    const plaintextBytes = Buffer.from(plaintext, "utf8");
    if (plaintextBytes.length > MAX_PLAINTEXT_BYTES) {
      throw new DataProtectionError("PAYLOAD_TOO_LARGE", "Te versleutelen waarde is te groot.");
    }
    const nonce = randomBytes(NONCE_BYTES);
    const key = this.keys.get(this.currentVersion);
    if (!key) throw new DataProtectionError("UNKNOWN_KEY", "Huidige sleutel is niet geladen.");

    const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(assertAdditionalData(additionalData));
    const ciphertext = Buffer.concat([cipher.update(plaintextBytes), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [
      "v1",
      String(this.currentVersion),
      nonce.toString("base64url"),
      ciphertext.toString("base64url"),
      tag.toString("base64url"),
    ].join(".");
  }

  decrypt(envelope: string, additionalData: string): string {
    const parts = envelope.split(".");
    if (parts.length !== 5 || parts[0] !== "v1" || !KEY_VERSION.test(parts[1])) {
      throw new DataProtectionError("INVALID_ENVELOPE", "Ciphertext-envelope heeft een onbekend formaat.");
    }
    const version = Number(parts[1]);
    const key = this.keys.get(version);
    if (!key) throw new DataProtectionError("UNKNOWN_KEY", "Ciphertext gebruikt een niet-geladen sleutelversie.");
    const nonce = decodeEnvelopeSegment(parts[2]);
    const ciphertext = decodeEnvelopeSegment(parts[3]);
    const tag = decodeEnvelopeSegment(parts[4]);
    if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES || ciphertext.length > MAX_PLAINTEXT_BYTES) {
      throw new DataProtectionError("INVALID_ENVELOPE", "Ciphertext-envelope heeft ongeldige lengtes.");
    }

    try {
      const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
      decipher.setAAD(assertAdditionalData(additionalData));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch (error) {
      throw new DataProtectionError("DECRYPTION_FAILED", "Ciphertext kon niet veilig worden ontsleuteld.", {
        cause: error,
      });
    }
  }
}

/** Keyed, normalized blind indexes prevent reversible PII in logs/indexes. */
export class PrivacyBlindIndex {
  private readonly key: Buffer;

  constructor(encodedKey: string) {
    this.key = decodeKey(encodedKey);
  }

  create(namespace: string, value: string): string {
    const normalizedNamespace = namespace.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_.:-]{0,79}$/.test(normalizedNamespace)) {
      throw new DataProtectionError("INVALID_KEY", "Blind-indexnamespace is ongeldig.");
    }
    const normalizedValue = value.normalize("NFKC").trim().toLowerCase();
    return createHmac("sha256", this.key)
      .update(normalizedNamespace)
      .update("\0")
      .update(normalizedValue)
      .digest("hex");
  }

  matches(namespace: string, value: string, expectedHex: string): boolean {
    if (!/^[0-9a-f]{64}$/.test(expectedHex)) return false;
    const actual = Buffer.from(this.create(namespace, value), "hex");
    return timingSafeEqual(actual, Buffer.from(expectedHex, "hex"));
  }
}
