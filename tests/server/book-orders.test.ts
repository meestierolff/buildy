// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { BookOrderService } from "../../server/bookOrders/service";
import { createBookOrderHttpHandler } from "../../server/bookOrders/http";
import type { BookOrderRepository, StoredBookOrder } from "../../server/bookOrders/repository";
import { buildPhotobookDocument } from "../../server/photobooks/document";
import { DataProtectionKeyring, PrivacyBlindIndex } from "../../server/security/dataProtection";
import { decryptAccountExportPayload } from "../../server/account/worker";
import type { ObjectStorage } from "../../server/storage/objectStorage";
import type { PhotobookEditorState } from "../../server/photobooks/types";
import { photobookPreferencesSchema } from "../../shared/contracts/photobooks";
const OWNER = "10000000-0000-4000-8000-000000000001";
const ADMIN = "10000000-0000-4000-8000-000000000002";
const PROJECT = "20000000-0000-4000-8000-000000000001";
const ORDER = "30000000-0000-4000-8000-000000000001";
const REQUEST = "40000000-0000-4000-8000-000000000001";
const keyring = new DataProtectionKeyring({ currentVersion: 1, keys: { 1: Buffer.alloc(32, 3).toString("base64") } });
const blindIndex = new PrivacyBlindIndex(Buffer.alloc(32, 7).toString("base64"));
function fixture() {
  const document = buildPhotobookDocument({ projectId: PROJECT, projectRevision: 1, projectTitle: "Testboek", projectSubtitle: "", maximumPages: 400,
    updates: [{ id: "50000000-0000-4000-8000-000000000001", updateDate: "2026-10-01", title: "Testmoment", description: "Een testverhaal", room: null, phaseId: null, phaseName: null, sortOrder: 0, media: [] }],
    measurer: { wrap: ({ text }) => text ? [text] : [] } });
  const order: StoredBookOrder = { id: ORDER, projectId: PROJECT, ownerId: OWNER, document, documentSha256: document.checksumSha256,
    title: "Testboek", pageCount: document.pageCount, quantity: 1, status: "requested", reply: "", version: 1,
    createdAt: "2026-10-03T10:00:00.000Z", updatedAt: "2026-10-03T10:00:00.000Z", requestHash: "", deliveryCiphertext: keyring.encrypt("Synthetic delivery details", `book-request:${ORDER}:delivery`) };
  const repository = { list: vi.fn().mockResolvedValue([order]), find: vi.fn().mockResolvedValue(order), replay: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation(async input => ({ order: { ...order, id: input.id, requestHash: input.requestHash, deliveryCiphertext: input.deliveryCiphertext }, replayed: false })),
    update: vi.fn().mockResolvedValue(order), assets: vi.fn().mockResolvedValue([]) } satisfies BookOrderRepository;
  const draft: PhotobookEditorState = { draftId: ORDER, version: 1, document, exclusions: [], proof: null,
    settings: { selectedFormat: document.selectedFormat, version: 1, coverMediaAssetId: null, title: null, subtitle: null, includeBudget: false, preferences: photobookPreferencesSchema.parse({}) } };
  const photobooks = { editor: vi.fn().mockResolvedValue(draft) };
  const storage = { readObject: vi.fn() } as unknown as ObjectStorage;
  const service = new BookOrderService(repository, photobooks, keyring, blindIndex, storage);
  const input = { idempotencyKey: REQUEST, expectedDraftVersion: 1, expectedDocumentSha256: document.checksumSha256, quantity: 1, deliveryDetails: "Synthetic delivery details" };
  return { order, repository, draft, photobooks, service, input };
}
const admin = { appUserId: ADMIN, role: "admin" as const, grantExpiresAt: null };
describe("manual book requests", () => {
  it("freezes the canonical version, encrypts delivery details and returns only safe summary fields", async () => {
    const f = fixture(); const result = await f.service.create(OWNER, PROJECT, f.input);
    const command = f.repository.create.mock.calls[0]![0];
    expect(command.checksum).toBe(f.draft.document.checksumSha256);
    expect(command.deliveryCiphertext).not.toContain(f.input.deliveryDetails);
    expect(keyring.decrypt(command.deliveryCiphertext, `book-request:${command.id}:delivery`)).toBe(f.input.deliveryDetails);
    expect(result.order).not.toHaveProperty("deliveryCiphertext"); expect(result.order).not.toHaveProperty("document");
  });
  it("replays a received request after the editable book has changed, without a duplicate", async () => {
    const f = fixture(); await f.service.create(OWNER, PROJECT, f.input);
    const command = f.repository.create.mock.calls[0]![0];
    f.repository.replay.mockResolvedValue({ ...f.order, requestHash: command.requestHash }); f.photobooks.editor.mockClear();
    const result = await f.service.create(OWNER, PROJECT, f.input);
    expect(result.replayed).toBe(true); expect(f.repository.create).toHaveBeenCalledTimes(1); expect(f.photobooks.editor).not.toHaveBeenCalled();
    await expect(f.service.create(OWNER, PROJECT, { ...f.input, quantity: 2 })).rejects.toMatchObject({ status: 409 });
  });
  it("rejects stale book content and blocking warnings before persistence", async () => {
    const f = fixture();
    await expect(f.service.create(OWNER, PROJECT, { ...f.input, expectedDraftVersion: 2 })).rejects.toMatchObject({ status: 409 });
    f.draft.document.warnings = [{ code: "TEXT_OVERFLOW", severity: "blocking", message: "Test", pageNumber: null, assetId: null, updateId: null }];
    await expect(f.service.create(OWNER, PROJECT, f.input)).rejects.toMatchObject({ status: 422 });
    expect(f.repository.create).not.toHaveBeenCalled();
  });
  it("denies moderators access to addresses, status mutation and PDF source assets", async () => {
    const f = fixture(); const moderator = { ...admin, role: "moderator" as const };
    await expect(f.service.queue(moderator)).rejects.toMatchObject({ status: 403 });
    await expect(f.service.pdf(moderator, ORDER, REQUEST)).rejects.toMatchObject({ status: 403 });
    await expect(f.service.update(moderator, ORDER, {})).rejects.toMatchObject({ status: 403 });
    expect(f.repository.assets).not.toHaveBeenCalled(); expect(f.repository.list).not.toHaveBeenCalled();
  });
  it("renders the frozen order document, independent from the later editable book", async () => {
    const f = fixture(); f.photobooks.editor.mockRejectedValue(new Error("Should not read current draft"));
    const proof = await f.service.pdf(admin, ORDER, REQUEST);
    expect(proof.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(proof.documentSha256).toBe(f.order.documentSha256); expect(proof.pageCount).toBe(f.order.pageCount);
    expect(f.repository.assets).toHaveBeenCalledWith(ADMIN, ORDER, REQUEST); expect(f.photobooks.editor).not.toHaveBeenCalled();
  });
  it("decrypts delivery details in the owner's account export", () => {
    const f = fixture();
    const result = decryptAccountExportPayload({ projectPrivateDetails: [], photobookOrders: [], bookRequests: [{ id: ORDER, delivery_ciphertext: f.order.deliveryCiphertext }] }, keyring) as { bookRequests: Record<string, unknown>[] };
    expect(result.bookRequests[0]).toEqual({ id: ORDER, delivery_details: f.input.deliveryDetails });
  });
  it("uses the admin resolver before serving a streamed PDF and omits buffered response size", async () => {
    const f = fixture(); const admins = { resolve: vi.fn().mockResolvedValue(admin) };
    const handler = createBookOrderHttpHandler({ service: f.service, admins, actors: { resolve: async () => ({ kind: "authenticated", appUserId: OWNER }) } });
    const response = await handler(new Request(`https://buildy.test/api/admin/book-orders/${ORDER}/pdf`, { method: "POST" }), REQUEST, { orderId: ORDER });
    expect(admins.resolve).toHaveBeenCalledOnce(); expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("cache-control")).toContain("no-store"); expect(response.headers.get("x-buildy-document-sha256")).toBe(f.order.documentSha256);
    expect(new TextDecoder().decode((await response.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
  });
});
