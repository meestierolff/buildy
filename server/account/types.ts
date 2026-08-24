import type {
  AccountExport,
  AccountExportStatus,
  AccountSession,
} from "../../shared/contracts/account.js";

export interface AccountAuthSession extends AccountSession {
  authUserId: string;
}

export interface AccountAuthGateway {
  currentSession(request: Request): Promise<AccountAuthSession | null>;
  listSessions(request: Request): Promise<AccountAuthSession[]>;
  revokeSession(request: Request, sessionId: string): Promise<{ revoked: boolean; wasCurrent: boolean }>;
}

export interface ExportMutation {
  jobId: string;
  status: AccountExportStatus;
  replayed: boolean;
}

export interface DeletionMutation {
  jobId: string;
  status:
    | "requested"
    | "blocked_active_order"
    | "deletion_pending"
    | "database_redaction"
    | "storage_cleanup"
    | "verification"
    | "completed"
    | "retry_scheduled"
    | "manual_review"
    | "dead_letter";
  activeOrderCount: number;
  replayed: boolean;
}

export interface ExportDownloadObject {
  jobId: string;
  objectKey: string;
  sizeBytes: number;
  sha256: string;
  manifestSha256: string;
}

export interface AccountExportSourceAsset {
  id: string;
  storageProvider: string;
  bucket: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  purpose: string;
}

export interface AccountExportJob {
  workerId: string;
  jobId: string;
  userId: string;
  exportAssetId: string;
  objectKey: string;
  includeMedia: boolean;
  attemptCount: number;
  requestedAt: string;
  payload: unknown;
  sourceAssets: AccountExportSourceAsset[];
}

export interface ExpiredExportJob {
  workerId: string;
  jobId: string;
  exportAssetId: string;
  objectKey: string;
  attemptCount: number;
}

export interface AccountDeletionAssetJob {
  workerId: string;
  jobId: string;
  targetId: string;
  deletionAssetId: string | null;
  mediaAssetId: string | null;
  storageProvider: string | null;
  bucket: string | null;
  objectKey: string | null;
  expectedSha256: string | null;
  attemptCount: number;
  assetAttemptCount: number;
}

export interface AccountRepository {
  requestExport(actorId: string, idempotencyKey: string, includeMedia: boolean, bucket: string): Promise<ExportMutation>;
  listExports(actorId: string): Promise<AccountExport[]>;
  resolveExportDownload(actorId: string, jobId: string): Promise<ExportDownloadObject | null>;
  requestDeletion(actorId: string, idempotencyKey: string, retentionPolicyVersion: string): Promise<DeletionMutation>;
}

export interface AccountWorkerRepository {
  claimExport(workerId: string, leaseSeconds: number): Promise<AccountExportJob | null>;
  finalizeExport(job: AccountExportJob, archiveSha256: string, archiveSizeBytes: number, manifestSha256: string): Promise<boolean>;
  failExport(job: AccountExportJob, failureCode: string, retry: { delaySeconds: number } | null): Promise<void>;
  claimExpiredExport(workerId: string, leaseSeconds: number): Promise<ExpiredExportJob | null>;
  finalizeExportCleanup(job: ExpiredExportJob): Promise<void>;
  failExportCleanup(job: ExpiredExportJob, failureCode: string, retry: { delaySeconds: number } | null): Promise<void>;
  claimDeletion(workerId: string, leaseSeconds: number): Promise<AccountDeletionAssetJob | null>;
  verifyDeletionAsset(job: AccountDeletionAssetJob): Promise<void>;
  failDeletion(job: AccountDeletionAssetJob, failureCode: string, retry: { delaySeconds: number } | null): Promise<void>;
  finalizeDeletion(job: AccountDeletionAssetJob): Promise<"completed" | "blocked_active_order">;
}
