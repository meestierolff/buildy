function envFlag(value: string | undefined, fallback: boolean): boolean {
  return value === undefined ? fallback : value === "true";
}

export const SIMPLE_APP_MODE = import.meta.env.VITE_SIMPLE_APP_MODE === "true";
export const EMAIL_AUTH_ENABLED = envFlag(import.meta.env.VITE_EMAIL_ENABLED, !SIMPLE_APP_MODE);
export const GOOGLE_SIGNIN_ENABLED = envFlag(import.meta.env.VITE_GOOGLE_SIGNIN_ENABLED, !SIMPLE_APP_MODE);
export const ACCOUNT_LIFECYCLE_ENABLED = envFlag(import.meta.env.VITE_ACCOUNT_LIFECYCLE_ENABLED, !SIMPLE_APP_MODE);
export const MEDIA_FEATURES_ENABLED = envFlag(import.meta.env.VITE_MEDIA_ENABLED, !SIMPLE_APP_MODE);
export const PHOTOBOOKS_ENABLED = envFlag(import.meta.env.VITE_PHOTOBOOKS_ENABLED, !SIMPLE_APP_MODE);