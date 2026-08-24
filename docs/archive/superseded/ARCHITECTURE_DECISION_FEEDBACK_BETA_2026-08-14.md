# ADR-001 — Buildy feedback-beta architectuur

> **SUPERSEDED.** Dit is het checkout-off architectuurbesluit van 14 augustus
> 2026. De actuele architectuur staat in
> [`ARCHITECTURE_DECISION.md`](../../ARCHITECTURE_DECISION.md).

- Status: Active
- Datum: 2026-08-14
- Reikwijdte: publieke feedbackbèta, kernflow, deployment- en privacygrenzen

## Besluit

Buildy richt zich op een kleine feedbackbèta rond één flow:

landing → lokale fotodemo → Google sign-in → eerste bouwmoment opslaan →
Verhaal → Bouwboek-preview → deel-link → feedback → accountverwijdering.

De canonieke stack is:

- React + Vite + TypeScript
- same-origin Vercel Functions API
- Neon PostgreSQL + Drizzle
- Google OpenID Connect
- server-owned sessies
- private Vercel Blob

## Harde grenzen

- `PRODUCT_PROFILE=feedback_beta` is de enige server-owned productmodus.
- `CHECKOUT_MODE=off` blijft publiek uit.
- Kernacties mogen niet afhangen van frequente cronjobs of langlopende workers.
- Projectmedia en Bouwboek-previewdata blijven privé.
- Frontendcapabilities horen van de server te komen, niet uit client-owned envflags.
- SQL-migrations zijn append-only.

## Niet actief in de MVP

- Better Auth
- wachtwoordauth, magic links en e-maillogin
- Brevo
- Cloudflare R2 of AWS S3
- Stripe-checkout en Peecho-API
- publieke discovery/social-feed als kernproduct

## Huidige uitvoering

De repository bevat nog historische code uit de eerdere bredere productrichting.
Nieuwe code, tests, documentatie en releasebesluiten moeten de feedback-beta
architectuur volgen. Oude richtingen gelden als historische context en niet als
nieuw werkmandaat.

Zie ook:

- [actuele MVP-scope](../../MVP_SCOPE.md)
- [actuele kernflow](../../CORE_FLOW_AND_SCOPE.md)
- [actueel productprofiel](../../PRODUCT_PROFILE.md)
