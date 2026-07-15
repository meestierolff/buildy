// Client-side image compression. Downscales large photos and re-encodes as JPEG
// to keep storage and photobook PDF size in check. Non-image files pass through.

const MAX_DIM = 2400;
const QUALITY = 0.85;
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024; // 30 MB before compression
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

const sizeInMb = (bytes: number) => (bytes / 1024 / 1024).toFixed(0);

const loadImage = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  // Leave small files and non-JPEG-compressible formats alone.
  if (file.type === "image/gif" || file.type === "image/svg+xml") return file;
  if (file.size < 400 * 1024) return file;

  try {
    const img = await loadImage(file);
    const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);
    const blob: Blob | null = await new Promise((r) =>
      canvas.toBlob(r, "image/jpeg", QUALITY)
    );
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}

export async function prepareUpload(file: File): Promise<File> {
  if (file.type.startsWith("image/")) {
    if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
      throw new Error(`${file.name} heeft een niet-ondersteund fotoformaat. Gebruik JPG, PNG, WebP, GIF of AVIF.`);
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
