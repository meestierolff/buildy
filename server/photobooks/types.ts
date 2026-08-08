import type {
  PhotobookDocument,
  PhotobookExclusion,
  PhotobookPreferences,
  PhotobookSettings,
} from "../../shared/contracts/photobooks.js";
import type { PhotobookUpdateSource } from "./document.js";

export type PhotobookProofStatus =
  | "draft"
  | "rendering"
  | "ready"
  | "approved"
  | "locked"
  | "invalidated"
  | "failed";

export type PhotobookProofSummary = {
  revisionId: string;
  status: PhotobookProofStatus;
  documentSha256: string;
  pdfSha256: string | null;
  pageCount: number | null;
};

export type PhotobookEditorState = {
  draftId: string;
  version: number;
  settings: PhotobookSettings;
  exclusions: PhotobookExclusion[];
  document: PhotobookDocument;
  proof: {
    revisionId: string;
    status: PhotobookProofStatus;
    documentSha256: string;
    pdfSha256: string | null;
    pageCount: number | null;
    pdfPath: string | null;
    thumbnailPaths: string[];
  } | null;
};

export type PhotobookSource = {
  projectId: string;
  ownerId: string;
  projectRevision: number;
  projectTitle: string;
  projectSubtitle: string | null;
  settings: PhotobookSettings;
  exclusions: PhotobookExclusion[];
  draftId: string | null;
  draftVersion: number | null;
  updates: PhotobookUpdateSource[];
};

export type SavePhotobookSettingsCommand = {
  actorId: string;
  projectId: string;
  settings: PhotobookSettings;
};

export type SavePhotobookDraftCommand = {
  actorId: string;
  draftId: string;
  projectId: string;
  projectRevision: number;
  document: PhotobookDocument;
};

export type RequestPhotobookProofCommand = {
  actorId: string;
  projectId: string;
  draftId: string;
  expectedDraftVersion: number;
  document: PhotobookDocument;
  revisionId: string;
  pdfAssetId: string;
  pdfObjectKey: string;
  bucket: string;
  idempotencyKey: string;
  requestHash: string;
};

export type ApprovePhotobookProofCommand = {
  actorId: string;
  revisionId: string;
  documentSha256: string;
  pdfSha256: string;
  viewReceipt: string;
  idempotencyKey: string;
  requestHash: string;
  approvedAt: Date;
};

export type PhotobookProofMutation = {
  revisionId: string;
  status: "rendering" | "approved";
  replayed: boolean;
};

export type PhotobookProofObject = {
  revisionId: string;
  status: "ready" | "approved" | "locked";
  documentSha256: string;
  objectKey: string;
  contentType: "application/pdf";
  sizeBytes: number;
  sha256: string;
};

export type PhotobookProofAsset = {
  id: string;
  objectKey: string;
  sizeBytes: number;
  sha256: string;
  contentType: "image/jpeg" | "image/png" | "image/webp" | "image/avif";
  widthPixels: number;
  heightPixels: number;
};

export type PhotobookRenderJob = {
  workerId: string;
  eventId: string;
  revisionId: string;
  pdfAssetId: string;
  pdfObjectKey: string;
  document: PhotobookDocument;
  assets: PhotobookProofAsset[];
  attemptCount: number;
};

export type FinalizePhotobookProofCommand = {
  job: PhotobookRenderJob;
  pdfSha256: string;
  pdfSizeBytes: number;
  pageCount: number;
  assetSetSha256: string;
  fontSetSha256: string;
  renderEngine: string;
  renderVersion: string;
};

export interface PhotobookRepository {
  loadSource(actorId: string, projectId: string): Promise<PhotobookSource | null>;
  saveSettings(command: SavePhotobookSettingsCommand): Promise<void>;
  replaceExclusions(
    actorId: string,
    projectId: string,
    exclusions: readonly PhotobookExclusion[],
  ): Promise<void>;
  saveDraft(command: SavePhotobookDraftCommand): Promise<{ draftId: string; version: number }>;
  latestProof(actorId: string, projectId: string): Promise<PhotobookProofSummary | null>;
  requestProof(command: RequestPhotobookProofCommand): Promise<PhotobookProofMutation>;
  approveProof(command: ApprovePhotobookProofCommand): Promise<PhotobookProofMutation>;
  resolveProofObject(actorId: string, revisionId: string): Promise<PhotobookProofObject | null>;
  claimRenderJob(workerId: string, leaseSeconds: number): Promise<PhotobookRenderJob | null>;
  finalizeProof(command: FinalizePhotobookProofCommand): Promise<void>;
  failProof(
    job: PhotobookRenderJob,
    failureCode: string,
    retry: { delaySeconds: number } | null,
  ): Promise<void>;
}

export type PhotobookWorkerRepository = Pick<
  PhotobookRepository,
  "claimRenderJob" | "finalizeProof" | "failProof"
>;

export type PhotobookIdFactory = () => string;
export type PhotobookClock = () => Date;
export type PhotobookPreferencesInput = PhotobookPreferences;
