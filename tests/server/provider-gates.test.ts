// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  requireCheckoutModeForTarget,
  requireListedBlobProbe,
  verifyInspectedPrivateBlob,
  verifyStripeAccount,
} from "../../scripts/setup/provider-gates";

const PRIVATE_BLOB = {
  pathname: "media/owner/asset/original",
  url: "https://store.private.blob.vercel-storage.com/media/owner/asset/original",
};

describe("provider release gates", () => {
  it("requires test checkout on staging and live checkout in production", () => {
    expect(requireCheckoutModeForTarget("staging", "test")).toBe("test");
    expect(requireCheckoutModeForTarget("production", "live")).toBe("live");
    expect(() => requireCheckoutModeForTarget("staging", null)).toThrow("CHECKOUT_MODE=test");
    expect(() => requireCheckoutModeForTarget("production", null)).toThrow("CHECKOUT_MODE=live");
    expect(() => requireCheckoutModeForTarget("production", "test")).toThrow("CHECKOUT_MODE=live");
  });

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

  it("uses Stripe's current-account and balance resources for account and mode truth", async () => {
    const retrieveCurrent = vi.fn(async () => ({ id: "acct_BUILDY" }));
    const retrieveBalance = vi.fn(async () => ({ livemode: true }));

    await expect(verifyStripeAccount({
      accounts: { retrieveCurrent },
      balance: { retrieve: retrieveBalance },
    }, "acct_BUILDY", "production")).resolves.toBeUndefined();

    expect(retrieveCurrent).toHaveBeenCalledOnce();
    expect(retrieveBalance).toHaveBeenCalledOnce();
  });

  it("rejects a mismatched Stripe account or key mode", async () => {
    await expect(verifyStripeAccount({
      accounts: { retrieveCurrent: vi.fn(async () => ({ id: "acct_OTHER" })) },
      balance: { retrieve: vi.fn(async () => ({ livemode: true })) },
    }, "acct_BUILDY", "production")).rejects.toThrow("account-ID mismatch");

    await expect(verifyStripeAccount({
      accounts: { retrieveCurrent: vi.fn(async () => ({ id: "acct_BUILDY" })) },
      balance: { retrieve: vi.fn(async () => ({ livemode: false })) },
    }, "acct_BUILDY", "production")).rejects.toThrow("accountmode mismatch");
  });
});
