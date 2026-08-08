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
  | "password_set_required"
  | "magic_link_first_login"
  | "oauth_relink_required"
  | "manual_review";

export interface AuthMigrationRecord {
  appUserId: string;
  createdAt: string;
  email: string;
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
    disabled: number;
    manualReview: number;
    oauthRelink: number;
    passwordSet: number;
    passwordless: number;
    total: number;
  };
  passwordHashesExported: false;
  sessionImportAllowed: false;
}

function normalizeProviders(providers: readonly string[]): string[] {
  return [...new Set(providers.map((value) => value.trim().toLowerCase()).filter(Boolean))].sort();
}

function migrationStrategies(user: LegacyAuthUser, providers: readonly string[]): AuthMigrationStrategy[] {
  if (user.disabled) return ["manual_review"];
  const strategies = new Set<AuthMigrationStrategy>();
  if (user.hasPassword) strategies.add("password_set_required");
  else strategies.add("magic_link_first_login");
  if (providers.some((provider) => !["email", "password"].includes(provider))) {
    strategies.add("oauth_relink_required");
  }
  return [...strategies].sort();
}

/**
 * Produces the only supported auth bridge. Password hashes and source sessions
 * are deliberately absent: accounts are linked after a verified magic-link or
 * password-set flow, while the stable application UUID keeps ownership intact.
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
    if (previousSubject && previousSubject !== user.id && !strategies.includes("manual_review")) {
      strategies.push("manual_review");
      strategies.sort();
    }
    seenEmails.set(normalizedEmail, user.id);

    const appUserId = preserveOrMapUuid(user.id, BUILDY_MIGRATION_NAMESPACE);
    return {
      appUserId,
      createdAt: user.createdAt,
      email: normalizedEmail,
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
      disabled: records.filter((record) => record.status === "manual_review").length,
      manualReview: records.filter((record) => record.strategies.includes("manual_review")).length,
      oauthRelink: records.filter((record) => record.strategies.includes("oauth_relink_required")).length,
      passwordSet: records.filter((record) => record.strategies.includes("password_set_required")).length,
      passwordless: records.filter((record) => record.strategies.includes("magic_link_first_login")).length,
      total: records.length,
    },
    passwordHashesExported: false,
    sessionImportAllowed: false,
  };
}

export interface SessionInvalidationEvidence {
  betterAuthCookieNamespaceVerified: boolean;
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
  if (!evidence.betterAuthCookieNamespaceVerified) missing.push("better_auth_cookie_namespace");
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
      "Controleer dat de Better Auth-cookie een eigen naam, origin en signing secret gebruikt.",
      "Bewijs met een oude synthetische token dat zowel legacy als nieuwe runtime toegang weigeren.",
      "Bewaar alleen tijdstempels en artifactchecksums als bewijs; leg nooit tokens of secrets vast.",
    ],
  };
}
