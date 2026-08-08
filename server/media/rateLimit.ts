export type MediaUploadRateLimitInput = {
  actorId: string;
  projectId: string;
  requestedBytes: number;
};

export type MediaUploadRateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number | null;
};

export interface MediaUploadRateLimiter {
  consume(input: MediaUploadRateLimitInput): Promise<MediaUploadRateLimitDecision>;
}

export interface AtomicRateLimitStorage {
  consume(
    key: string,
    rule: { window: number; max: number },
  ): Promise<{ allowed: boolean; retryAfter: number | null }>;
}

const UPLOAD_INTENT_WINDOW_SECONDS = 15 * 60;
const MAX_UPLOAD_INTENTS_PER_WINDOW = 30;

export class StorageBackedMediaUploadRateLimiter implements MediaUploadRateLimiter {
  constructor(private readonly storage: AtomicRateLimitStorage) {}

  async consume(input: MediaUploadRateLimitInput): Promise<MediaUploadRateLimitDecision> {
    const decision = await this.storage.consume(
      `media-upload-intent:v1:${input.actorId}:${input.projectId}`,
      { window: UPLOAD_INTENT_WINDOW_SECONDS, max: MAX_UPLOAD_INTENTS_PER_WINDOW },
    );
    return {
      allowed: decision.allowed,
      retryAfterSeconds: decision.retryAfter,
    };
  }
}
