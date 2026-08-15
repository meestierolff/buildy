# Provider setup

Dit runbook beschrijft alleen de canonieke feedback-beta providers. Het bevat
geen credentials en geen oude checkout- of fulfilmentproviders.

## Vereisten

- Bun volgens `packageManager` in `package.json`
- `psql` voor rolconfiguratie en restore rehearsals
- Vercel CLI
- toegang tot de juiste Neon-, Google- en Vercelaccounts

Gebruik `.env.example` alleen als namenlijst.

## Neon

1. Koppel de juiste Neon-omgeving.
2. Gebruik `DATABASE_URL` voor de runtime en `DATABASE_MIGRATION_URL` alleen voor migrations.
3. Pas migrations toe en verifieer daarna met `db/verify.ts`.
4. Bewijs least-privilege rollen en RLS-grenzen op een tijdelijke database en op Preview.

## Google OIDC

1. Maak per environment precies één Google OAuth client voor Buildy.
2. Gebruik alleen de scopes `openid profile email`.
3. Registreer exacte redirect-URI's voor local, Preview en production.
4. Bewijs login, logout en accountverwijdering met een synthetisch account.

## Vercel Blob

1. Maak een private Blob store in het bestaande Vercel-project.
2. Zet alleen de noodzakelijke Blob-token(s) als environmentvariabelen.
3. Bewijs private upload, private read, revoke en delete met synthetische media.
4. Leg geen permanente publieke URL of Blob-token vast in logs of analytics.

## Vercel

1. Bevestig het bestaande project `buildy`.
2. Zet `PRODUCT_PROFILE=feedback_beta` en `CHECKOUT_MODE=off` in Preview en Production.
3. Bewijs build, regio, securityheaders en de private media-/authflow op Preview.
4. Er zijn geen frequente workercrons vereist voor de feedbackbèta.

## Niet in scope voor de feedbackbèta

De volgende providers zijn bewust geen onderdeel van de actieve MVP:

- Brevo
- Stripe
- Peecho
- Cloudflare R2

Toekomstige ideeën staan in
[docs/FUTURE_STRIPE_AND_MANUAL_PEECHO.md](docs/FUTURE_STRIPE_AND_MANUAL_PEECHO.md).
