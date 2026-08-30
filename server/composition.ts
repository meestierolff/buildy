import { copy, del, get, head, list, put } from "@vercel/blob";
import { handleUpload, type HandleUploadOptions } from "@vercel/blob/client";
import { configureDefaultAuthRuntime, resetDefaultAuthRuntimeForTests, resolveDefaultAuthEngine } from "./auth/runtime.js";
import { resolveAuthConfiguration } from "./auth/config.js";
import { createPostgresAuthIdentityProvisioner } from "./auth/identity.js";
import { PostgresAuthRateLimitStorage } from "./auth/postgresRateLimitStorage.js";
import { BetaRegistrationGate } from "./beta/authGate.js";
import { PostgresBetaRepository } from "./beta/repository.js";
import { configureDefaultBetaRuntime, resetDefaultBetaRuntimeForTests } from "./beta/runtime.js";
import { BetaService } from "./beta/service.js";
import { getRuntimeConfig, type RuntimeConfig } from "./config/runtime.js";
import { getBuildyDatabase, getBuildyWorkerDatabase } from "./db/client.js";
import { HmacOriginalMediaPurposeGrants } from "./media/purposeGrant.js";
import { StorageBackedMediaUploadRateLimiter } from "./media/rateLimit.js";
import { PostgresMediaRepository } from "./media/repository.js";
import { configureDefaultMediaRuntime, resetDefaultMediaRuntimeForTests } from "./media/runtime.js";
import { MediaService } from "./media/service.js";
import { MediaProcessingWorker } from "./media/worker.js";
import { PostgresEngagementRepository } from "./engagement/repository.js";
import {
  configureDefaultEngagementRuntime,
  resetDefaultEngagementRuntimeForTests,
} from "./engagement/runtime.js";
import { EngagementService } from "./engagement/service.js";
import { PostgresPlanningRepository } from "./planning/repository.js";
import {
  configureDefaultPlanningRuntime,
  resetDefaultPlanningRuntimeForTests,
} from "./planning/runtime.js";
import { PlanningService } from "./planning/service.js";
import { PostgresProfileRepository } from "./profiles/repository.js";
import {
  configureDefaultProfileRuntime,
  resetDefaultProfileRuntimeForTests,
} from "./profiles/runtime.js";
import { ProfileService } from "./profiles/service.js";
import { logEvent, safeErrorFields } from "./observability/logger.js";
import { StripePaymentProvider } from "./payments/stripePaymentProvider.js";
import { GoogleOidcSubjectResolver, PostgresActiveAppUserLookup } from "./projects/authActor.js";
import { KeyringProjectPrivateDetailsProtector } from "./projects/protector.js";
import { PostgresProjectRepository } from "./projects/repository.js";
import { configureDefaultProjectRuntime, resetDefaultProjectRuntimeForTests } from "./projects/runtime.js";
import { ProjectService } from "./projects/service.js";
import { StrictMappedProjectActorResolver } from "./projects/actor.js";
import { resolveRuntimeDataProtection } from "./security/runtimeDataProtection.js";
import { StrictMappedSocialActorResolver } from "./social/actor.js";
import { PostgresSocialRepository } from "./social/repository.js";
import {
  configureDefaultSocialRuntime,
  resetDefaultSocialRuntimeForTests,
} from "./social/runtime.js";
import { SocialService } from "./social/service.js";
import {
  VERCEL_BLOB_STORAGE_NAMESPACE,
  VercelBlobObjectStorage,
} from "./storage/vercelBlobObjectStorage.js";
import { PostgresPhotobookRepository } from "./photobooks/repository.js";
import { PhotobookService } from "./photobooks/service.js";
import { PhotobookProofWorker } from "./photobooks/worker.js";
import {
  configureDefaultPhotobookRuntime,
  resetDefaultPhotobookRuntimeForTests,
} from "./photobooks/runtime.js";
import { ApprovedPriceMatrixQuoteProvider, parseApprovedPriceMatrix } from "./orders/approvedPriceMatrix.js";
import { hasCompleteOrderRuntime, parseSellerConfiguration } from "./orders/config.js";
import { KeyringOrderPiiProtector } from "./orders/pii.js";
import { PostgresOrderRepository } from "./orders/repository.js";
import { configureDefaultOrderRuntime, resetDefaultOrderRuntimeForTests } from "./orders/runtime.js";
import { OrderService } from "./orders/service.js";
import {
  PostgresStripePaymentEventRepository,
  stripeWebhookApplicationEnvironment,
} from "./orders/paymentWebhook.js";
import {
  configureDefaultStripePaymentWebhookRuntime,
  resetDefaultStripePaymentWebhookRuntimeForTests,
} from "./orders/paymentWebhookRuntime.js";
import { PostgresAccountRepository } from "./account/repository.js";
import { AccountService } from "./account/service.js";
import { AccountLifecycleWorker } from "./account/worker.js";
import {
  configureDefaultAccountRuntime,
  resetDefaultAccountRuntimeForTests,
} from "./account/runtime.js";
import { PostgresModerationRepository } from "./moderation/repository.js";
import {
  configureDefaultModerationRuntime,
  resetDefaultModerationRuntimeForTests,
} from "./moderation/runtime.js";
import { ModerationService } from "./moderation/service.js";
import {
  PostgresModerationAdminActorLookup,
  StrictModerationAdminActorResolver,
} from "./moderation/adminActor.js";
import { PostgresModerationAdminRepository } from "./moderation/adminRepository.js";
import {
  configureDefaultModerationAdminRuntime,
  resetDefaultModerationAdminRuntimeForTests,
} from "./moderation/adminRuntime.js";
import { ModerationAdminService } from "./moderation/adminService.js";
import { PostgresFeedbackAdminRepository } from "./feedbackAdmin/repository.js";
import {
  configureDefaultFeedbackAdminRuntime,
  resetDefaultFeedbackAdminRuntimeForTests,
} from "./feedbackAdmin/runtime.js";
import { FeedbackAdminService } from "./feedbackAdmin/service.js";
import { PostgresOrderAdminRepository } from "./orders/adminRepository.js";
import {
  configureDefaultOrderAdminRuntime,
  resetDefaultOrderAdminRuntimeForTests,
} from "./orders/adminRuntime.js";
import { OrderAdminService } from "./orders/adminService.js";
import { ProjectShareCookieContext } from "./projectShares/cookie.js";
import { HmacProjectShareTokens } from "./projectShares/crypto.js";
import { PostgresProjectShareRepository } from "./projectShares/repository.js";
import {
  configureDefaultProjectShareRuntime,
  resetDefaultProjectShareRuntimeForTests,
} from "./projectShares/runtime.js";
import { ProjectShareService } from "./projectShares/service.js";

export type ServerCompositionStatus = "unconfigured" | "ready" | "failed";

let status: ServerCompositionStatus | undefined;

type ConfiguredAuthRuntime = RuntimeConfig & Required<Pick<
  RuntimeConfig,
  | "DATABASE_URL"
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "PII_ENCRYPTION_KEYS"
  | "PII_ENCRYPTION_CURRENT_VERSION"
  | "PII_BLIND_INDEX_KEY"
>>;

function hasCompleteAuthRuntime(config: RuntimeConfig): config is ConfiguredAuthRuntime {
  return Boolean(
    config.DATABASE_URL &&
    config.GOOGLE_CLIENT_ID &&
    config.GOOGLE_CLIENT_SECRET &&
    config.PII_ENCRYPTION_KEYS &&
    config.PII_ENCRYPTION_CURRENT_VERSION &&
    config.PII_BLIND_INDEX_KEY
  );
}

type ConfiguredBlobRuntime = RuntimeConfig & Required<Pick<RuntimeConfig, "BLOB_READ_WRITE_TOKEN">>;

type ConfiguredMediaRuntime = ConfiguredAuthRuntime
  & ConfiguredBlobRuntime
  & Required<Pick<RuntimeConfig, "DATABASE_MEDIA_WORKER_URL">>;

function hasCompleteMediaRuntime(config: ConfiguredAuthRuntime): config is ConfiguredMediaRuntime {
  return Boolean(
    config.DATABASE_MEDIA_WORKER_URL &&
    config.BLOB_READ_WRITE_TOKEN
  );
}

type ConfiguredPhotobookRuntime = ConfiguredAuthRuntime
  & ConfiguredBlobRuntime;

function hasCompletePhotobookRuntime(config: ConfiguredAuthRuntime): config is ConfiguredPhotobookRuntime {
  return Boolean(config.BLOB_READ_WRITE_TOKEN);
}

type ConfiguredAccountRuntime = ConfiguredAuthRuntime
  & ConfiguredBlobRuntime
  & Required<Pick<
    RuntimeConfig,
    | "ACCOUNT_RETENTION_POLICY_VERSION"
    | "ACCOUNT_RETENTION_POLICY_APPROVED_AT"
    | "DATABASE_ACCOUNT_WORKER_URL"
    | "CRON_SECRET"
  >>;

function hasCompleteAccountRuntime(config: ConfiguredAuthRuntime): config is ConfiguredAccountRuntime {
  return Boolean(
    config.ACCOUNT_RETENTION_POLICY_VERSION
    && config.ACCOUNT_RETENTION_POLICY_APPROVED_AT
    && config.DATABASE_ACCOUNT_WORKER_URL
    && config.CRON_SECRET
    && config.BLOB_READ_WRITE_TOKEN
  );
}

function createBlobStorage(config: ConfiguredBlobRuntime): VercelBlobObjectStorage {
  return new VercelBlobObjectStorage({
    token: config.BLOB_READ_WRITE_TOKEN,
    sdk: {
      put: (pathname, body, options) => put(pathname, Buffer.from(body), options),
      get,
      head,
      copy,
      del,
      list,
      handleUpload: (options) => handleUpload(options as HandleUploadOptions),
    },
  });
}

/**
 * Idempotently composes only server-owned dependencies. Missing external
 * configuration keeps protected domains unavailable; malformed configuration
 * is remembered as failed without exposing secret material in logs/responses.
 */
export function ensureServerComposition(): ServerCompositionStatus {
  if (status) return status;

  const runtime = getRuntimeConfig();
  if (!hasCompleteAuthRuntime(runtime)) {
    status = "unconfigured";
    return status;
  }

  try {
    const authConfig = resolveAuthConfiguration(runtime);
    const protection = resolveRuntimeDataProtection(runtime);
    const database = getBuildyDatabase(authConfig.databaseUrl);
    let blobStorage: VercelBlobObjectStorage | undefined;
    const resolveBlobStorage = (config: ConfiguredBlobRuntime): VercelBlobObjectStorage => {
      blobStorage ??= createBlobStorage(config);
      return blobStorage;
    };

    const rateLimitStorage = new PostgresAuthRateLimitStorage(database, protection.blindIndex);
    const betaService = new BetaService(
      authConfig.betaMode !== false,
      new PostgresBetaRepository(database),
      rateLimitStorage,
      protection.blindIndex,
    );
    const registrationGate = new BetaRegistrationGate(betaService);
    configureDefaultAuthRuntime({
      blindIndex: protection.blindIndex,
      identityProvisioner: createPostgresAuthIdentityProvisioner(),
      keyring: protection.keyring,
      rateLimitStorage,
      registrationGate,
    });

    const subjects = new GoogleOidcSubjectResolver(resolveDefaultAuthEngine);
    const appUsers = new PostgresActiveAppUserLookup(database);
    const shareTokens = new HmacProjectShareTokens(runtime.PII_BLIND_INDEX_KEY);
    const actors = new StrictMappedProjectActorResolver(
      subjects,
      appUsers,
      new ProjectShareCookieContext(shareTokens),
    );
    configureDefaultProjectShareRuntime({
      actors,
      secureCookies: authConfig.secureCookies,
      tokens: shareTokens,
      service: new ProjectShareService(
        new PostgresProjectShareRepository(database),
        shareTokens,
        authConfig.appOrigin,
      ),
    });
    configureDefaultBetaRuntime({
      actors,
      secureCookies: authConfig.secureCookies,
      service: betaService,
    });
    const protector = new KeyringProjectPrivateDetailsProtector(
      protection.keyring,
      runtime.PII_ENCRYPTION_CURRENT_VERSION,
    );
    configureDefaultProjectRuntime({
      actors,
      service: new ProjectService(
        new PostgresProjectRepository(database),
        protector,
        protection.blindIndex,
      ),
    });
    configureDefaultSocialRuntime({
      actors: new StrictMappedSocialActorResolver(subjects, appUsers),
      service: new SocialService(new PostgresSocialRepository(database)),
    });
    configureDefaultEngagementRuntime({
      actors,
      service: new EngagementService(
        new PostgresEngagementRepository(database),
        protection.blindIndex,
      ),
    });
    configureDefaultPlanningRuntime({
      actors,
      service: new PlanningService(
        new PostgresPlanningRepository(database),
        protection.blindIndex,
      ),
    });
    configureDefaultProfileRuntime({
      actors,
      service: new ProfileService(
        new PostgresProfileRepository(database),
        protection.blindIndex,
      ),
    });
    configureDefaultModerationRuntime({
      actors,
      service: new ModerationService(
        new PostgresModerationRepository(database),
        rateLimitStorage,
        protection.keyring,
        protection.blindIndex,
      ),
    });
    const adminActors = new StrictModerationAdminActorResolver(
      subjects,
      new PostgresModerationAdminActorLookup(database),
    );
    configureDefaultModerationAdminRuntime({
      actors: adminActors,
      service: new ModerationAdminService(
        new PostgresModerationAdminRepository(database),
        protection.keyring,
        protection.blindIndex,
      ),
    });
    configureDefaultFeedbackAdminRuntime({
      actors: adminActors,
      service: new FeedbackAdminService(
        new PostgresFeedbackAdminRepository(database),
        protection.keyring,
        protection.blindIndex,
      ),
    });

    const mediaComposition = hasCompleteMediaRuntime(runtime)
      ? (() => {
          const storage = resolveBlobStorage(runtime);
          const repository = new PostgresMediaRepository(database);
          const worker = new MediaProcessingWorker(
            new PostgresMediaRepository(
              getBuildyWorkerDatabase(runtime.DATABASE_MEDIA_WORKER_URL, "media"),
            ),
            storage,
            `media-worker:${runtime.APP_ENV}`,
          );
          return { storage, repository, worker };
        })()
      : undefined;

    if (hasCompleteAccountRuntime(runtime)) {
      const auth = resolveDefaultAuthEngine().account;
      const storage = resolveBlobStorage(runtime);
      configureDefaultAccountRuntime({
        actors,
        cronSecret: runtime.CRON_SECRET,
        service: new AccountService(
          new PostgresAccountRepository(database),
          auth,
          storage,
          VERCEL_BLOB_STORAGE_NAMESPACE,
          runtime.ACCOUNT_RETENTION_POLICY_VERSION,
        ),
        worker: new AccountLifecycleWorker(
          new PostgresAccountRepository(
            getBuildyWorkerDatabase(runtime.DATABASE_ACCOUNT_WORKER_URL, "account"),
          ),
          storage,
          protection.keyring,
          VERCEL_BLOB_STORAGE_NAMESPACE,
          `account-worker:${runtime.APP_ENV}`,
        ),
        ...(mediaComposition ? { orphanCleanup: mediaComposition.worker } : {}),
      });
    }

    if (hasCompleteOrderRuntime(runtime)) {
      const payments = new StripePaymentProvider({
        secretKey: runtime.STRIPE_SECRET_KEY,
        webhookSecret: runtime.STRIPE_WEBHOOK_SECRET,
        expectedAccountId: runtime.STRIPE_EXPECTED_ACCOUNT_ID,
        environment: runtime.STRIPE_ENVIRONMENT,
      });
      configureDefaultOrderRuntime({
        actors,
        service: new OrderService(
          new PostgresOrderRepository(database),
          new ApprovedPriceMatrixQuoteProvider(
            parseApprovedPriceMatrix(runtime.ORDER_PRICE_MATRIX_JSON),
            runtime.STRIPE_ENVIRONMENT,
          ),
          payments,
          new KeyringOrderPiiProtector(
            protection.keyring,
            runtime.PII_ENCRYPTION_CURRENT_VERSION,
          ),
          protection.blindIndex,
          parseSellerConfiguration(runtime.ORDER_SELLER_JSON, runtime.CHECKOUT_MODE),
          runtime.APP_ORIGIN,
          runtime.ORDER_TERMS_VERSION,
          true,
        ),
      });
      configureDefaultStripePaymentWebhookRuntime({
        applicationEnvironment: stripeWebhookApplicationEnvironment(runtime.APP_ENV),
        payments,
        repository: new PostgresStripePaymentEventRepository(
          getBuildyWorkerDatabase(runtime.DATABASE_PAYMENT_WORKER_URL, "payment"),
        ),
      });
    }

    if (mediaComposition) {
      configureDefaultMediaRuntime({
        actors,
        processor: mediaComposition.worker,
        service: new MediaService(
          mediaComposition.repository,
          mediaComposition.storage,
          new StorageBackedMediaUploadRateLimiter(rateLimitStorage),
          new HmacOriginalMediaPurposeGrants(runtime.PII_BLIND_INDEX_KEY),
          VERCEL_BLOB_STORAGE_NAMESPACE,
          protection.blindIndex,
        ),
      });
    }

    if (hasCompletePhotobookRuntime(runtime)) {
      const storage = resolveBlobStorage(runtime);
      const proofRuntimeEnabled = (runtime.CHECKOUT_MODE === "test" || runtime.CHECKOUT_MODE === "live")
        && Boolean(runtime.DATABASE_PHOTOBOOK_WORKER_URL);
      const photobookWorker = proofRuntimeEnabled
        ? new PhotobookProofWorker(
            new PostgresPhotobookRepository(
              getBuildyWorkerDatabase(runtime.DATABASE_PHOTOBOOK_WORKER_URL!, "photobook"),
            ),
            storage,
            `photobook-worker:${runtime.APP_ENV}`,
          )
        : undefined;
      configureDefaultPhotobookRuntime({
        actors,
        service: new PhotobookService(
          new PostgresPhotobookRepository(database),
          VERCEL_BLOB_STORAGE_NAMESPACE,
          protection.blindIndex,
          undefined,
          undefined,
          undefined,
          photobookWorker,
          Boolean(photobookWorker),
        ),
        storage,
      });
    }

    if (runtime.BLOB_READ_WRITE_TOKEN) {
      const storage = resolveBlobStorage(runtime as ConfiguredBlobRuntime);
      configureDefaultOrderAdminRuntime({
        actors: adminActors,
        service: new OrderAdminService(
          new PostgresOrderAdminRepository(database),
          protection.keyring,
          protection.blindIndex,
        ),
        storage,
      });
    }

    status = "ready";
    return status;
  } catch (error) {
    status = "failed";
    logEvent("error", "server.composition_failed", safeErrorFields(error));
    return status;
  }
}

export function getServerCompositionStatus(): ServerCompositionStatus {
  return ensureServerComposition();
}

export function resetServerCompositionForTests(): void {
  status = undefined;
  resetDefaultAuthRuntimeForTests();
  resetDefaultBetaRuntimeForTests();
  resetDefaultProjectRuntimeForTests();
  resetDefaultProjectShareRuntimeForTests();
  resetDefaultMediaRuntimeForTests();
  resetDefaultSocialRuntimeForTests();
  resetDefaultEngagementRuntimeForTests();
  resetDefaultPlanningRuntimeForTests();
  resetDefaultProfileRuntimeForTests();
  resetDefaultPhotobookRuntimeForTests();
  resetDefaultOrderRuntimeForTests();
  resetDefaultStripePaymentWebhookRuntimeForTests();
  resetDefaultAccountRuntimeForTests();
  resetDefaultOrderAdminRuntimeForTests();
  resetDefaultModerationRuntimeForTests();
  resetDefaultModerationAdminRuntimeForTests();
  resetDefaultFeedbackAdminRuntimeForTests();
}
