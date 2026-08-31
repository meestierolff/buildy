# ADR-002 — Buildy production-MVP architectuur

- Status: actief
- Datum: 23 augustus 2026
- Reikwijdte: productmodel, identity, data, media, social, commerce en release
- Vervangt: het checkout-off feedback-bètabesluit van 14 augustus 2026

## Besluit

Buildy bouwt één samenhangende flow rond:

`foto → Bouwmoment → Verhaal → samen beleven → Bouwboek → Stripe → handmatige fulfilment`

De kernbelofte is: **Maak van je verbouwing een verhaal om te bewaren.**

De architectuur bestaat uit React 18/TypeScript/Vite, een typed same-origin
Vercel Functions API, Neon PostgreSQL/Drizzle/RLS, Google OpenID Connect,
server-owned sessies, private Vercel Blob, TanStack Query v5,
Wouter-compatibiliteitsrouting, Stripe-hosted Checkout en een adminqueue voor
handmatige printfulfilment.

## Identity en autorisatie

- Google OIDC Authorization Code met PKCE, state en nonce is de enige login.
- Alleen hashes van opaque sessietokens staan in Neon; cookies zijn HttpOnly en
  veilig geconfigureerd.
- Browserinput kiest nooit actor, rol of resource-eigenaar. Iedere read en write
  wordt server-side en waar nodig opnieuw in PostgreSQL/RLS geautoriseerd.
- Moderator/adminrechten zijn gecontroleerde, tijdgebonden databasegrants.

## Media en data

- Customer-media, exports en printproofs gebruiken private Vercel Blob.
- De browser krijgt geen permanente signed URL of publieke object-URL.
- Upload, completion, delivery, delete en proofdownload controleren type, key,
  bytegrootte, checksum, actor en actuele visibility.
- Completion verwerkt direct het exact geclaimde media-asset; een proofrequest
  verwerkt direct de exacte revisie. Begrensde owner-polling kan dezelfde
  leased/idempotente verwerking veilig hervatten. Media en Bouwboek hebben geen
  cronroute of Vercel schedule.
- SQL-migrations en auditledgers zijn append-only. Historische `trip`, `step`,
  project-follow/project-access, R2, e-mail en Peecho-objecten mogen blijven maar
  zijn geen actieve product- of providerboundary.

## Sociaal model

- Eén profiel-followrelatie is canoniek. Openbaar profiel volgt direct; privé
  profiel gebruikt pending/accept/reject/cancel.
- Block trekt follows, requests en toegang in beide richtingen in en unblock
  herstelt niets.
- Verbouwingen hebben exact `private`, `followers`, `unlisted` en `public`.
- Een unlisted link of follow geeft alleen read volgens visibility, nooit write.
- Direct project-follow/project-access is geen zichtbaar of actief API-model.

## Commerce

- Stripe Checkout is vereist voor Bouwboekbestellingen.
- Preview en automation gebruiken `CHECKOUT_MODE=test`; live gebruikt pas na
  volledige GO `CHECKOUT_MODE=live`; `off` sluit verkoop bewust.
- Alle modi falen gesloten op incomplete, verlopen of verkeerde-environment
  keys, account-ID, workerrol, price matrix, seller en terms.
- Alleen een geverifieerde Stripe-webhook mag paymentstatus wijzigen.
- Na payment controleert een admin de exact gelockte PDF en plaatst de order
  handmatig bij een goedgekeurde drukker. Geen Peecho API/callback/worker/env.

## Bewust niet actief

- Better Auth, wachtwoord/magic-link/e-maillogin;
- Brevo of een andere e-mailprovider;
- Cloudflare R2/AWS S3;
- automatische printfulfilment;
- client-owned capabilities, prijzen, seller, tax, paymentstatus of RBAC;
- frequente kernpadcrons; alleen de dagelijkse begrensde
  account-lifecyclecron blijft gepland.

## Releaseconsequentie

De code kan lokaal gereed lijken zonder dat provider/commercial/legal
production readiness bewezen is. Een live release is daarom NO-GO zolang
Vercel Hobby/commercial, legal, pricing/seller, drukker/provider,
Previewenvironment, Google/Blob/Stripe roundtrips, hosted CI en herhaling van
de huidige 49-migratie- en 205-testmatrices op Preview, complete role journeys
en de interactieve MCP-audit niet groen zijn. De verplichte
Browser MCP-runtime was door de huidige Codex-gebruikslimiet geblokkeerd. Deze
ADR claimt geen production deployment of mutatie.

Zie [PRODUCT_MODEL.md](PRODUCT_MODEL.md),
[SOCIAL_STATE_MACHINE.md](SOCIAL_STATE_MACHINE.md),
[STRIPE_SETUP.md](STRIPE_SETUP.md) en
[PRODUCTION_RELEASE.md](PRODUCTION_RELEASE.md).
