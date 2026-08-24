# Buildy — agent instructions

## Product

Buildy is een privacy-first, foto-first verbouwingsdagboek met een sociaal
meeleefmodel en een bewaar-/bestelpad voor een production-MVP.

De kernbelofte is:

`Maak van je verbouwing een verhaal om te bewaren.`

Historische `trip`/`step`, project-follow- en project-accessnamen mogen in
append-only data en migrations blijven. Nieuwe zichtbare UI gebruikt
`Verbouwing`, `Bouwmoment`, `Verhaal`, `Bouwboek`, `Connecties` en `Volgend`.

## Doelstack

- React 18 + TypeScript + Vite
- typed same-origin Vercel Functions API
- Neon PostgreSQL + Drizzle
- Google OpenID Connect
- server-owned sessies
- private Vercel Blob
- Stripe-hosted Checkout met geverifieerde webhook
- server-owned prijs-, seller- en termsconfiguratie
- handmatige printfulfilment vanuit de adminorderqueue
- TanStack Query v5 en Wouter-compatibiliteitsrouter

## Actief productcontract

- Google OIDC is de enige loginmethode.
- Er is één canoniek profiel-followmodel: openbaar volgt direct; privé gebruikt
  een followrequest. Block trekt toegang in en unblock herstelt niets.
- Verbouwingen hebben exact `private`, `followers`, `unlisted` en `public`.
- Preview en geautomatiseerde betaaltests gebruiken `CHECKOUT_MODE=test`.
- Live commerce gebruikt alleen na alle releasegates `CHECKOUT_MODE=live`.
- `off`, `test` en `live` falen gesloten bij ontbrekende/mismatched config.
- Een betaalde order wordt in `/beheer/bestellingen` handmatig beoordeeld,
  extern geplaatst en in Buildy bijgewerkt.

## Niet actief in de MVP-runtime

- Better Auth
- wachtwoorden, magic links en e-maillogin
- Brevo of een andere e-mailprovider
- Cloudflare R2 of AWS S3
- Peecho-API, callback, worker, poller, cron of env
- automatische printfulfilment
- project-follow of project-accessrequest als tweede zichtbaar sociaal model
- frequente crons; alleen de dagelijkse begrensde account-lifecyclecron is actief

## Grenzen

- Browsercode gebruikt uitsluitend typed API-clients.
- Autorisatie gebeurt altijd server-side.
- Frontendcapabilities komen van de server-owned product profile truth.
- Media blijft privé; geen permanente signed URL of publieke object-URL.
- Media-completion en Bouwboekproofrequests verwerken exact het aangevraagde
  asset/de revisie via de geïsoleerde workerrol. Owner-polling herhaalt veilig;
  er is geen media- of photobookcron en hun capability hangt niet van
  `CRON_SECRET` af.
- De browser bepaalt nooit prijs, btw, verzending, seller, betaalstatus of rol.
- Alleen de geverifieerde Stripe-webhook kan betaling bevestigen.
- Een Stripe-successredirect of drukkerportaalstatus is geen databasewaarheid.
- SQL-migrations zijn append-only.
- PII hoort niet in logs, eventmetadata, idempotencykeys of URLs.
- Production blijft NO-GO zolang hosting/commercial, legal, pricing/seller,
  provider, Preview, rolreizen, cross-browser en Browser MCP niet groen zijn.
- De huidige Browser MCP-enumeratie `[]` is een harde interactieve blokkade.
- Claim geen production deploy of mutation zonder werkelijk, vastgelegd bewijs.

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

Canonieke product- en releasewaarheid staat in `docs/PRODUCT_MODEL.md`,
`docs/SOCIAL_STATE_MACHINE.md`, `docs/STRIPE_SETUP.md`,
`docs/MANUAL_PEECHO_FULFILMENT.md`, `docs/PRODUCTION_RELEASE.md` en
`docs/MVP_RELEASE_REPORT.md`.
