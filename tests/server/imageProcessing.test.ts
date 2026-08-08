// @vitest-environment node

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  ImageProcessingError,
  detectImageContentType,
  processProjectImage,
} from "../../server/media/imageProcessing";

describe("privacy-safe image processing", () => {
  it("detects supported formats from magic bytes instead of filenames", async () => {
    const jpeg = await sharp({
      create: { width: 4, height: 3, channels: 3, background: "#a54f35" },
    }).jpeg().toBuffer();
    const png = await sharp({
      create: { width: 4, height: 3, channels: 4, background: "#faf7f0" },
    }).png().toBuffer();

    expect(detectImageContentType(jpeg)).toBe("image/jpeg");
    expect(detectImageContentType(png)).toBe("image/png");
    expect(() => detectImageContentType(Buffer.from("not-an-image"))).toThrow(ImageProcessingError);
  });

  it("applies orientation, strips EXIF and creates bounded display derivatives", async () => {
    const source = await sharp({
      create: { width: 20, height: 10, channels: 3, background: "#a54f35" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const result = await processProjectImage(source, "image/jpeg");
    const originalMetadata = await sharp(result.original.bytes).metadata();

    expect(result.detectedContentType).toBe("image/jpeg");
    expect(result.exifStripped).toBe(true);
    expect(result.original.widthPixels).toBe(10);
    expect(result.original.heightPixels).toBe(20);
    expect(originalMetadata.orientation).toBeUndefined();
    expect(originalMetadata.exif).toBeUndefined();
    expect(result.display.small.contentType).toBe("image/webp");
    expect(result.display.large.sha256Hex).toMatch(/^[0-9a-f]{64}$/);
    expect(result.display.large.sha256Base64).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });

  it("keeps print-worthy pixel dimensions in the sanitized original", async () => {
    const source = await sharp({
      create: {
        width: 4_000,
        height: 3_000,
        channels: 3,
        background: { r: 120, g: 80, b: 40 },
      },
    }).jpeg({ quality: 90 }).toBuffer();

    const result = await processProjectImage(source, "image/jpeg");

    expect(result.original).toMatchObject({
      widthPixels: 4_000,
      heightPixels: 3_000,
    });
    expect(result.display.large).toMatchObject({
      widthPixels: 2_400,
      heightPixels: 1_800,
    });
  });

  it("rejects MIME spoofing and corrupt image payloads", async () => {
    const png = await sharp({
      create: { width: 4, height: 3, channels: 4, background: "#faf7f0" },
    }).png().toBuffer();

    await expect(processProjectImage(png, "image/jpeg")).rejects.toMatchObject({
      code: "MIME_MISMATCH",
    });
    await expect(
      processProjectImage(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]), "image/jpeg"),
    ).rejects.toMatchObject({ code: "DECODE_FAILED" });
  });
});
