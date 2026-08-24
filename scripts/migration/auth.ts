import { z } from "zod";
import { keyedFingerprint, preserveOrMapUuid, stableUuid } from "./core";

export const BUILDY_MIGRATION_NAMESPACE = "c174cbec-5ee0-5b84-886d-a5fb2bcc1e69";

const legacyAuthUserSchema = z.object({
  id: z.string().min(1).max(512),
  email: z.string().email().max(320),
  emailVerified: z.boolean(),
  hasPassword: z.boolean(),
  providers: z.array(z.string().min(1).max(80)).max(20),
  disabled: z.boolean().default(false),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export type LegacyAuthUser = z.infer<typeof legacyAuthUserSchema>;

export type AuthMigrationStrategy =
  | "google_oidc_reauthentication_required"
  | "manual_review";

export interface AuthMigrationRecord {
  appUserId: string;
  createdAt: string;
  emailFingerprint: string;
  emailVerifiedAtSource: boolean;
  identityMappingId: string;
  legacyProvider: "legacy_auth";
  legacySubjectId: string;
  sourceProviders: string[];
  status: "pending" | "manual_review";
  strategies: AuthMigrationStrategy[];
  targetAuthUserId: null;
}

export interface AuthMigrationPlan {
  schemaVersion: 1;
  records: AuthMigrationRecord[];
  summary: {
    googleOidcReauthentication: number;
    manualReview: number;
    total: number;
    unsupportedProvider: number;
  };
  passwordHashesExported: false;
  sessionImportAllowed: false;
}

function normalizeProviders(providers: readonly string[]): string[] {
  return [...new Set(providers.map((value) => value.trim().toLowerCase()).filter(Boolean))].sort();
}

function migrationStrategies(user: LegacyAuthUser, providers: readonly string[]): AuthMigrationStrategy[] {
  if (user.disabled || !providers.includes("google")) return ["manual_review"];
  return ["google_oidc_reauthentication_required"];
}

/**
 * Produces a Google-only auth migration plan. Password hashes, raw e-mail
 * addresses and source sessions are deliberately absent. Ownership stays on
 * the stable application UUID; identity linking requires a fresh, verified
 * Google provider-subject and never relies on an e-mail match.
 */
export function buildAuthMigrationPlan(
  input: readonly LegacyAuthUser[],
  fingerprintKey: Uint8Array,
): AuthMigrationPlan {
  const seenLegacyIds = new Set<string>();
  const seenEmails = new Map<string, string>();
  const records = input.map((rawUser) => {
    const user = legacyAuthUserSchema.parse(rawUser);
    if (seenLegacyIds.has(user.id)) throw new Error("Dubbele legacy authidentiteit in export.");
    seenLegacyIds.add(user.id);

    const normalizedEmail = user.email.normalize("NFKC").trim().toLowerCase();
    const previousSubject = seenEmails.get(normalizedEmail);
    const providers = normalizeProviders(user.providers);
    const strategies = migrationStrategies(user, providers);
    if (previousSubject && previousSubject !== user.id) {
      strategies.splice(0, strategies.length, "manual_review");
    }
    seenEmails.set(normalizedEmail, user.id);

    const appUserId = preserveOrMapUuid(user.id, BUILDY_MIGRATION_NAMESPACE);
    return {
      appUserId,
      createdAt: user.createdAt,
      emailFingerprint: keyedFingerprint(fingerprintKey, "auth.email", normalizedEmail),
      emailVerifiedAtSource: user.emailVerified,
      identityMappingId: stableUuid(BUILDY_MIGRATION_NAMESPACE, `identity:legacy_auth:${user.id}`),
      legacyProvider: "legacy_auth" as const,
      legacySubjectId: user.id,
      sourceProviders: providers,
      status: strategies.includes("manual_review") ? "manual_review" as const : "pending" as const,
      strategies,
      targetAuthUserId: null,
    };
  });

  records.sort((left, right) => left.appUserId.localeCompare(right.appUserId));
  return {
    schemaVersion: 1,
    records,
    summary: {
      googleOidcReauthentication: records.filter((record) =>
        record.strategies.includes("google_oidc_reauthentication_required")).length,
      manualReview: records.filter((record) => record.strategies.includes("manual_review")).length,
      total: records.length,
      unsupportedProvider: records.filter((record) => !record.sourceProviders.includes("google")).length,
    },
    passwordHashesExported: false,
    sessionImportAllowed: false,
  };
}

export interface SessionInvalidationEvidence {
  sessionCookieBoundaryVerified: boolean;
  legacyAnonKeyRotatedAt?: string;
  legacyRefreshTokensRevokedAt?: string;
  legacyTokenRejectedAt?: string;
  sourceJwtSecretRotatedAt?: string;
}

export interface SessionInvalidationGate {
  complete: boolean;
  missing: string[];
  requiredActions: readonly string[];
}

export function evaluateOldSessionInvalidation(evidence: SessionInvalidationEvidence): SessionInvalidationGate {
  const missing: string[] = [];
  if (!evidence.sessionCookieBoundaryVerified) missing.push("session_cookie_boundary");
  if (!evidence.legacyRefreshTokensRevokedAt) missing.push("legacy_refresh_tokens_revoked");
  if (!evidence.sourceJwtSecretRotatedAt) missing.push("source_jwt_secret_rotated");
  if (!evidence.legacyAnonKeyRotatedAt) missing.push("legacy_anon_key_rotated");
  if (!evidence.legacyTokenRejectedAt) missing.push("legacy_token_rejection_verified");
  return {
    complete: missing.length === 0,
    missing,
    requiredActions: [
      "Zet de legacy app in onderhoudsmodus en beëindig alle refresh-sessies via afgeschermde beheercredentials.",
      "Roteer de legacy JWT-secret en de als gecompromitteerd behandelde anon key via het providerdashboard.",
      "Controleer dat de nieuwe OIDC-sessiecookie een eigen naam, origin en signing secret gebruikt.",
      "Bewijs met een oude synthetische token dat zowel legacy als nieuwe runtime toegang weigeren.",
      "Bewaar alleen tijdstempels en artifactchecksums als bewijs; leg nooit tokens of secrets vast.",
    ],
  };
}
