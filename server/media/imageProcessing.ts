import { createHash } from "node:crypto";
import sharp, { type Sharp } from "sharp";

const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_INPUT_PIXELS = 100_000_000;
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;

export type DetectedImageType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/avif"
  | "image/heic"
  | "image/heif";

export class ImageProcessingError extends Error {
  constructor(
    public readonly code:
      | "INVALID_SIZE"
      | "UNSUPPORTED_TYPE"
      | "MIME_MISMATCH"
      | "DECODE_FAILED"
      | "DIMENSIONS_EXCEEDED"
      | "ANIMATED_IMAGE"
      | "OUTPUT_TOO_LARGE",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ImageProcessingError";
  }
}

export interface ProcessedImageVariant {
  bytes: Buffer;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  heightPixels: number;
  sha256Base64: string;
  sha256Hex: string;
  sizeBytes: number;
  widthPixels: number;
}

export interface ProcessedProjectImage {
  detectedContentType: DetectedImageType;
  display: {
    small: ProcessedImageVariant;
    medium: ProcessedImageVariant;
    large: ProcessedImageVariant;
  };
  exifStripped: true;
  original: ProcessedImageVariant;
}

function is(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return Buffer.from(bytes.subarray(offset, offset + length)).toString("ascii");
}

export function detectImageContentType(bytes: Uint8Array): DetectedImageType {
  if (is(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (is(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";

  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (["heic", "heix", "hevc", "hevx"].includes(brand)) return "image/heic";
    if (brand === "mif1" || brand === "msf1") return "image/heif";
  }

  throw new ImageProcessingError("UNSUPPORTED_TYPE", "Bestand heeft geen ondersteund afbeeldingsformaat.");
}

function normalizeClaimedContentType(value: string): DetectedImageType {
  const normalized = value.trim().toLowerCase();
  if (normalized === "image/jpg") return "image/jpeg";
  if (normalized === "image/heif-sequence") return "image/heif";
  if (normalized === "image/heic-sequence") return "image/heic";
  if (
    normalized === "image/jpeg" ||
    normalized === "image/png" ||
    normalized === "image/webp" ||
    normalized === "image/avif" ||
    normalized === "image/heic" ||
    normalized === "image/heif"
  ) return normalized;
  throw new ImageProcessingError("UNSUPPORTED_TYPE", "Opgegeven MIME-type wordt niet ondersteund.");
}

function hashVariant(
  bytes: Buffer,
  contentType: ProcessedImageVariant["contentType"],
  widthPixels: number,
  heightPixels: number,
): ProcessedImageVariant {
  if (bytes.length < 1 || bytes.length > MAX_OUTPUT_BYTES) {
    throw new ImageProcessingError("OUTPUT_TOO_LARGE", "Verwerkte afbeelding valt buiten de opslaggrens.");
  }
  const digest = createHash("sha256").update(bytes);
  return {
    bytes,
    contentType,
    heightPixels,
    sha256Base64: digest.copy().digest("base64"),
    sha256Hex: digest.digest("hex"),
    sizeBytes: bytes.length,
    widthPixels,
  };
}

async function renderVariant(
  pipeline: Sharp,
  contentType: ProcessedImageVariant["contentType"],
): Promise<ProcessedImageVariant> {
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return hashVariant(data, contentType, info.width, info.height);
}

function decodedPipeline(input: Buffer): Sharp {
  return sharp(input, {
    animated: false,
    failOn: "error",
    limitInputPixels: MAX_INPUT_PIXELS,
    sequentialRead: true,
  }).rotate();
}

function sanitizedOriginalPipeline(input: Buffer, type: DetectedImageType): {
  contentType: ProcessedImageVariant["contentType"];
  pipeline: Sharp;
} {
  const pipeline = decodedPipeline(input).keepIccProfile();
  if (type === "image/png") {
    return { contentType: "image/png", pipeline: pipeline.png({ compressionLevel: 9 }) };
  }
  if (type === "image/webp") {
    return { contentType: "image/webp", pipeline: pipeline.webp({ effort: 5, quality: 95 }) };
  }
  return {
    contentType: "image/jpeg",
    pipeline: pipeline.jpeg({ chromaSubsampling: "4:4:4", mozjpeg: true, quality: 95 }),
  };
}

async function displayVariant(input: Buffer, width: number): Promise<ProcessedImageVariant> {
  return renderVariant(
    decodedPipeline(input)
      .resize({ fit: "inside", height: width, width, withoutEnlargement: true })
      .keepIccProfile()
      .webp({ effort: 5, quality: 84 }),
    "image/webp",
  );
}

/**
 * Decodes untrusted image bytes and emits pixel-oriented, metadata-free assets.
 * Sharp strips EXIF/XMP/IPTC by default; only the color profile is retained.
 */
export async function processProjectImage(
  input: Uint8Array,
  claimedContentType: string,
): Promise<ProcessedProjectImage> {
  if (input.byteLength < 1 || input.byteLength > MAX_INPUT_BYTES) {
    throw new ImageProcessingError("INVALID_SIZE", "Afbeelding valt buiten de uploadgrens.");
  }

  const bytes = Buffer.from(input);
  const detectedContentType = detectImageContentType(bytes);
  const claimed = normalizeClaimedContentType(claimedContentType);
  if (claimed !== detectedContentType) {
    throw new ImageProcessingError("MIME_MISMATCH", "Bestandsinhoud en MIME-type komen niet overeen.");
  }

  try {
    const metadata = await sharp(bytes, {
      animated: true,
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
      sequentialRead: true,
    }).metadata();
    if (!metadata.width || !metadata.height) {
      throw new ImageProcessingError("DECODE_FAILED", "Afbeeldingsafmetingen ontbreken.");
    }
    if (metadata.width * metadata.height > MAX_INPUT_PIXELS) {
      throw new ImageProcessingError("DIMENSIONS_EXCEEDED", "Afbeelding bevat te veel pixels.");
    }
    if ((metadata.pages ?? 1) > 1) {
      throw new ImageProcessingError("ANIMATED_IMAGE", "Geanimeerde afbeeldingen worden niet ondersteund.");
    }

    const sanitized = sanitizedOriginalPipeline(bytes, detectedContentType);
    const [original, small, medium, large] = await Promise.all([
      renderVariant(sanitized.pipeline, sanitized.contentType),
      displayVariant(bytes, 640),
      displayVariant(bytes, 1_280),
      displayVariant(bytes, 2_400),
    ]);

    return {
      detectedContentType,
      display: { small, medium, large },
      exifStripped: true,
      original,
    };
  } catch (error) {
    if (error instanceof ImageProcessingError) throw error;
    throw new ImageProcessingError("DECODE_FAILED", "Afbeelding kon niet veilig worden gedecodeerd.", {
      cause: error,
    });
  }
}
