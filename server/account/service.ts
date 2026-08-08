import { createHash } from "node:crypto";
import {
  createAccountExportInputSchema,
  requestAccountDeletionInputSchema,
  type AccountExport,
  type AccountSession,
} from "../../shared/contracts/account.js";
import type { ObjectStorage } from "../storage/objectStorage.js";
import { AccountError } from "./errors.js";
import type {
  AccountAuthGateway,
  AccountRepository,
  DeletionMutation,
  ExportDownloadObject,
} from "./types.js";

const MAX_EXPORT_BYTES = 250 * 1024 * 1024;
const RECENT_SESSION_MILLISECONDS = 10 * 60 * 1_000;

function scopedKey(operation: string, actorId: string, clientKey: string): string {
  return createHash("sha256")
    .update(`buildy-account:${operation}:v1\0`)
    .update(actorId)
    .update("\0")
    .update(clientKey)
    .digest("hex");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function publicSession(session: Awaited<ReturnType<AccountAuthGateway["listSessions"]>>[number]): AccountSession {
  return {
    id: session.id,
    isCurrent: session.isCurrent,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt,
    ipAddress: session.ipAddress,
    userAgent: session.userAgent,
  };
}

export interface AccountExportDownload {
  bytes: Uint8Array;
  filename: string;
  object: ExportDownloadObject;
}

export class AccountService {
  constructor(
    private readonly repository: AccountRepository,
    private readonly auth: AccountAuthGateway,
    private readonly storage: ObjectStorage,
    private readonly bucket: string,
    private readonly retentionPolicyVersion: string,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(retentionPolicyVersion)) {
      throw new Error("Accountretentiebeleid is niet goedgekeurd of ongeldig.");
    }
  }

  async sessions(request: Request): Promise<AccountSession[]> {
    try {
      const current = await this.auth.currentSession(request);
      if (!current) throw new AccountError("ACTOR_REQUIRED");
      return (await this.auth.listSessions(request)).map(publicSession);
    } catch (error) {
      if (error instanceof AccountError) throw error;
      throw new AccountError("REAUTH_REQUIRED", { cause: error });
    }
  }

  async revokeSession(
    request: Request,
    sessionId: string,
  ): Promise<{ revokedSessionId: string; revokedCurrentSession: boolean }> {
    if (!sessionId || sessionId.length > 255) throw new AccountError("SESSION_NOT_FOUND");
    try {
      const result = await this.auth.revokeSession(request, sessionId);
      if (!result.revoked) throw new AccountError("SESSION_NOT_FOUND");
      return { revokedSessionId: sessionId, revokedCurrentSession: result.wasCurrent };
    } catch (error) {
      if (error instanceof AccountError) throw error;
      throw new AccountError("REAUTH_REQUIRED", { cause: error });
    }
  }

  async exports(actorId: string): Promise<AccountExport[]> {
    return this.repository.listExports(actorId);
  }

  async createExport(
    actorId: string,
    rawInput: unknown,
  ): Promise<{ export: AccountExport; replayed: boolean }> {
    const input = createAccountExportInputSchema.parse(rawInput);
    const mutation = await this.repository.requestExport(
      actorId,
      scopedKey("export", actorId, input.idempotencyKey),
      input.includeMedia,
      this.bucket,
    );
    const item = (await this.repository.listExports(actorId))
      .find((candidate) => candidate.id === mutation.jobId);
    if (!item) throw new AccountError("INVALID_STATE");
    return { export: item, replayed: mutation.replayed };
  }

  async downloadExport(actorId: string, jobId: string): Promise<AccountExportDownload> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
      throw new AccountError("EXPORT_NOT_FOUND");
    }
    const object = await this.repository.resolveExportDownload(actorId, jobId);
    if (!object) throw new AccountError("EXPORT_NOT_READY");
    if (object.sizeBytes < 1 || object.sizeBytes > MAX_EXPORT_BYTES) {
      throw new AccountError("INVALID_STATE");
    }
    const bytes = await this.storage.readObject(object.objectKey, object.sizeBytes);
    if (bytes.byteLength !== object.sizeBytes || sha256(bytes) !== object.sha256) {
      throw new AccountError("INVALID_STATE");
    }
    return {
      bytes,
      filename: `buildy-data-export-${jobId.slice(0, 8)}.zip`,
      object,
    };
  }

  async requestDeletion(
    actorId: string,
    request: Request,
    rawInput: unknown,
  ): Promise<DeletionMutation> {
    const input = requestAccountDeletionInputSchema.parse(rawInput);
    let session;
    try {
      session = await this.auth.currentSession(request);
    } catch (error) {
      throw new AccountError("AUTH_UNAVAILABLE", { cause: error });
    }
    if (!session) throw new AccountError("ACTOR_REQUIRED");

    const sessionCreatedAt = new Date(session.createdAt).getTime();
    const recentlyAuthenticated = Number.isFinite(sessionCreatedAt)
      && this.clock().getTime() - sessionCreatedAt <= RECENT_SESSION_MILLISECONDS;
    let passwordVerified = false;
    if (input.currentPassword) {
      try {
        passwordVerified = await this.auth.verifyPassword(request, input.currentPassword);
      } catch (error) {
        throw new AccountError("AUTH_UNAVAILABLE", { cause: error });
      }
    }
    if (!recentlyAuthenticated && !passwordVerified) throw new AccountError("REAUTH_REQUIRED");

    return this.repository.requestDeletion(
      actorId,
      scopedKey("deletion", actorId, input.idempotencyKey),
      this.retentionPolicyVersion,
    );
  }
}
