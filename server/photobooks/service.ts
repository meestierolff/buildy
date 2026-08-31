import { createHash } from "node:crypto";
import {
  approvePhotobookProofInputSchema,
  replacePhotobookExclusionsInputSchema,
  requestPhotobookProofInputSchema,
  updatePhotobookSettingsInputSchema,
  type PhotobookDocument,
} from "../../shared/contracts/photobooks.js";
import { buildPhotobookDocument, type PhotobookTextMeasurer } from "./document.js";
import { PhotobookError } from "./errors.js";
import {
  expectedPhotobookPdfObjectKey,
  photobookProofRequestHash,
} from "./repository.js";
import {
  PdfKitPhotobookTypography,
  loadPhotobookFontBytes,
} from "./typography.js";
import type { PrivacyBlindIndex } from "../security/dataProtection.js";
import type {
  PhotobookClock,
  PhotobookEditorState,
  PhotobookIdFactory,
  PhotobookProofMutation,
  PhotobookProofObject,
  PhotobookProofProcessingResult,
  PhotobookProofProcessor,
  PhotobookRepository,
  PhotobookSource,
} from "./types.js";

let typographyPromise: Promise<PdfKitPhotobookTypography> | undefined;

function resolveTypography(): Promise<PdfKitPhotobookTypography> {
  typographyPromise ??= loadPhotobookFontBytes().then(
    (fonts) => new PdfKitPhotobookTypography(fonts),
  );
  return typographyPromise;
}

function scopedIdempotencyKey(
  operation: "request" | "approve",
  actorId: string,
  clientKey: string,
): string {
  return createHash("sha256")
    .update(`photobook.proof.${operation}:v1\0`)
    .update(actorId)
    .update("\0")
    .update(clientKey)
    .digest("hex");
}

function approvalRequestHash(input: {
  blindIndex: PrivacyBlindIndex;
  revisionId: string;
  documentSha256: string;
  pdfSha256: string;
}): string {
  const canonicalDigest = createHash("sha256")
    .update("buildy-photobook-proof-approval-payload:v2\0")
    .update(input.revisionId)
    .update("\0")
    .update(input.documentSha256)
    .update("\0")
    .update(input.pdfSha256)
    .update("\0")
    .update("true")
    .digest("hex");
  return input.blindIndex.create("photobook-proof-approval-v2", canonicalDigest);
}

function exclusionSets(source: PhotobookSource) {
  return {
    excludedUpdateIds: new Set(source.exclusions.flatMap(
      (item) => item.targetType === "update" ? [item.updateId] : [],
    )),
    excludedMediaAssetIds: new Set(source.exclusions.flatMap(
      (item) => item.targetType === "media" ? [item.mediaAssetId] : [],
    )),
    excludedChapterKeys: new Set(source.exclusions.flatMap(
      (item) => item.targetType === "chapter" ? [item.chapterKey] : [],
    )),
  };
}

export class PhotobookService {
  constructor(
    private readonly repository: PhotobookRepository,
    private readonly bucket: string,
    private readonly blindIndex: PrivacyBlindIndex,
    private readonly clock: PhotobookClock = () => new Date(),
    private readonly createId: PhotobookIdFactory = () => crypto.randomUUID(),
    private readonly typography: () => Promise<PhotobookTextMeasurer> = resolveTypography,
    private readonly proofProcessor?: PhotobookProofProcessor,
    private readonly proofRequestsEnabled = true,
  ) {}

  private async buildDocument(source: PhotobookSource): Promise<PhotobookDocument> {
    const preferences = source.settings.preferences;
    return buildPhotobookDocument({
      projectId: source.projectId,
      projectRevision: source.projectRevision,
      projectTitle: source.settings.title ?? source.projectTitle,
      projectSubtitle: source.settings.subtitle ?? source.projectSubtitle,
      coverMediaAssetId: source.settings.coverMediaAssetId,
      coverCrop: preferences.coverCrop,
      updates: source.updates,
      ...exclusionSets(source),
      photoOrderByUpdate: preferences.photoOrderByUpdate,
      layoutByPage: preferences.layoutByPage,
      cropByAsset: preferences.cropByAsset,
      maximumPages: 400,
      measurer: await this.typography(),
    });
  }

  private async processExactRevision(
    revisionId: string,
  ): Promise<PhotobookProofProcessingResult | null> {
    if (!this.proofProcessor) return null;
    const result = await this.proofProcessor.processRevision(revisionId);
    if (result.status !== "idle" && result.revisionId !== revisionId) {
      throw new PhotobookError("INVALID_STATE");
    }
    return result;
  }

  private async buildEditorState(
    actorId: string,
    projectId: string,
    retryRenderingProof: boolean,
  ): Promise<PhotobookEditorState> {
    const source = await this.repository.loadSource(actorId, projectId);
    if (!source) throw new PhotobookError("PHOTOBOOK_NOT_FOUND");
    const document = await this.buildDocument(source);
    const saved = await this.repository.saveDraft({
      actorId,
      draftId: source.draftId ?? this.createId(),
      projectId,
      projectRevision: source.projectRevision,
      document,
    });
    let proof = await this.repository.latestProof(actorId, projectId);
    if (retryRenderingProof && proof?.status === "rendering") {
      await this.processExactRevision(proof.revisionId);
      proof = await this.repository.latestProof(actorId, projectId);
    }
    const exposesPdf = proof && ["ready", "approved", "locked"].includes(proof.status);
    return {
      draftId: saved.draftId,
      version: saved.version,
      settings: source.settings,
      exclusions: source.exclusions,
      document,
      proof: proof ? {
        revisionId: proof.revisionId,
        status: proof.status,
        documentSha256: proof.documentSha256,
        pdfSha256: proof.pdfSha256,
        pageCount: proof.pageCount,
        pdfPath: exposesPdf ? `/api/photobooks/proofs/${proof.revisionId}/pdf` : null,
        thumbnailPaths: [],
      } : null,
    };
  }

  async editor(actorId: string, projectId: string): Promise<PhotobookEditorState> {
    return this.buildEditorState(actorId, projectId, true);
  }

  async updateSettings(
    actorId: string,
    projectId: string,
    rawInput: unknown,
  ): Promise<PhotobookEditorState> {
    const settings = updatePhotobookSettingsInputSchema.parse(rawInput);
    await this.repository.saveSettings({ actorId, projectId, settings });
    return this.editor(actorId, projectId);
  }

  async replaceExclusions(
    actorId: string,
    projectId: string,
    rawInput: unknown,
  ): Promise<PhotobookEditorState> {
    const input = replacePhotobookExclusionsInputSchema.parse(rawInput);
    await this.repository.replaceExclusions(actorId, projectId, input.exclusions);
    return this.editor(actorId, projectId);
  }

  async requestProof(
    actorId: string,
    projectId: string,
    rawInput: unknown,
  ): Promise<PhotobookProofMutation> {
    if (!this.proofRequestsEnabled) throw new PhotobookError("PROOF_UNAVAILABLE");
    const input = requestPhotobookProofInputSchema.parse(rawInput);
    const editor = await this.buildEditorState(actorId, projectId, false);
    if (
      editor.version !== input.expectedDraftVersion
      || editor.document.checksumSha256 !== input.expectedDocumentSha256
    ) throw new PhotobookError("STALE_DRAFT");
    if (editor.document.warnings.some((warning) => warning.severity === "blocking")) {
      throw new PhotobookError("PROOF_BLOCKED");
    }
    const revisionId = this.createId();
    const pdfAssetId = this.createId();
    const mutation = await this.repository.requestProof({
      actorId,
      projectId,
      draftId: editor.draftId,
      expectedDraftVersion: editor.version,
      document: editor.document,
      revisionId,
      pdfAssetId,
      pdfObjectKey: expectedPhotobookPdfObjectKey(pdfAssetId),
      bucket: this.bucket,
      idempotencyKey: scopedIdempotencyKey("request", actorId, input.idempotencyKey),
      requestHash: photobookProofRequestHash(this.blindIndex, editor.document),
      requestHashVersion: 2,
    });
    if (mutation.status !== "rendering") return mutation;
    const processed = await this.processExactRevision(mutation.revisionId);
    if (processed?.status === "rendered") return { ...mutation, status: "ready" };
    if (processed?.status === "failed") return { ...mutation, status: "failed" };
    return mutation;
  }

  async approveProof(
    actorId: string,
    revisionId: string,
    rawInput: unknown,
  ): Promise<PhotobookProofMutation> {
    const input = approvePhotobookProofInputSchema.parse(rawInput);
    return this.repository.approveProof({
      actorId,
      revisionId,
      documentSha256: input.documentSha256,
      pdfSha256: input.pdfSha256,
      proofViewed: input.proofViewed,
      idempotencyKey: scopedIdempotencyKey("approve", actorId, input.idempotencyKey),
      requestHash: approvalRequestHash({
        blindIndex: this.blindIndex,
        revisionId,
        documentSha256: input.documentSha256,
        pdfSha256: input.pdfSha256,
      }),
      requestHashVersion: 2,
      approvedAt: this.clock(),
    });
  }

  async proofObject(actorId: string, revisionId: string): Promise<PhotobookProofObject> {
    const object = await this.repository.resolveProofObject(actorId, revisionId);
    if (!object) throw new PhotobookError("PHOTOBOOK_NOT_FOUND");
    return object;
  }

}

export function resetPhotobookTypographyForTests(): void {
  typographyPromise = undefined;
}
