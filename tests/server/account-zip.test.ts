// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createStoredZip } from "../../server/account/zip";

describe("bounded account export ZIP", () => {
  it("is byte-for-byte deterministic and emits ZIP32 directory records", () => {
    const entries = [
      { name: "data.json", bytes: new TextEncoder().encode('{"ok":true}') },
      { name: "media/item/original.jpg", bytes: Uint8Array.from([1, 2, 3, 4]) },
    ];
    const first = createStoredZip(entries, 10_000);
    const second = createStoredZip(entries, 10_000);
    const view = new DataView(first.buffer, first.byteOffset, first.byteLength);

    expect(first).toEqual(second);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(first.byteLength - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(first.byteLength - 12, true)).toBe(entries.length);
  });

  it.each([
    "../secret",
    "/absolute",
    "media/../secret",
    "media\\secret",
    "media//secret",
  ])("weigert traversal- of ambigue padnaam %s", (name) => {
    expect(() => createStoredZip([{ name, bytes: Uint8Array.of(1) }], 1_000))
      .toThrow("EXPORT_ARCHIVE_PATH_INVALID");
  });

  it("weigert dubbele paden en archives boven de harde limiet", () => {
    expect(() => createStoredZip([
      { name: "data.json", bytes: Uint8Array.of(1) },
      { name: "data.json", bytes: Uint8Array.of(2) },
    ], 1_000)).toThrow("EXPORT_ARCHIVE_PATH_INVALID");
    expect(() => createStoredZip([
      { name: "data.json", bytes: new Uint8Array(100) },
    ], 80)).toThrow("EXPORT_TOO_LARGE");
  });
});
