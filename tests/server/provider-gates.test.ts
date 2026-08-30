// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  requireListedBlobProbe,
  verifyInspectedPrivateBlob,
} from "../../scripts/setup/provider-gates";

const PRIVATE_BLOB = {
  pathname: "media/owner/asset/original",
  url: "https://store.private.blob.vercel-storage.com/media/owner/asset/original",
};

describe("provider release gates", () => {
  it("fails closed when a Blob store has no real object to inspect", () => {
    expect(() => requireListedBlobProbe([])).toThrow("geen bestaand object");
  });

  it("requires the listed and inspected object to prove the same private Blob", () => {
    const listed = requireListedBlobProbe([PRIVATE_BLOB]);

    expect(() => verifyInspectedPrivateBlob(listed, {
      ...PRIVATE_BLOB,
      etag: "etag-private-object",
      size: 12,
    })).not.toThrow();
    expect(() => requireListedBlobProbe([{
      ...PRIVATE_BLOB,
      url: "https://store.public.blob.vercel-storage.com/media/owner/asset/original",
    }])).toThrow("niet als private");
    expect(() => verifyInspectedPrivateBlob(listed, {
      ...PRIVATE_BLOB,
      pathname: "media/owner/other/original",
      etag: "etag-other-object",
      size: 12,
    })).toThrow("niet bij het geselecteerde object");
  });
});
