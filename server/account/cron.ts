import { createHash, timingSafeEqual } from "node:crypto";
import { HttpError } from "../http/errors.js";
import { jsonSuccess } from "../http/responses.js";
import type { MediaOrphanCleanupResult } from "../media/worker.js";
import { logEvent, safeErrorFields } from "../observability/logger.js";
import { resolveDefaultAccountWorker } from "./runtime.js";
import type { AccountWorkerResult } from "./worker.js";

const DEFAULT_MAXIMUM_ACCOUNT_CLAIMS = 12;
const DEFAULT_ACCOUNT_TIME_BUDGET_MS = 180_000;
const DEFAULT_TOTAL_TIME_BUDGET_MS = 240_000;
const DEFAULT_MEDIA_PAGES_PER_PREFIX = 4;
const DEFAULT_MEDIA_DELETE_ATTEMPTS = 80;

type AccountOutcomeStatus = Exclude<AccountWorkerResult["status"], "idle">;

export type AccountCronBatchOptions = {
  maximumAccountClaims?: number;
  accountTimeBudgetMs?: number;
  totalTimeBudgetMs?: number;
  mediaPagesPerPrefix?: number;
  mediaDeleteAttempts?: number;
  now?: () => number;
};

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new Error(`${label} is ongeldig.`);
  }
  return candidate;
}

function outcomeCounts(): Record<AccountOutcomeStatus, number> {
  return {
    export_ready: 0,
    export_cancelled: 0,
    export_expired: 0,
    deletion_asset_verified: 0,
    deletion_completed: 0,
    deletion_blocked: 0,
    retry_scheduled: 0,
    dead_letter: 0,
  };
}

function secretMatches(actual: string | null, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual ?? "").digest();
  const expectedDigest = createHash("sha256").update(`Bearer ${expected}`).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

export function createAccountCronHandler(
  resolveWorker = resolveDefaultAccountWorker,
  options: AccountCronBatchOptions = {},
) {
  const maximumAccountClaims = boundedInteger(
    options.maximumAccountClaims,
    DEFAULT_MAXIMUM_ACCOUNT_CLAIMS,
    1,
    100,
    "Accountclaimgrens",
  );
  const totalTimeBudgetMs = boundedInteger(
    options.totalTimeBudgetMs,
    DEFAULT_TOTAL_TIME_BUDGET_MS,
    1,
    270_000,
    "Onderhoudstijdbudget",
  );
  const accountTimeBudgetMs = boundedInteger(
    options.accountTimeBudgetMs,
    DEFAULT_ACCOUNT_TIME_BUDGET_MS,
    1,
    totalTimeBudgetMs,
    "Accounttijdbudget",
  );
  const mediaPagesPerPrefix = boundedInteger(
    options.mediaPagesPerPrefix,
    DEFAULT_MEDIA_PAGES_PER_PREFIX,
    1,
    20,
    "Media-cleanuppaginagrens",
  );
  const mediaDeleteAttempts = boundedInteger(
    options.mediaDeleteAttempts,
    DEFAULT_MEDIA_DELETE_ATTEMPTS,
    1,
    500,
    "Media-cleanupverwijdergrens",
  );
  const now = options.now ?? Date.now;

  return async function handleAccountCronRequest(request: Request, requestId: string): Promise<Response> {
    const runtime = resolveWorker();
    if (!secretMatches(request.headers.get("authorization"), runtime.cronSecret)) {
      throw new HttpError(401, "UNAUTHENTICATED", "Deze workerroute is niet toegankelijk.");
    }

    const startedAt = now();
    const accountDeadline = startedAt + accountTimeBudgetMs;
    const totalDeadline = startedAt + totalTimeBudgetMs;
    const outcomes = outcomeCounts();
    const deadLetters: Array<{ jobId: string; operation: "export" | "export_cleanup" | "deletion" }> = [];
    let accountClaims = 0;
    let accountProcessed = 0;
    let accountIdle = false;
    let accountFailureCode: "ACCOUNT_BATCH_FAILED" | null = null;

    while (accountClaims < maximumAccountClaims && now() < accountDeadline) {
      accountClaims += 1;
      let result: AccountWorkerResult;
      try {
        result = await runtime.worker.processNext();
      } catch (error) {
        accountFailureCode = "ACCOUNT_BATCH_FAILED";
        logEvent("error", "account.lifecycle_batch_failed", {
          requestId,
          accountClaims,
          accountProcessed,
          ...safeErrorFields(error),
        });
        break;
      }
      if (result.status === "idle") {
        accountIdle = true;
        break;
      }
      accountProcessed += 1;
      outcomes[result.status] += 1;
      if (result.status === "dead_letter") {
        deadLetters.push({ jobId: result.jobId, operation: result.operation });
        logEvent("error", "account.lifecycle_dead_letter", {
          requestId,
          jobId: result.jobId,
          operation: result.operation,
        });
      }
    }

    const accountLimitedBy = accountFailureCode
      ? "failure"
      : accountIdle
        ? "idle"
        : accountClaims >= maximumAccountClaims
          ? "count"
          : "time";

    let media: {
      status: "unconfigured" | "completed" | "partial" | "completed_with_failures" | "failed";
      result?: MediaOrphanCleanupResult;
      failureCode?: "MEDIA_ORPHAN_CLEANUP_FAILED";
    };
    if (!runtime.orphanCleanup) {
      media = { status: "unconfigured" };
    } else if (now() >= totalDeadline) {
      media = {
        status: "partial",
        result: {
          inspected: 0,
          pages: 0,
          deleteAttempts: 0,
          deleted: 0,
          deleteFailures: 0,
          checkpointsClaimed: 0,
          checkpointsCompleted: 0,
          limitedBy: "time",
          failures: [],
        },
      };
    } else {
      try {
        const result = await runtime.orphanCleanup.cleanupOrphans({
          maximumPagesPerPrefix: mediaPagesPerPrefix,
          maximumDeleteAttempts: mediaDeleteAttempts,
          shouldContinue: () => now() < totalDeadline,
        });
        for (const failure of result.failures) {
          logEvent(
            failure.status === "dead_letter" ? "error" : "warn",
            failure.status === "dead_letter"
              ? "media.orphan_cleanup_dead_letter"
              : "media.orphan_cleanup_retry_scheduled",
            {
              requestId,
              purpose: failure.purpose,
              failureCode: failure.failureCode,
            },
          );
        }
        media = {
          status: result.failures.length > 0
            ? "completed_with_failures"
            : result.limitedBy === "none" ? "completed" : "partial",
          result,
        };
      } catch (error) {
        logEvent("error", "media.orphan_cleanup_batch_failed", {
          requestId,
          ...safeErrorFields(error),
        });
        media = { status: "failed", failureCode: "MEDIA_ORPHAN_CLEANUP_FAILED" };
      }
    }

    const hasFailures = Boolean(
      accountFailureCode
      || deadLetters.length > 0
      || media.status === "completed_with_failures"
      || media.status === "failed",
    );
    const hasLimits = accountLimitedBy === "count"
      || accountLimitedBy === "time"
      || media.status === "partial";
    const status = hasFailures
      ? "completed_with_failures"
      : hasLimits ? "partial" : "completed";
    const elapsedMs = Math.max(0, now() - startedAt);

    logEvent(hasFailures ? "warn" : "info", "maintenance.daily_completed", {
      requestId,
      status,
      elapsedMs,
      accountClaims,
      accountProcessed,
      accountDeadLetters: deadLetters.length,
      mediaStatus: media.status,
      mediaDeleted: media.result?.deleted,
      mediaDeleteFailures: media.result?.deleteFailures,
    });

    return jsonSuccess({
      status,
      elapsedMs,
      limits: {
        maximumAccountClaims,
        accountTimeBudgetMs,
        totalTimeBudgetMs,
        mediaPagesPerPrefix,
        mediaDeleteAttempts,
      },
      account: {
        claims: accountClaims,
        processed: accountProcessed,
        limitedBy: accountLimitedBy,
        outcomes,
        deadLetters,
        ...(accountFailureCode ? { failureCode: accountFailureCode } : {}),
      },
      media,
    }, requestId);
  };
}

export const handleDefaultAccountCronRequest = createAccountCronHandler();
