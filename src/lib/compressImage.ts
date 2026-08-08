// Upload validation deliberately preserves the exact source bytes. Display-size
// derivatives are produced by the trusted media worker; the sanitized full-size
// server original remains available to the Bouwboek renderer.

export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
]);

const sizeInMb = (bytes: number) => (bytes / 1024 / 1024).toFixed(0);

export async function compressImage(file: File): Promise<File> {
  return file;
}

export async function prepareUpload(file: File): Promise<File> {
  if (file.type.startsWith("image/")) {
    if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
      throw new Error(`${file.name} heeft een niet-ondersteund fotoformaat. Gebruik JPG, PNG, WebP, GIF, AVIF, HEIC of HEIF.`);
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error(`Foto is te groot (${sizeInMb(file.size)} MB). Max ${sizeInMb(MAX_IMAGE_BYTES)} MB.`);
    }
    return compressImage(file);
  }

  if (file.type.startsWith("video/")) {
    if (file.size > MAX_VIDEO_BYTES) {
      throw new Error(`Video is te groot (${sizeInMb(file.size)} MB). Max ${sizeInMb(MAX_VIDEO_BYTES)} MB.`);
    }
    return file;
  }

  if (file.type === "application/pdf") {
    if (file.size > MAX_PDF_BYTES) {
      throw new Error(`PDF is te groot (${sizeInMb(file.size)} MB). Max ${sizeInMb(MAX_PDF_BYTES)} MB.`);
    }
    return file;
  }

  throw new Error(`${file.name} heeft een niet-ondersteund bestandstype.`);
}
