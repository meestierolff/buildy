# Buildy — agent instructions

## Product

Buildy is een privacy-first foto-first verbouwingsdagboek voor een publieke
feedbackbèta.

De kernbelofte is:

`Maak van je verbouwing een verhaal om te bewaren.`

Historische `trip`/`step` namen mogen in bestaande data- en API-lagen blijven,
maar nieuwe zichtbare UI gebruikt `verbouwing`, `bouwmoment`, `Verhaal` en
`Bouwboek`.

## Doelstack

- React 18 + TypeScript + Vite
- typed same-origin Vercel Functions API
- Neon PostgreSQL + Drizzle
- Google OpenID Connect
- server-owned sessies
- private Vercel Blob
- TanStack Query v5 en Wouter-compatibiliteitsrouter

## Niet actief in de MVP

- Better Auth als gewenste eindrichting
- wachtwoorden, magic links en e-maillogin
- Brevo
- Cloudflare R2 of AWS S3
- Stripe-checkout
- Peecho-API
- frequente cronjobs of kernpad-workers

## Grenzen

- Browsercode gebruikt uitsluitend typed API-clients.
- Autorisatie gebeurt altijd server-side.
- Frontendcapabilities komen van de server-owned product profile truth.
- Media blijft privé; geen permanente signed URL of publieke object-URL.
- Checkout blijft uit met `CHECKOUT_MODE=off`.
- SQL-migrations zijn append-only.
- PII hoort niet in logs, eventmetadata, idempotencykeys of URLs.

## Verificatie

```sh
bun run typecheck
bun run lint
bun run test
bun run build
bun run check:bundle
bun run check:launch -- --static
```

Voor databasegrenzen gebruik je daarnaast de tijdelijke PostgreSQL workflow uit
de CI-slice en `db/verify.ts`.
