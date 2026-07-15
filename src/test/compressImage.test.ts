import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  MAX_VIDEO_BYTES,
  prepareUpload,
} from "@/lib/compressImage";

const fileWithSize = (name: string, type: string, size: number) =>
  ({ name, type, size } as File);

describe("prepareUpload", () => {
  it("keeps a small supported photo unchanged", async () => {
    const file = new File(["photo"], "keuken.jpg", { type: "image/jpeg" });
    await expect(prepareUpload(file)).resolves.toBe(file);
  });

  it("rejects phone photo formats the browser cannot reliably print", async () => {
    const file = new File(["photo"], "keuken.heic", { type: "image/heic" });
    await expect(prepareUpload(file)).rejects.toThrow(/niet-ondersteund fotoformaat/i);
  });

  it.each([
    ["foto.jpg", "image/jpeg", MAX_IMAGE_BYTES + 1, /foto is te groot/i],
    ["video.mp4", "video/mp4", MAX_VIDEO_BYTES + 1, /video is te groot/i],
    ["offerte.pdf", "application/pdf", MAX_PDF_BYTES + 1, /pdf is te groot/i],
  ])("rejects an oversized %s", async (name, type, size, message) => {
    await expect(prepareUpload(fileWithSize(name, type, size))).rejects.toThrow(message);
  });

  it("rejects unrelated file types", async () => {
    const file = new File(["hello"], "notities.txt", { type: "text/plain" });
    await expect(prepareUpload(file)).rejects.toThrow(/niet-ondersteund bestandstype/i);
  });
});
