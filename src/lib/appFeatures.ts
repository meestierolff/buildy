import type { ProductProfile } from "../../shared/contracts/productProfile";
import { useProductProfile } from "@/hooks/useProductProfile";

export type AppFeatures = {
  profile: "feedback_beta";
  betaMode: boolean;
  inviteRequiredForNewAccounts: boolean;
  emailAuthEnabled: boolean;
  googleSignInEnabled: boolean;
  accountLifecycleEnabled: boolean;
  mediaFeaturesEnabled: boolean;
  photobooksEnabled: boolean;
  checkoutEnabled: boolean;
};

export function deriveAppFeatures(profile?: ProductProfile): AppFeatures {
  return {
    profile: profile?.profile ?? "feedback_beta",
    betaMode: profile?.betaMode ?? true,
    inviteRequiredForNewAccounts: profile?.inviteRequiredForNewAccounts ?? true,
    emailAuthEnabled: profile?.capabilities.emailAuth ?? false,
    googleSignInEnabled: profile?.capabilities.googleSignIn ?? false,
    accountLifecycleEnabled: profile?.capabilities.accountDeletion ?? false,
    mediaFeaturesEnabled: profile?.capabilities.media ?? false,
    photobooksEnabled: profile?.capabilities.photobookPreview ?? false,
    checkoutEnabled: profile?.capabilities.checkout ?? false,
  };
}

export function useAppFeatures() {
  const query = useProductProfile();
  return {
    ...deriveAppFeatures(query.data),
    isPending: query.isPending,
    isError: query.isError,
    query,
  };
}