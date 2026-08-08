const LOCAL_FILE_HEADER_BYTES = 30;
const CENTRAL_DIRECTORY_HEADER_BYTES = 46;
const END_OF_CENTRAL_DIRECTORY_BYTES = 22;
const UTF8_FLAG = 0x0800;

export interface StoredZipEntry {
  name: string;
  bytes: Uint8Array;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function safeName(name: string): Uint8Array {
  if (
    !name
    || name.length > 1024
    || name.startsWith("/")
    || name.includes("\\")
    || name.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) throw new Error("EXPORT_ARCHIVE_PATH_INVALID");
  const bytes = new TextEncoder().encode(name);
  if (bytes.byteLength > 0xffff) throw new Error("EXPORT_ARCHIVE_PATH_INVALID");
  return bytes;
}

/**
 * Builds a deterministic ZIP32 archive using STORE entries. Export media is
 * already compressed, so avoiding recompression keeps CPU and memory bounded.
 */
export function createStoredZip(entries: readonly StoredZipEntry[], maximumBytes: number): Uint8Array {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || entries.length > 0xffff) {
    throw new Error("EXPORT_TOO_LARGE");
  }
  const names = entries.map((entry) => safeName(entry.name));
  if (new Set(entries.map((entry) => entry.name)).size !== entries.length) {
    throw new Error("EXPORT_ARCHIVE_PATH_INVALID");
  }

  let localBytes = 0;
  let centralBytes = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const size = entries[index].bytes.byteLength;
    if (size > 0xffffffff) throw new Error("EXPORT_TOO_LARGE");
    localBytes += LOCAL_FILE_HEADER_BYTES + names[index].byteLength + size;
    centralBytes += CENTRAL_DIRECTORY_HEADER_BYTES + names[index].byteLength;
  }
  const totalBytes = localBytes + centralBytes + END_OF_CENTRAL_DIRECTORY_BYTES;
  if (!Number.isSafeInteger(totalBytes) || totalBytes > maximumBytes || localBytes > 0xffffffff) {
    throw new Error("EXPORT_TOO_LARGE");
  }

  const output = new Uint8Array(totalBytes);
  const view = new DataView(output.buffer);
  const offsets: number[] = [];
  const checksums: number[] = [];
  let offset = 0;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const name = names[index];
    const checksum = crc32(entry.bytes);
    offsets.push(offset);
    checksums.push(checksum);
    writeUint32(view, offset, 0x04034b50);
    writeUint16(view, offset + 4, 20);
    writeUint16(view, offset + 6, UTF8_FLAG);
    writeUint16(view, offset + 8, 0);
    writeUint16(view, offset + 10, 0);
    writeUint16(view, offset + 12, 0);
    writeUint32(view, offset + 14, checksum);
    writeUint32(view, offset + 18, entry.bytes.byteLength);
    writeUint32(view, offset + 22, entry.bytes.byteLength);
    writeUint16(view, offset + 26, name.byteLength);
    writeUint16(view, offset + 28, 0);
    output.set(name, offset + LOCAL_FILE_HEADER_BYTES);
    output.set(entry.bytes, offset + LOCAL_FILE_HEADER_BYTES + name.byteLength);
    offset += LOCAL_FILE_HEADER_BYTES + name.byteLength + entry.bytes.byteLength;
  }

  const centralDirectoryOffset = offset;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const name = names[index];
    writeUint32(view, offset, 0x02014b50);
    writeUint16(view, offset + 4, 20);
    writeUint16(view, offset + 6, 20);
    writeUint16(view, offset + 8, UTF8_FLAG);
    writeUint16(view, offset + 10, 0);
    writeUint16(view, offset + 12, 0);
    writeUint16(view, offset + 14, 0);
    writeUint32(view, offset + 16, checksums[index]);
    writeUint32(view, offset + 20, entry.bytes.byteLength);
    writeUint32(view, offset + 24, entry.bytes.byteLength);
    writeUint16(view, offset + 28, name.byteLength);
    writeUint16(view, offset + 30, 0);
    writeUint16(view, offset + 32, 0);
    writeUint16(view, offset + 34, 0);
    writeUint16(view, offset + 36, 0);
    writeUint32(view, offset + 38, 0);
    writeUint32(view, offset + 42, offsets[index]);
    output.set(name, offset + CENTRAL_DIRECTORY_HEADER_BYTES);
    offset += CENTRAL_DIRECTORY_HEADER_BYTES + name.byteLength;
  }

  writeUint32(view, offset, 0x06054b50);
  writeUint16(view, offset + 4, 0);
  writeUint16(view, offset + 6, 0);
  writeUint16(view, offset + 8, entries.length);
  writeUint16(view, offset + 10, entries.length);
  writeUint32(view, offset + 12, centralBytes);
  writeUint32(view, offset + 16, centralDirectoryOffset);
  writeUint16(view, offset + 20, 0);
  return output;
}
