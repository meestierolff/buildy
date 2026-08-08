import { configureDefaultAuthRuntime, resetDefaultAuthRuntimeForTests, resolveDefaultAuthEngine } from "./auth/runtime.js";
import { resolveAuthConfiguration } from "./auth/config.js";
import { createPostgresAuthIdentityProvisioner } from "./auth/identity.js";
import { PostgresAuthEmailOutbox } from "./auth/postgresOutbox.js";
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
import { BetterAuthSubjectResolver, PostgresActiveAppUserLookup } from "./projects/authActor.js";
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
import { R2ObjectStorage } from "./storage/r2ObjectStorage.js";
import { PostgresPhotobookRepository } from "./photobooks/repository.js";
import { PhotobookService } from "./photobooks/service.js";
import { PhotobookProofWorker } from "./photobooks/worker.js";
import { HmacPhotobookProofViewReceipts } from "./photobooks/viewReceipt.js";
import {
  configureDefaultPhotobookRuntime,
  resetDefaultPhotobookRuntimeForTests,
} from "./photobooks/runtime.js";
import { ApprovedPriceMatrixQuoteProvider, parseApprovedPriceMatrix } from "./orders/approvedPriceMatrix.js";
import { hasCompleteOrderRuntime, parseSellerSnapshot } from "./orders/config.js";
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
import { PeechoV3HttpProvider } from "./print/peechoV3Provider.js";
import { KeyringFulfilmentPiiReader } from "./fulfilment/pii.js";
import { PostgresPeechoFulfilmentRepository } from "./fulfilment/repository.js";
import {
  configureDefaultPeechoFulfilmentRuntime,
  resetDefaultPeechoFulfilmentRuntimeForTests,
} from "./fulfilment/runtime.js";
import { PeechoFulfilmentWorker } from "./fulfilment/worker.js";
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

export type ServerCompositionStatus = "unconfigured" | "ready" | "failed";

let status: ServerCompositionStatus | undefined;

type ConfiguredAuthRuntime = RuntimeConfig & Required<Pick<
  RuntimeConfig,
  | "DATABASE_URL"
  | "BETTER_AUTH_SECRET"
  | "PII_ENCRYPTION_KEYS"
  | "PII_ENCRYPTION_CURRENT_VERSION"
  | "PII_BLIND_INDEX_KEY"
>>;

function hasCompleteAuthRuntime(config: RuntimeConfig): config is ConfiguredAuthRuntime {
  return Boolean(
    config.DATABASE_URL &&
    config.BETTER_AUTH_SECRET &&
    config.PII_ENCRYPTION_KEYS &&
    config.PII_ENCRYPTION_CURRENT_VERSION &&
    config.PII_BLIND_INDEX_KEY
  );
}

type ConfiguredR2BaseRuntime = RuntimeConfig & Required<Pick<
  RuntimeConfig,
  | "R2_ACCOUNT_ID"
  | "R2_BUCKET_NAME"
>>;

type ConfiguredWebStorageRuntime = ConfiguredR2BaseRuntime & Required<Pick<
  RuntimeConfig,
  | "R2_WEB_ACCESS_KEY_ID"
  | "R2_WEB_SECRET_ACCESS_KEY"
>>;

type ConfiguredMediaRuntime = ConfiguredAuthRuntime
  & ConfiguredWebStorageRuntime
  & Required<Pick<
    RuntimeConfig,
    | "DATABASE_MEDIA_WORKER_URL"
    | "CRON_SECRET"
    | "R2_MEDIA_WORKER_ACCESS_KEY_ID"
    | "R2_MEDIA_WORKER_SECRET_ACCESS_KEY"
  >>;

function hasCompleteMediaRuntime(config: ConfiguredAuthRuntime): config is ConfiguredMediaRuntime {
  return Boolean(
    config.DATABASE_MEDIA_WORKER_URL &&
    config.CRON_SECRET &&
    config.R2_ACCOUNT_ID &&
    config.R2_BUCKET_NAME &&
    config.R2_WEB_ACCESS_KEY_ID &&
    config.R2_WEB_SECRET_ACCESS_KEY &&
    config.R2_MEDIA_WORKER_ACCESS_KEY_ID &&
    config.R2_MEDIA_WORKER_SECRET_ACCESS_KEY
  );
}

type ConfiguredPhotobookRuntime = ConfiguredAuthRuntime
  & ConfiguredWebStorageRuntime
  & Required<Pick<
    RuntimeConfig,
    | "DATABASE_PHOTOBOOK_WORKER_URL"
    | "CRON_SECRET"
    | "R2_PHOTOBOOK_WORKER_ACCESS_KEY_ID"
    | "R2_PHOTOBOOK_WORKER_SECRET_ACCESS_KEY"
  >>;

function hasCompletePhotobookRuntime(config: ConfiguredAuthRuntime): config is ConfiguredPhotobookRuntime {
  return Boolean(
    config.DATABASE_PHOTOBOOK_WORKER_URL
    && config.CRON_SECRET
    && config.R2_ACCOUNT_ID
    && config.R2_BUCKET_NAME
    && config.R2_WEB_ACCESS_KEY_ID
    && config.R2_WEB_SECRET_ACCESS_KEY
    && config.R2_PHOTOBOOK_WORKER_ACCESS_KEY_ID
    && config.R2_PHOTOBOOK_WORKER_SECRET_ACCESS_KEY
  );
}

type ConfiguredAccountRuntime = ConfiguredAuthRuntime
  & ConfiguredWebStorageRuntime
  & Required<Pick<
    RuntimeConfig,
    | "ACCOUNT_RETENTION_POLICY_VERSION"
    | "ACCOUNT_RETENTION_POLICY_APPROVED_AT"
    | "DATABASE_ACCOUNT_WORKER_URL"
    | "CRON_SECRET"
    | "R2_ACCOUNT_WORKER_ACCESS_KEY_ID"
    | "R2_ACCOUNT_WORKER_SECRET_ACCESS_KEY"
  >>;

function hasCompleteAccountRuntime(config: ConfiguredAuthRuntime): config is ConfiguredAccountRuntime {
  return Boolean(
    config.ACCOUNT_RETENTION_POLICY_VERSION
    && config.ACCOUNT_RETENTION_POLICY_APPROVED_AT
    && config.DATABASE_ACCOUNT_WORKER_URL
    && config.CRON_SECRET
    && config.R2_ACCOUNT_ID
    && config.R2_BUCKET_NAME
    && config.R2_WEB_ACCESS_KEY_ID
    && config.R2_WEB_SECRET_ACCESS_KEY
    && config.R2_ACCOUNT_WORKER_ACCESS_KEY_ID
    && config.R2_ACCOUNT_WORKER_SECRET_ACCESS_KEY
  );
}

type ConfiguredFulfilmentRuntime = ConfiguredAuthRuntime
  & ConfiguredR2BaseRuntime
  & Required<Pick<
    RuntimeConfig,
    | "DATABASE_FULFILMENT_WORKER_URL"
    | "CRON_SECRET"
    | "R2_FULFILMENT_WORKER_ACCESS_KEY_ID"
    | "R2_FULFILMENT_WORKER_SECRET_ACCESS_KEY"
    | "PEECHO_ENVIRONMENT"
    | "PEECHO_MERCHANT_API_KEY"
    | "PEECHO_SECRET_KEY"
    | "PEECHO_OFFERING_ID_A4_LANDSCAPE"
    | "PEECHO_PDF_SIGNED_URL_TTL_SECONDS"
  >>;

function hasCompleteFulfilmentRuntime(config: ConfiguredAuthRuntime): config is ConfiguredFulfilmentRuntime {
  return Boolean(
    config.DATABASE_FULFILMENT_WORKER_URL
    && config.CRON_SECRET
    && config.R2_ACCOUNT_ID
    && config.R2_BUCKET_NAME
    && config.R2_FULFILMENT_WORKER_ACCESS_KEY_ID
    && config.R2_FULFILMENT_WORKER_SECRET_ACCESS_KEY
    && config.PEECHO_ENVIRONMENT
    && config.PEECHO_MERCHANT_API_KEY
    && config.PEECHO_SECRET_KEY
    && config.PEECHO_OFFERING_ID_A4_LANDSCAPE
    && config.PEECHO_PDF_SIGNED_URL_TTL_SECONDS
  );
}

function createR2Storage(
  config: ConfiguredR2BaseRuntime,
  credentials: { accessKeyId: string; secretAccessKey: string },
): R2ObjectStorage {
  return new R2ObjectStorage({
    accountId: config.R2_ACCOUNT_ID,
    bucketName: config.R2_BUCKET_NAME,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
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
    let webStorage: R2ObjectStorage | undefined;
    const resolveWebStorage = (config: ConfiguredWebStorageRuntime): R2ObjectStorage => {
      webStorage ??= createR2Storage(config, {
        accessKeyId: config.R2_WEB_ACCESS_KEY_ID,
        secretAccessKey: config.R2_WEB_SECRET_ACCESS_KEY,
      });
      return webStorage;
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
      identityProvisioner: createPostgresAuthIdentityProvisioner(
        protection.keyring,
        protection.blindIndex,
      ),
      outbox: new PostgresAuthEmailOutbox(database, protection.keyring, protection.blindIndex),
      rateLimitStorage,
      registrationGate,
    });

    const subjects = new BetterAuthSubjectResolver(resolveDefaultAuthEngine);
    const appUsers = new PostgresActiveAppUserLookup(database);
    const actors = new StrictMappedProjectActorResolver(subjects, appUsers);
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
      service: new ProjectService(new PostgresProjectRepository(database), protector),
    });
    configureDefaultSocialRuntime({
      actors: new StrictMappedSocialActorResolver(subjects, appUsers),
      service: new SocialService(new PostgresSocialRepository(database)),
    });
    configureDefaultEngagementRuntime({
      actors,
      service: new EngagementService(new PostgresEngagementRepository(database)),
    });
    configureDefaultPlanningRuntime({
      actors,
      service: new PlanningService(new PostgresPlanningRepository(database)),
    });
    configureDefaultProfileRuntime({
      actors,
      service: new ProfileService(new PostgresProfileRepository(database)),
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
    configureDefaultModerationAdminRuntime({
      actors: new StrictModerationAdminActorResolver(
        subjects,
        new PostgresModerationAdminActorLookup(database),
      ),
      service: new ModerationAdminService(
        new PostgresModerationAdminRepository(database),
        protection.keyring,
        protection.blindIndex,
      ),
    });

    if (hasCompleteAccountRuntime(runtime)) {
      const auth = resolveDefaultAuthEngine().account;
      if (!auth) throw new Error("Better Auth-accountprimitives zijn niet beschikbaar.");
      const accountWorkerStorage = createR2Storage(runtime, {
        accessKeyId: runtime.R2_ACCOUNT_WORKER_ACCESS_KEY_ID,
        secretAccessKey: runtime.R2_ACCOUNT_WORKER_SECRET_ACCESS_KEY,
      });
      configureDefaultAccountRuntime({
        actors,
        cronSecret: runtime.CRON_SECRET,
        service: new AccountService(
          new PostgresAccountRepository(database),
          auth,
          resolveWebStorage(runtime),
          runtime.R2_BUCKET_NAME,
          runtime.ACCOUNT_RETENTION_POLICY_VERSION,
        ),
        worker: new AccountLifecycleWorker(
          new PostgresAccountRepository(
            getBuildyWorkerDatabase(runtime.DATABASE_ACCOUNT_WORKER_URL, "account"),
          ),
          accountWorkerStorage,
          protection.keyring,
          runtime.R2_BUCKET_NAME,
          `account-worker:${runtime.APP_ENV}`,
        ),
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
          parseSellerSnapshot(runtime.ORDER_SELLER_JSON),
          runtime.APP_ORIGIN,
          runtime.ORDER_TERMS_VERSION,
          runtime.CHECKOUT_ENABLED,
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

    if (hasCompleteMediaRuntime(runtime)) {
      const mediaWorkerStorage = createR2Storage(runtime, {
        accessKeyId: runtime.R2_MEDIA_WORKER_ACCESS_KEY_ID,
        secretAccessKey: runtime.R2_MEDIA_WORKER_SECRET_ACCESS_KEY,
      });
      const mediaRepository = new PostgresMediaRepository(database);
      const mediaWorkerRepository = new PostgresMediaRepository(
        getBuildyWorkerDatabase(runtime.DATABASE_MEDIA_WORKER_URL, "media"),
      );
      configureDefaultMediaRuntime({
        actors,
        cronSecret: runtime.CRON_SECRET,
        service: new MediaService(
          mediaRepository,
          resolveWebStorage(runtime),
          new StorageBackedMediaUploadRateLimiter(rateLimitStorage),
          new HmacOriginalMediaPurposeGrants(runtime.BETTER_AUTH_SECRET),
          runtime.R2_BUCKET_NAME,
        ),
        worker: new MediaProcessingWorker(
          mediaWorkerRepository,
          mediaWorkerStorage,
          `media-worker:${runtime.APP_ENV}`,
        ),
      });
    }

    if (hasCompletePhotobookRuntime(runtime)) {
      const photobookWorkerStorage = createR2Storage(runtime, {
        accessKeyId: runtime.R2_PHOTOBOOK_WORKER_ACCESS_KEY_ID,
        secretAccessKey: runtime.R2_PHOTOBOOK_WORKER_SECRET_ACCESS_KEY,
      });
      configureDefaultPhotobookRuntime({
        actors,
        cronSecret: runtime.CRON_SECRET,
        service: new PhotobookService(
          new PostgresPhotobookRepository(database),
          runtime.R2_BUCKET_NAME,
          undefined,
          undefined,
          undefined,
          new HmacPhotobookProofViewReceipts(runtime.BETTER_AUTH_SECRET),
        ),
        storage: resolveWebStorage(runtime),
        worker: new PhotobookProofWorker(
          new PostgresPhotobookRepository(
            getBuildyWorkerDatabase(runtime.DATABASE_PHOTOBOOK_WORKER_URL, "photobook"),
          ),
          photobookWorkerStorage,
          `photobook-worker:${runtime.APP_ENV}`,
        ),
      });
    }

    if (hasCompleteFulfilmentRuntime(runtime)) {
      const fulfilmentWorkerStorage = createR2Storage(runtime, {
        accessKeyId: runtime.R2_FULFILMENT_WORKER_ACCESS_KEY_ID,
        secretAccessKey: runtime.R2_FULFILMENT_WORKER_SECRET_ACCESS_KEY,
      });
      const provider = new PeechoV3HttpProvider({
        environment: runtime.PEECHO_ENVIRONMENT,
        merchantApiKey: runtime.PEECHO_MERCHANT_API_KEY,
        secretKey: runtime.PEECHO_SECRET_KEY,
        timeoutMs: runtime.PEECHO_TIMEOUT_MS,
      });
      const repository = new PostgresPeechoFulfilmentRepository(
        getBuildyWorkerDatabase(runtime.DATABASE_FULFILMENT_WORKER_URL, "fulfilment"),
      );
      configureDefaultPeechoFulfilmentRuntime({
        applicationEnvironment: stripeWebhookApplicationEnvironment(runtime.APP_ENV),
        cronSecret: runtime.CRON_SECRET,
        provider,
        repository,
        worker: new PeechoFulfilmentWorker(
          repository,
          provider,
          fulfilmentWorkerStorage,
          new KeyringFulfilmentPiiReader(protection.keyring),
          `peecho-worker:${runtime.APP_ENV}`,
          {
            environment: runtime.PEECHO_ENVIRONMENT,
            bucketName: runtime.R2_BUCKET_NAME,
            offeringId: runtime.PEECHO_OFFERING_ID_A4_LANDSCAPE,
            signedUrlTtlSeconds: runtime.PEECHO_PDF_SIGNED_URL_TTL_SECONDS,
          },
        ),
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
  resetDefaultMediaRuntimeForTests();
  resetDefaultSocialRuntimeForTests();
  resetDefaultEngagementRuntimeForTests();
  resetDefaultPlanningRuntimeForTests();
  resetDefaultProfileRuntimeForTests();
  resetDefaultPhotobookRuntimeForTests();
  resetDefaultOrderRuntimeForTests();
  resetDefaultStripePaymentWebhookRuntimeForTests();
  resetDefaultAccountRuntimeForTests();
  resetDefaultPeechoFulfilmentRuntimeForTests();
  resetDefaultModerationRuntimeForTests();
  resetDefaultModerationAdminRuntimeForTests();
}
