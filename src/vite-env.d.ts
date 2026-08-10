/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SITE_URL?: string
  readonly VITE_SIMPLE_APP_MODE?: string
  readonly VITE_EMAIL_ENABLED?: string
  readonly VITE_GOOGLE_SIGNIN_ENABLED?: string
  readonly VITE_ACCOUNT_LIFECYCLE_ENABLED?: string
  readonly VITE_MEDIA_ENABLED?: string
  readonly VITE_PHOTOBOOKS_ENABLED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
