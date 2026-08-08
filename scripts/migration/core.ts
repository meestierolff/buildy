import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const ARTIFACT_KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;

export const migrationEnvironmentSchema = z.enum(["local", "test", "preview", "staging", "production"]);
export type MigrationEnvironment = z.infer<typeof migrationEnvironmentSchema>;

export class MigrationSafetyError extends Error {
  constructor(
    public readonly code:
      | "INVALID_ARGUMENT"
      | "UNTRUSTED_ENDPOINT"
      | "READ_NOT_AUTHORIZED"
      | "WRITE_NOT_AUTHORIZED"
      | "PRODUCTION_GATE_MISSING"
      | "ARTIFACT_INVALID"
      | "ARTIFACT_TOO_LARGE"
      | "CHECKSUM_MISMATCH",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MigrationSafetyError";
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new MigrationSafetyError("INVALID_ARGUMENT", "Niet-eindige getallen zijn niet toegestaan in migratie-artifacts.");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object" && value) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(",")}}`;
  }
  throw new MigrationSafetyError("INVALID_ARGUMENT", "Niet-serialiseerbare migratiewaarde aangetroffen.");
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value);
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Base64(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("base64");
}

export function keyedFingerprint(key: Uint8Array, namespace: string, value: string): string {
  if (!/^[a-z][a-z0-9_.:-]{0,79}$/.test(namespace)) {
    throw new MigrationSafetyError("INVALID_ARGUMENT", "Fingerprintnamespace is ongeldig.");
  }
  return createHmac("sha256", key)
    .update(namespace)
    .update("\0")
    .update(value.normalize("NFKC").trim())
    .digest("hex");
}

function parseUuidBytes(value: string): Buffer {
  if (!UUID.test(value)) throw new MigrationSafetyError("INVALID_ARGUMENT", "UUID is ongeldig.");
  return Buffer.from(value.replaceAll("-", ""), "hex");
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** RFC 4122 UUIDv5, used to keep renamed legacy records stable across reruns. */
export function stableUuid(namespace: string, name: string): string {
  const namespaceBytes = parseUuidBytes(namespace.toLowerCase());
  const digest = createHash("sha1")
    .update(namespaceBytes)
    .update(Buffer.from(name.normalize("NFC"), "utf8"))
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
}

export function preserveOrMapUuid(value: string, namespace: string): string {
  return UUID.test(value) ? value.toLowerCase() : stableUuid(namespace, value);
}

export interface EndpointPolicy {
  allowLocal?: boolean;
  allowedHostSuffixes?: readonly string[];
  expectedHost: string;
  label: string;
}

function hostMatchesSuffix(hostname: string, suffix: string): boolean {
  const normalized = suffix.toLowerCase().replace(/^\./, "");
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

export function assertTrustedEndpoint(rawUrl: string, policy: EndpointPolicy): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    throw new MigrationSafetyError("UNTRUSTED_ENDPOINT", `${policy.label} is geen geldige URL.`, { cause: error });
  }

  const hostname = url.hostname.toLowerCase();
  const expectedHost = policy.expectedHost.trim().toLowerCase();
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  const allowedProtocol = url.protocol === "postgres:" || url.protocol === "postgresql:" || url.protocol === "https:";
  if (!allowedProtocol || !hostname || (isLocal && !policy.allowLocal)) {
    throw new MigrationSafetyError("UNTRUSTED_ENDPOINT", `${policy.label} gebruikt geen toegestane endpointconfiguratie.`);
  }
  if (!expectedHost || hostname !== expectedHost) {
    throw new MigrationSafetyError("UNTRUSTED_ENDPOINT", `${policy.label} komt niet overeen met de verwachte host.`);
  }
  if (
    !isLocal &&
    policy.allowedHostSuffixes &&
    !policy.allowedHostSuffixes.some((suffix) => hostMatchesSuffix(hostname, suffix))
  ) {
    throw new MigrationSafetyError("UNTRUSTED_ENDPOINT", `${policy.label} valt buiten de toegestane providerhosts.`);
  }
  return url;
}

export interface NetworkReadGateInput {
  allowNetworkRead: boolean;
  confirmation?: string;
  runId: string;
  source: { expectedHost: string; url: string };
}

function assertReadAuthorizedForPolicy(
  input: NetworkReadGateInput,
  policy: { allowedHostSuffixes: readonly string[]; confirmationPrefix: string; label: string },
): URL {
  if (!UUID.test(input.runId)) {
    throw new MigrationSafetyError("INVALID_ARGUMENT", "Migratierun-ID is ongeldig.");
  }
  const endpoint = assertTrustedEndpoint(input.source.url, {
    allowLocal: true,
    allowedHostSuffixes: policy.allowedHostSuffixes,
    expectedHost: input.source.expectedHost,
    label: policy.label,
  });
  const expected = `${policy.confirmationPrefix}:${input.runId}:${endpoint.hostname}`;
  if (!input.allowNetworkRead || input.confirmation !== expected) {
    throw new MigrationSafetyError(
      "READ_NOT_AUTHORIZED",
      `Bronread is standaard uitgeschakeld; gebruik de run-gebonden bevestiging ${expected}.`,
    );
  }
  return endpoint;
}

export function assertNetworkReadAuthorized(input: NetworkReadGateInput): URL {
  return assertReadAuthorizedForPolicy(input, {
    allowedHostSuffixes: [input.source.expectedHost, "localhost"],
    confirmationPrefix: "READ",
    label: "Legacy bron",
  });
}

export function assertTargetReadAuthorized(input: NetworkReadGateInput): URL {
  return assertReadAuthorizedForPolicy(input, {
    allowedHostSuffixes: ["neon.tech", "localhost"],
    confirmationPrefix: "READ-TARGET",
    label: "Neon doel",
  });
}

export interface TargetWriteGateInput {
  acceptanceArtifactSha256?: string;
  backupArtifactSha256?: string;
  environment: MigrationEnvironment;
  execute: boolean;
  expectedHost: string;
  productionConfirmation?: string;
  runId: string;
  targetUrl: string;
  writeConfirmation?: string;
}

function assertWriteAuthorizedForPolicy(
  input: TargetWriteGateInput,
  policy: { allowedHostSuffixes: readonly string[]; label: string },
): URL {
  if (!UUID.test(input.runId)) {
    throw new MigrationSafetyError("INVALID_ARGUMENT", "Migratierun-ID is ongeldig.");
  }
  const endpoint = assertTrustedEndpoint(input.targetUrl, {
    allowLocal: input.environment === "local" || input.environment === "test",
    allowedHostSuffixes: policy.allowedHostSuffixes,
    expectedHost: input.expectedHost,
    label: policy.label,
  });
  const expectedWrite = `APPLY:${input.runId}:${input.environment}:${endpoint.hostname}`;
  if (!input.execute || input.writeConfirmation !== expectedWrite) {
    throw new MigrationSafetyError(
      "WRITE_NOT_AUTHORIZED",
      `Doelwrite is standaard dry-run; vereiste bevestiging is ${expectedWrite}.`,
    );
  }

  if (input.environment === "production") {
    const expectedProduction = `PRODUCTION-CUTOVER:${input.runId}:${endpoint.hostname}`;
    if (
      input.productionConfirmation !== expectedProduction ||
      !input.backupArtifactSha256 ||
      !SHA256_HEX.test(input.backupArtifactSha256) ||
      !input.acceptanceArtifactSha256 ||
      !SHA256_HEX.test(input.acceptanceArtifactSha256)
    ) {
      throw new MigrationSafetyError(
        "PRODUCTION_GATE_MISSING",
        `Productiewrite vereist backup, acceptatie en bevestiging ${expectedProduction}.`,
      );
    }
  }
  return endpoint;
}

export function assertTargetWriteAuthorized(input: TargetWriteGateInput): URL {
  return assertWriteAuthorizedForPolicy(input, {
    allowedHostSuffixes: ["neon.tech", "localhost"],
    label: "Neon doel",
  });
}

export function assertStorageWriteAuthorized(input: TargetWriteGateInput): URL {
  return assertWriteAuthorizedForPolicy(input, {
    allowedHostSuffixes: ["r2.cloudflarestorage.com", "localhost"],
    label: "R2 doel",
  });
}

function decodeArtifactKey(encoded: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new MigrationSafetyError("ARTIFACT_INVALID", "Artifactkey is geen geldige base64waarde.");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== ARTIFACT_KEY_BYTES) {
    throw new MigrationSafetyError("ARTIFACT_INVALID", "Artifactkey moet exact 256 bits zijn.");
  }
  return key;
}

const sealedArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  algorithm: z.literal("A256GCM"),
  kind: z.string().regex(/^[a-z][a-z0-9._-]{0,79}$/),
  runId: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
  plaintextSha256: z.string().regex(SHA256_HEX),
  nonce: z.string().min(1),
  ciphertext: z.string(),
  tag: z.string().min(1),
});

export type SealedArtifact = z.infer<typeof sealedArtifactSchema>;

function artifactAad(kind: string, runId: string): Buffer {
  return Buffer.from(`buildy-migration-artifact:v1:${kind}:${runId}`, "utf8");
}

export function sealArtifact(input: {
  artifactKeyBase64: string;
  createdAt?: Date;
  kind: string;
  payload: unknown;
  runId: string;
}): SealedArtifact {
  const key = decodeArtifactKey(input.artifactKeyBase64);
  const kind = z.string().regex(/^[a-z][a-z0-9._-]{0,79}$/).parse(input.kind);
  const runId = z.string().uuid().parse(input.runId);
  const plaintext = Buffer.from(canonicalJson(input.payload), "utf8");
  if (plaintext.byteLength > MAX_ARTIFACT_BYTES) {
    throw new MigrationSafetyError("ARTIFACT_TOO_LARGE", "Migratie-artifact overschrijdt de veilige limiet.");
  }
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(artifactAad(kind, runId));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    schemaVersion: 1,
    algorithm: "A256GCM",
    kind,
    runId,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    plaintextSha256: sha256Hex(plaintext),
    nonce: nonce.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
}

export function unsealArtifact<T>(sealedInput: unknown, artifactKeyBase64: string): T {
  const sealed = sealedArtifactSchema.parse(sealedInput);
  const ciphertext = Buffer.from(sealed.ciphertext, "base64url");
  if (ciphertext.byteLength > MAX_ARTIFACT_BYTES) {
    throw new MigrationSafetyError("ARTIFACT_TOO_LARGE", "Migratie-artifact overschrijdt de veilige limiet.");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      decodeArtifactKey(artifactKeyBase64),
      Buffer.from(sealed.nonce, "base64url"),
      { authTagLength: TAG_BYTES },
    );
    decipher.setAAD(artifactAad(sealed.kind, sealed.runId));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64url"));
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (sha256Hex(plaintext) !== sealed.plaintextSha256) {
      throw new MigrationSafetyError("CHECKSUM_MISMATCH", "Artifactchecksum komt niet overeen.");
    }
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch (error) {
    if (error instanceof MigrationSafetyError) throw error;
    throw new MigrationSafetyError("ARTIFACT_INVALID", "Migratie-artifact kon niet worden ontsleuteld.", { cause: error });
  }
}

export function artifactEnvelopeSha256(sealed: SealedArtifact): string {
  return sha256Hex(canonicalJson(sealed));
}

export async function writeSealedArtifact(path: string, sealed: SealedArtifact): Promise<string> {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${absolutePath}.${process.pid}.${randomUUID()}.tmp`;
  const bytes = Buffer.from(`${canonicalJson(sealed)}\n`, "utf8");
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, absolutePath).catch(async (error) => {
    await rm(temporaryPath, { force: true });
    throw error;
  });
  await chmod(absolutePath, 0o600);
  return artifactEnvelopeSha256(sealed);
}

export async function readSealedArtifact<T>(path: string, artifactKeyBase64: string): Promise<{
  envelopeSha256: string;
  payload: T;
  sealed: SealedArtifact;
}> {
  const bytes = await readFile(resolve(path));
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
    throw new MigrationSafetyError("ARTIFACT_TOO_LARGE", "Migratie-artifact overschrijdt de veilige limiet.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new MigrationSafetyError("ARTIFACT_INVALID", "Migratie-artifact bevat geen geldige JSON.", { cause: error });
  }
  const sealed = sealedArtifactSchema.parse(parsed);
  return {
    envelopeSha256: artifactEnvelopeSha256(sealed),
    payload: unsealArtifact<T>(sealed, artifactKeyBase64),
    sealed,
  };
}

export function createMigrationRunId(): string {
  return randomUUID();
}

export function redactForLog(value: unknown): unknown {
  const sensitiveKey = /(email|address|token|secret|password|ciphertext|signed.?url|object.?key|source.?key|name)/i;
  if (Array.isArray(value)) return value.map(redactForLog);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      sensitiveKey.test(key) ? "[REDACTED]" : redactForLog(nested),
    ]));
  }
  if (typeof value === "string" && (value.includes("@") || /(?:https?|postgres(?:ql)?):\/\//i.test(value))) {
    return "[REDACTED]";
  }
  return value;
}
