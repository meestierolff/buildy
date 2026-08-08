import type {
  MediaAssetState,
  MediaDisplaySize,
  MediaUploadPurpose,
  ProjectImageContentType,
} from "../../shared/contracts/media.js";
import type { ProjectActor } from "../projects/actor.js";
import type { ProcessedImageVariant } from "./imageProcessing.js";

export type MediaAssetStatus = MediaAssetState["status"];

export type CreateUploadIntentCommand = {
  assetId: string;
  actorId: string;
  projectId: string;
  purpose: MediaUploadPurpose;
  temporaryObjectKey: string;
  bucket: string;
  contentType: ProjectImageContentType;
  sizeBytes: number;
  checksumSha256Base64: string;
  checksumSha256Hex: string;
  idempotencyKey: string;
  requestHash: string;
};

export type InternalUploadIntent = {
  asset: MediaAssetState;
  temporaryObjectKey: string;
  contentType: ProjectImageContentType;
  sizeBytes: number;
  checksumSha256Base64: string;
  replayed: boolean;
};

export type PendingUpload = {
  asset: MediaAssetState;
  ownerId: string;
  temporaryObjectKey: string;
  contentType: ProjectImageContentType;
  maximumBytes: number;
  checksumSha256Base64: string;
  checksumSha256Hex: string;
};

export type CompleteUploadCommand = {
  actorId: string;
  assetId: string;
  objectSizeBytes: number;
  objectContentType: string;
  objectChecksumSha256Base64: string;
  objectEtag: string | null;
};

export type DisplayObject = {
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  sha256Hex: string;
  effectivePrivacyVersion: string;
  publiclyCacheable: boolean;
};

export type OriginalObject = {
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  sha256Hex: string;
};

export type MediaProcessingJob = {
  workerId: string;
  eventId: string;
  assetId: string;
  ownerId: string;
  projectId: string;
  purpose: MediaUploadPurpose;
  temporaryObjectKey: string;
  bucket: string;
  claimedContentType: ProjectImageContentType;
  expectedSizeBytes: number;
  expectedSha256Hex: string;
  privacyVersion: number;
  attemptCount: number;
};

export type ProcessedDerivative = {
  assetId: string;
  size: MediaDisplaySize;
  objectKey: string;
  variant: ProcessedImageVariant;
};

export type FinalizeMediaProcessingCommand = {
  job: MediaProcessingJob;
  originalObjectKey: string;
  original: ProcessedImageVariant;
  detectedContentType: string;
  derivatives: readonly ProcessedDerivative[];
  now: Date;
};

export interface MediaRepository {
  createUploadIntent(command: CreateUploadIntentCommand): Promise<InternalUploadIntent>;
  findUploadForCompletion(actorId: string, assetId: string): Promise<PendingUpload | null>;
  completeUpload(command: CompleteUploadCommand): Promise<{ asset: MediaAssetState; replayed: boolean }>;
  rejectUpload(actorId: string, assetId: string, failureCode: string): Promise<void>;
  resolveDisplayObject(
    viewer: ProjectActor,
    assetId: string,
    size: MediaDisplaySize,
  ): Promise<DisplayObject | null>;
  resolveOwnedOriginal(actorId: string, assetId: string): Promise<OriginalObject | null>;
  claimProcessingJob(workerId: string, leaseSeconds: number): Promise<MediaProcessingJob | null>;
  finalizeProcessing(command: FinalizeMediaProcessingCommand): Promise<void>;
  failProcessing(
    job: MediaProcessingJob,
    failureCode: string,
    retry: { delaySeconds: number } | null,
  ): Promise<void>;
  filterProtectedObjectKeys(candidateKeys: readonly string[]): Promise<Set<string>>;
}

export type MediaClock = () => Date;
export type MediaIdFactory = () => string;
