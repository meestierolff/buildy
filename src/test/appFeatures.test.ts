import { describe, expect, it } from "vitest";
import { deriveAppFeatures } from "@/lib/appFeatures";

describe("app feature mapping", () => {
  it("derives the UI flags from the server-owned product profile", () => {
    const features = deriveAppFeatures({
      profile: "feedback_beta",
      checkoutMode: "off",
      betaMode: true,
      inviteRequiredForNewAccounts: true,
      capabilities: {
        passwordSignIn: true,
        emailAuth: false,
        renovations: true,
        updates: true,
        story: true,
        media: true,
        photobookPreview: false,
        sharing: true,
        feedback: true,
        accountDeletion: false,
        checkout: false,
      },
    });

    expect(features.passwordSignInEnabled).toBe(true);
    expect(features.mediaFeaturesEnabled).toBe(true);
    expect(features.photobooksEnabled).toBe(false);
    expect(features.accountLifecycleEnabled).toBe(false);
  });

  it("fails closed when the product profile is not loaded yet", () => {
    const features = deriveAppFeatures();

    expect(features.passwordSignInEnabled).toBe(false);
    expect(features.mediaFeaturesEnabled).toBe(false);
    expect(features.photobooksEnabled).toBe(false);
  });
});
