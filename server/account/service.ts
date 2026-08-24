import { createHash } from "node:crypto";
import {
  createAccountExportInputSchema,
  requestAccountDeletionInputSchema,
  type AccountExport,
  type AccountSession,
} from "../../shared/contracts/account.js";
import {
  guardObjectStream,
  type ObjectByteRange,
  type ObjectStorage,
} from "../storage/objectStorage.js";
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
  body: ReadableStream<Uint8Array> | null;
  status: 200 | 206;
  contentLength: number;
  range?: ObjectByteRange;
  filename: string;
  object: ExportDownloadObject;
}

function exportRange(value: string | null, sizeBytes: number): ObjectByteRange | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) throw new AccountError("INVALID_RANGE");
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) throw new AccountError("INVALID_RANGE");
    return { start: Math.max(0, sizeBytes - suffix), end: sizeBytes - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : sizeBytes - 1;
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || requestedEnd < start
    || start >= sizeBytes
  ) throw new AccountError("INVALID_RANGE");
  return { start, end: Math.min(requestedEnd, sizeBytes - 1) };
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

  async downloadExport(
    actorId: string,
    jobId: string,
    rangeHeader: string | null = null,
    headOnly = false,
  ): Promise<AccountExportDownload> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
      throw new AccountError("EXPORT_NOT_FOUND");
    }
    const object = await this.repository.resolveExportDownload(actorId, jobId);
    if (!object) throw new AccountError("EXPORT_NOT_READY");
    if (object.sizeBytes < 1 || object.sizeBytes > MAX_EXPORT_BYTES) {
      throw new AccountError("INVALID_STATE");
    }
    if (!/^[0-9a-f]{64}$/.test(object.sha256) || !/^[0-9a-f]{64}$/.test(object.manifestSha256)) {
      throw new AccountError("INVALID_STATE");
    }
    const range = headOnly ? null : exportRange(rangeHeader, object.sizeBytes);
    const contentLength = range ? range.end - range.start + 1 : object.sizeBytes;
    let body: ReadableStream<Uint8Array> | null = null;
    if (headOnly) {
      const metadata = await this.storage.headObject(object.objectKey);
      if (
        !metadata
        || metadata.key !== object.objectKey
        || metadata.sizeBytes !== object.sizeBytes
        || metadata.contentType !== "application/zip"
      ) throw new AccountError("INVALID_STATE");
    } else {
      const stored = await this.storage.streamObject({
        key: object.objectKey,
        maximumBytes: object.sizeBytes,
        range: range ?? undefined,
      });
      if (
        stored.metadata.key !== object.objectKey
        || stored.metadata.sizeBytes !== object.sizeBytes
        || stored.metadata.contentType !== "application/zip"
        || stored.contentLength !== contentLength
        || (range && (
          !stored.range
          || stored.range.start !== range.start
          || stored.range.end !== range.end
        ))
      ) throw new AccountError("INVALID_STATE");
      body = guardObjectStream({
        stream: stored.stream,
        expectedBytes: contentLength,
        expectedSha256Hex: range ? undefined : object.sha256,
      });
    }
    return {
      body,
      status: range ? 206 : 200,
      contentLength,
      range: range ?? undefined,
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
    if (!recentlyAuthenticated) throw new AccountError("REAUTH_REQUIRED");

    return this.repository.requestDeletion(
      actorId,
      scopedKey("deletion", actorId, input.idempotencyKey),
      this.retentionPolicyVersion,
    );
  }
}
