# Operator actions required

Dit bestand bevat geen secretwaarden.

## Google OAuth client

- Provider/dashboard: Google Cloud Console
- Setting: OAuth client for Buildy
- Env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- Environment: Preview, Production
- Format: exact client ID and secret
- Verification: complete Google sign-in and logout
- Evidence: screenshot or operator note of successful Preview login
- Blocks: Preview, public feedback beta, production

## Neon runtime database

- Provider/dashboard: Neon
- Setting: runtime connection and migration connection
- Env vars: `DATABASE_URL`, `DATABASE_MIGRATION_URL`
- Environment: Preview, Production
- Format: PostgreSQL URLs with the approved roles
- Verification: migration apply, `db/verify.ts`, app health/readiness
- Evidence: migration log and verification output
- Blocks: local development when missing, Preview, public feedback beta, production

## Vercel Blob

- Provider/dashboard: Vercel
- Setting: private Blob store token
- Env vars: `BLOB_READ_WRITE_TOKEN`
- Environment: Preview, Production
- Format: Vercel Blob read/write token
- Verification: private upload, private read, revoke and delete
- Evidence: Preview test notes without exposing URLs or tokens
- Blocks: Preview, public feedback beta, production

## Product profile

- Provider/dashboard: Vercel project settings
- Setting: server-owned product profile
- Env vars: `PRODUCT_PROFILE`, `CHECKOUT_MODE`
- Environment: Preview, Production
- Format: `feedback_beta`, `off`
- Verification: health/product-profile endpoint and disabled checkout UI/runtime
- Evidence: Preview smoke test
- Blocks: public feedback beta, production

## Support and legal copy

- Provider/dashboard: founder-owned content source
- Setting: real support e-mail and approved privacy/terms copy
- Env vars: `SUPPORT_EMAIL`
- Environment: Preview, Production
- Format: real support mailbox
- Verification: links render and route correctly
- Evidence: Preview screenshots and approval note
- Blocks: public feedback beta, production
