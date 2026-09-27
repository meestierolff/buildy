import type { ProductProfile } from "../../shared/contracts/productProfile";
import { useProductProfile } from "@/hooks/useProductProfile";

export type AppFeatures = {
  passwordSignInEnabled: boolean;
  accountLifecycleEnabled: boolean;
  mediaFeaturesEnabled: boolean;
  photobooksEnabled: boolean;
};

export function deriveAppFeatures(profile?: ProductProfile): AppFeatures {
  return {
    passwordSignInEnabled: profile?.capabilities.passwordSignIn ?? false,
    accountLifecycleEnabled: profile?.capabilities.accountDeletion ?? false,
    mediaFeaturesEnabled: profile?.capabilities.media ?? false,
    photobooksEnabled: profile?.capabilities.photobookPreview ?? false,
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
