// @vitest-environment node

import { describe, expect, it } from "vitest";
import { photobookPreferencesSchema } from "../../shared/contracts/photobooks";
import { PhotobookError } from "../../server/photobooks/errors";
import { PhotobookService } from "../../server/photobooks/service";
import { PrivacyBlindIndex } from "../../server/security/dataProtection";
import type {
  ApprovePhotobookProofCommand,
  FinalizePhotobookProofCommand,
  PhotobookProofMutation,
  PhotobookProofProcessor,
  PhotobookProofSummary,
  PhotobookRenderJob,
  PhotobookRepository,
  PhotobookSource,
  RequestPhotobookProofCommand,
  SavePhotobookDraftCommand,
  SavePhotobookSettingsCommand,
} from "../../server/photobooks/types";

const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const PROJECT_ID = "20000000-0000-4000-8000-000000000001";
const DRAFT_ID = "30000000-0000-4000-8000-000000000001";
const REVISION_ID = "40000000-0000-4000-8000-000000000001";
const PDF_ASSET_ID = "50000000-0000-4000-8000-000000000001";
const blindIndex = new PrivacyBlindIndex(Buffer.alloc(32, 7).toString("base64"));

function source(overrides: Partial<PhotobookSource> = {}): PhotobookSource {
  return {
    projectId: PROJECT_ID,
    ownerId: ACTOR_ID,
    projectRevision: 3,
    projectTitle: "Ons huis",
    projectSubtitle: "Van casco naar thuis",
    settings: {
      coverMediaAssetId: null,
      selectedFormat: "a4-landscape-hardcover-v1",
      title: null,
      subtitle: null,
      includeBudget: false,
      preferences: photobookPreferencesSchema.parse({}),
      version: 1,
    },
    exclusions: [],
    draftId: DRAFT_ID,
    draftVersion: 4,
    updates: [],
    ...overrides,
  };
}

class MemoryPhotobookRepository implements PhotobookRepository {
  savedDraft: SavePhotobookDraftCommand | null = null;
  requested: RequestPhotobookProofCommand | null = null;
  approved: ApprovePhotobookProofCommand | null = null;
  currentProof: PhotobookProofSummary | null = null;

  constructor(public currentSource: PhotobookSource = source()) {}

  async loadSource(actorId: string, projectId: string) {
    return actorId === ACTOR_ID && projectId === PROJECT_ID ? this.currentSource : null;
  }

  async saveSettings(command: SavePhotobookSettingsCommand): Promise<void> {
    this.currentSource = { ...this.currentSource, settings: command.settings };
  }

  async replaceExclusions(_actorId: string, _projectId: string, exclusions: PhotobookSource["exclusions"]): Promise<void> {
    this.currentSource = { ...this.currentSource, exclusions: [...exclusions] };
  }

  async saveDraft(command: SavePhotobookDraftCommand) {
    this.savedDraft = command;
    return { draftId: command.draftId, version: 4 };
  }

  async latestProof() {
    return this.currentProof;
  }

  async requestProof(command: RequestPhotobookProofCommand): Promise<PhotobookProofMutation> {
    this.requested = command;
    return { revisionId: command.revisionId, status: "rendering", replayed: false };
  }

  async approveProof(command: ApprovePhotobookProofCommand): Promise<PhotobookProofMutation> {
    this.approved = command;
    return { revisionId: command.revisionId, status: "approved", replayed: false };
  }

  async resolveProofObject() { return null; }
  async claimRenderJob(): Promise<PhotobookRenderJob | null> { return null; }
  async claimRenderJobForRevision(): Promise<PhotobookRenderJob | null> { return null; }
  async finalizeProof(_command: FinalizePhotobookProofCommand): Promise<void> {}
  async failProof(_job: PhotobookRenderJob, _code: string, _retry: { delaySeconds: number } | null): Promise<void> {}
}

const measurer = {
  wrap: ({ text }: { text: string }) => text.trim() ? [text.trim()] : [],
};

describe("PhotobookService", () => {
  it("builds and saves one canonical owner draft with the launch SKU", async () => {
    const repository = new MemoryPhotobookRepository();
    const service = new PhotobookService(repository, "buildy-private", blindIndex, undefined, undefined, async () => measurer);

    const editor = await service.editor(ACTOR_ID, PROJECT_ID);

    expect(editor).toMatchObject({ draftId: DRAFT_ID, version: 4, proof: null });
    expect(editor.document).toMatchObject({
      projectId: PROJECT_ID,
      projectRevision: 3,
      selectedFormat: "a4-landscape-hardcover-v1",
      pageCount: 24,
    });
    expect(repository.savedDraft?.document.checksumSha256).toBe(editor.document.checksumSha256);
  });

  it("binds a proof request to the exact draft hash, private PDF key and scoped idempotency key", async () => {
    const repository = new MemoryPhotobookRepository();
    const ids = [REVISION_ID, PDF_ASSET_ID];
    const service = new PhotobookService(
      repository,
      "buildy-private",
      blindIndex,
      undefined,
      () => ids.shift() ?? crypto.randomUUID(),
      async () => measurer,
    );
    const editor = await service.editor(ACTOR_ID, PROJECT_ID);

    const result = await service.requestProof(ACTOR_ID, PROJECT_ID, {
      idempotencyKey: "60000000-0000-4000-8000-000000000001",
      expectedDraftVersion: editor.version,
      expectedDocumentSha256: editor.document.checksumSha256,
    });

    expect(result).toEqual({ revisionId: REVISION_ID, status: "rendering", replayed: false });
    expect(repository.requested).toMatchObject({
      revisionId: REVISION_ID,
      pdfAssetId: PDF_ASSET_ID,
      bucket: "buildy-private",
      pdfObjectKey: `photobook-pdfs/${PDF_ASSET_ID.slice(0, 2)}/${PDF_ASSET_ID}`,
    });
    expect(repository.requested?.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    expect(repository.requested?.requestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("processes the newly requested exact revision before returning a ready result", async () => {
    const repository = new MemoryPhotobookRepository();
    const ids = [REVISION_ID, PDF_ASSET_ID];
    const processed: string[] = [];
    const processor: PhotobookProofProcessor = {
      async processRevision(revisionId) {
        processed.push(revisionId);
        return {
          status: "rendered",
          revisionId,
          pageCount: 24,
          pdfSha256: "f".repeat(64),
        };
      },
    };
    const service = new PhotobookService(
      repository,
      "buildy-private",
      blindIndex,
      undefined,
      () => ids.shift() ?? crypto.randomUUID(),
      async () => measurer,
      processor,
    );
    const editor = await service.editor(ACTOR_ID, PROJECT_ID);

    const result = await service.requestProof(ACTOR_ID, PROJECT_ID, {
      idempotencyKey: "60000000-0000-4000-8000-000000000011",
      expectedDraftVersion: editor.version,
      expectedDocumentSha256: editor.document.checksumSha256,
    });

    expect(processed).toEqual([REVISION_ID]);
    expect(result).toEqual({ revisionId: REVISION_ID, status: "ready", replayed: false });
  });

  it("lets an owner editor poll retry only its exact rendering revision", async () => {
    const repository = new MemoryPhotobookRepository();
    repository.currentProof = {
      revisionId: REVISION_ID,
      status: "rendering",
      documentSha256: "a".repeat(64),
      pdfSha256: null,
      pageCount: null,
    };
    const processed: string[] = [];
    const processor: PhotobookProofProcessor = {
      async processRevision(revisionId) {
        processed.push(revisionId);
        repository.currentProof = {
          revisionId,
          status: "ready",
          documentSha256: "a".repeat(64),
          pdfSha256: "b".repeat(64),
          pageCount: 24,
        };
        return {
          status: "rendered",
          revisionId,
          pageCount: 24,
          pdfSha256: "b".repeat(64),
        };
      },
    };
    const service = new PhotobookService(
      repository,
      "buildy-private",
      blindIndex,
      undefined,
      undefined,
      async () => measurer,
      processor,
    );

    const editor = await service.editor(ACTOR_ID, PROJECT_ID);

    expect(processed).toEqual([REVISION_ID]);
    expect(editor.proof).toMatchObject({
      revisionId: REVISION_ID,
      status: "ready",
      pdfPath: `/api/photobooks/proofs/${REVISION_ID}/pdf`,
    });
  });

  it("rejects a stale browser snapshot before enqueueing expensive work", async () => {
    const repository = new MemoryPhotobookRepository();
    const service = new PhotobookService(repository, "buildy-private", blindIndex, undefined, undefined, async () => measurer);
    const editor = await service.editor(ACTOR_ID, PROJECT_ID);

    await expect(service.requestProof(ACTOR_ID, PROJECT_ID, {
      idempotencyKey: "60000000-0000-4000-8000-000000000002",
      expectedDraftVersion: editor.version + 1,
      expectedDocumentSha256: editor.document.checksumSha256,
    })).rejects.toMatchObject({ reason: "STALE_DRAFT" });
    expect(repository.requested).toBeNull();
  });

  it("approves only the explicitly hashed revision and never trusts a redirect", async () => {
    const repository = new MemoryPhotobookRepository();
    const service = new PhotobookService(
      repository,
      "buildy-private",
      blindIndex,
      () => new Date("2026-08-04T12:00:00Z"),
    );
    const result = await service.approveProof(ACTOR_ID, REVISION_ID, {
      idempotencyKey: "60000000-0000-4000-8000-000000000003",
      documentSha256: "a".repeat(64),
      pdfSha256: "b".repeat(64),
      proofViewed: true,
    });

    expect(result.status).toBe("approved");
    expect(repository.approved).toMatchObject({
      actorId: ACTOR_ID,
      revisionId: REVISION_ID,
      documentSha256: "a".repeat(64),
      pdfSha256: "b".repeat(64),
      proofViewed: true,
      approvedAt: new Date("2026-08-04T12:00:00Z"),
    });
  });

  it("fails closed for an inaccessible project", async () => {
    const processed: string[] = [];
    const service = new PhotobookService(
      new MemoryPhotobookRepository(),
      "buildy-private",
      blindIndex,
      undefined,
      undefined,
      undefined,
      { async processRevision(revisionId) { processed.push(revisionId); return { status: "idle" }; } },
    );
    await expect(service.editor(ACTOR_ID, "20000000-0000-4000-8000-000000000099"))
      .rejects.toBeInstanceOf(PhotobookError);
    expect(processed).toEqual([]);
  });
});
