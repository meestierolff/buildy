import { createBookOrderInputSchema, updateBookOrderInputSchema, type AdminBookOrder, type BookOrder } from "../../shared/contracts/bookOrders.js";
import type { BookOrderRepository, StoredBookOrder } from "./repository.js";
import type { PhotobookService } from "../photobooks/service.js";
import type { DataProtectionKeyring, PrivacyBlindIndex } from "../security/dataProtection.js";
import { canonicalJson } from "../security/canonicalJson.js";
import { HttpError } from "../http/errors.js";
import { ModerationAdminError } from "../moderation/adminErrors.js";
import type { ModerationAdminActor } from "../moderation/adminActor.js";
import { PhotobookRenderError, renderPhotobookPdf } from "../photobooks/pdfRenderer.js";
import { loadPhotobookFontBytes } from "../photobooks/typography.js";
import type { ObjectStorage } from "../storage/objectStorage.js";

function summary(order: StoredBookOrder): BookOrder {
  const { document: _document, cursorTime: _cursor, ownerId: _owner, deliveryCiphertext: _delivery, requestHash: _hash, ...publicOrder } = order;
  return publicOrder;
}
function assertAdmin(actor: ModerationAdminActor) {
  if (actor.role !== "admin") throw new ModerationAdminError("FORBIDDEN");
}
export class BookOrderService {
  constructor(private readonly repository: BookOrderRepository,
    private readonly photobooks: Pick<PhotobookService, "editor">,
    private readonly keyring: DataProtectionKeyring,
    private readonly blindIndex: PrivacyBlindIndex,
    private readonly storage: ObjectStorage) {}
  async list(actorId: string, projectId: string) {
    return { items: (await this.repository.list(actorId, projectId)).map(summary) };
  }
  async create(actorId: string, projectId: string, raw: unknown) {
    const input = createBookOrderInputSchema.parse(raw);
    const key = this.blindIndex.create("book-order-key", `${actorId}\0${input.idempotencyKey}`);
    const requestHash = this.blindIndex.create("book-order-payload", canonicalJson({ projectId,
      checksum: input.expectedDocumentSha256, quantity: input.quantity, deliveryDetails: input.deliveryDetails }));
    const replay = await this.repository.replay(actorId, key);
    if (replay) {
      if (replay.requestHash !== requestHash) throw new HttpError(409, "CONFLICT", "Deze aanvraag-ID is al gebruikt voor een andere bestelling.");
      return { order: summary(replay), replayed: true };
    }
    const draft = await this.photobooks.editor(actorId, projectId);
    if (draft.version !== input.expectedDraftVersion || draft.document.checksumSha256 !== input.expectedDocumentSha256) {
      throw new HttpError(409, "CONFLICT", "Je boek is gewijzigd. Controleer het nieuwe voorbeeld voordat je bestelt.");
    }
    if (!draft.document.pages.some(page => page.updateId) || draft.document.warnings.some(warning => warning.severity === "blocking")) {
      throw new HttpError(422, "VALIDATION_FAILED", "Voeg een Bouwmoment toe en los de boekwaarschuwingen op.");
    }
    const id = crypto.randomUUID();
    const result = await this.repository.create({ id, actorId, projectId, expectedVersion: draft.version,
      checksum: draft.document.checksumSha256, quantity: input.quantity, key, requestHash,
      deliveryCiphertext: this.keyring.encrypt(input.deliveryDetails, `book-request:${id}:delivery`) });
    return { order: summary(result.order), replayed: result.replayed };
  }
  async queue(actor: ModerationAdminActor, cursor?: string) {
    assertAdmin(actor);
    const records = await this.repository.list(actor.appUserId, null, cursor);
    const items: AdminBookOrder[] = records.slice(0, 50).map(order => ({ ...summary(order),
      deliveryDetails: this.keyring.decrypt(order.deliveryCiphertext, `book-request:${order.id}:delivery`) }));
    return { items, nextCursor: records.length > 50 ? `${records[49]!.cursorTime ?? records[49]!.createdAt}|${records[49]!.id}` : null };
  }
  async update(actor: ModerationAdminActor, id: string, raw: unknown) {
    assertAdmin(actor);
    return { order: summary(await this.repository.update(actor.appUserId, id, updateBookOrderInputSchema.parse(raw))), replayed: false };
  }
  async pdf(actor: ModerationAdminActor, id: string, requestId: string) {
    assertAdmin(actor);
    const order = await this.repository.find(actor.appUserId, id);
    if (!order || order.status === "cancelled") throw new HttpError(404, "NOT_FOUND", "Deze boekaanvraag is niet beschikbaar.");
    const records = await this.repository.assets(actor.appUserId, id, requestId);
    try {
      return await renderPhotobookPdf({ document: order.document, fonts: await loadPhotobookFontBytes(), assets: {
        readOriginal: async source => {
          const asset = records.find(record => record.id === source.id);
          if (!asset) throw new PhotobookRenderError("ASSET_MISSING", "Een bronfoto is niet meer beschikbaar.");
          return this.storage.readObject(asset.objectKey, asset.sizeBytes);
        },
      } });
    } catch (error) {
      if (error instanceof PhotobookRenderError) throw new HttpError(409, "CONFLICT", "De PDF kon niet worden gemaakt. Controleer of de originele foto's nog beschikbaar zijn en het boek geen blokkerende waarschuwingen bevat.");
      throw error;
    }
  }
}
