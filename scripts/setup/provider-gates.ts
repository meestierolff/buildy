interface ListedBlobProbe {
  pathname: string;
  url: string;
}

interface InspectedBlobProbe extends ListedBlobProbe {
  etag: string;
  size: number;
}

function assertPrivateBlobUrl(value: string): void {
  const url = new URL(value);
  if (
    url.protocol !== "https:"
    || !url.hostname.endsWith(".private.blob.vercel-storage.com")
    || url.username
    || url.password
    || url.port
    || url.search
    || url.hash
  ) {
    throw new Error("Blob-store is niet als private bevestigd");
  }
}

export function requireListedBlobProbe(
  blobs: readonly ListedBlobProbe[],
): ListedBlobProbe {
  const blob = blobs[0];
  if (!blob) {
    throw new Error("Blob-store bevat geen bestaand object voor de privacyprobe");
  }
  if (!blob.pathname.trim()) throw new Error("Blob-objectpad ontbreekt");
  assertPrivateBlobUrl(blob.url);
  return blob;
}

export function verifyInspectedPrivateBlob(
  listed: ListedBlobProbe,
  inspected: InspectedBlobProbe,
): void {
  assertPrivateBlobUrl(inspected.url);
  if (inspected.pathname !== listed.pathname || inspected.url !== listed.url) {
    throw new Error("Blob-metadata hoort niet bij het geselecteerde object");
  }
  if (!inspected.etag.trim() || !Number.isSafeInteger(inspected.size) || inspected.size < 0) {
    throw new Error("Blob-metadata is onvolledig");
  }
}
