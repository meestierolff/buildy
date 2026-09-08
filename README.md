# Buildy

Buildy is een privacy-first, foto-first verbouwingsdagboek voor mensen die hun
huis verbouwen en voor de vrienden en familie die willen meekijken.

> Maak van je verbouwing een verhaal om te bewaren.

De gratis MVP-flow is:

`account → privéverbouwing → foto/Bouwmoment → gedeeld Verhaal → like/reactie → digitaal Bouwboek`

## MVP van vandaag

- een rustige publieke landing met een lokale fotodemo;
- Google OpenID Connect als enige loginmethode;
- korte onboarding met een naam en optioneel type verbouwing;
- een nieuwe verbouwing die standaard privé is;
- foto-first Bouwmomenten in één chronologisch Verhaal;
- intrekbare deellinks voor alleen-lezen toegang zonder account;
- reageren na inloggen;
- een gratis digitaal Bouwboek dat uit echte Bouwmomenten groeit;
- feedback en support zonder transactionele e-mailprovider.

De primaire ingelogde navigatie is `Mijn verbouwing`, `Bouwmoment toevoegen`,
`Bouwboek` en `Profiel`. Oudere routes en datanamen kunnen voor compatibiliteit
blijven bestaan, maar vormen geen tweede zichtbaar productmodel.

## Actieve runtime

- React 18, TypeScript en Vite;
- typed same-origin Vercel Functions API;
- Neon PostgreSQL, Drizzle en append-only migrations;
- Google OIDC met opaque, server-owned sessies;
- private Vercel Blob met autorisatie per mediaread;
- request-driven mediaverwerking onder een eigen workerrol;
- TanStack Query v5 en een Wouter-compatibiliteitsrouter;
- één dagelijkse Vercel-cron voor account lifecycle.

Het accountgebaseerde releaseprofiel is `PRODUCT_PROFILE=feedback_beta`.
Lokaal, Preview, staging en Production gebruiken voor deze gratis MVP:

```env
PRODUCT_PROFILE="feedback_beta"
BETA_MODE="false"
CHECKOUT_MODE="off"
```

`public_demo` blijft een veilige rollbackoptie; een online demo bewijst niet dat
de accountgebaseerde MVP werkt. De actuele scope en het werkelijke bewijs staan
in [GRAPH](docs/architecture/GRAPH.md), [FLOWS](docs/architecture/FLOWS.md) en
[STATE](docs/architecture/STATE.md).

Stripe, Peecho, fysieke bestellingen, printproof, budget, plattegronden en brede
discovery zijn voor later. Bestaande commercecode blijft dormant en is geen
releaseafhankelijkheid. Er is geen transactionele e-mail- of AI-runtime.

## Lokaal starten

Vereisten: Bun `1.3.3` en Node.js `22.x`.

```sh
cp .env.example .env
bun install --frozen-lockfile
bun run dev
```

De webapp draait standaard op `http://127.0.0.1:8080` en de lokale API op
`http://127.0.0.1:8787`.

## Verificatie

```sh
bun run typecheck
bun run lint
bun run test
bun run build
bun run check:bundle
bun run check:launch -- --static
```

Gebruik voor databasecontrole uitsluitend een tijdelijke database:

```sh
DATABASE_MIGRATION_URL='<tijdelijke-directe-url>' bun run db:migrate:check
DATABASE_MIGRATION_URL='<tijdelijke-directe-url>' bun run db:migrate
DATABASE_MIGRATION_URL='<tijdelijke-directe-url>' bun run db:verify
```

## Documentatie

- [MVP-scope](docs/MVP_SCOPE.md)
- [Vereiste operatoracties](docs/OPERATOR_ACTIONS_REQUIRED.md)
- [Productmodel](docs/PRODUCT_MODEL.md)
- [Sociaal toegangsmodel](docs/SOCIAL_STATE_MACHINE.md)
- [Google-authconfiguratie](docs/GOOGLE_AUTH_SETUP.md)
- [Private Blob-configuratie](docs/VERCEL_BLOB_SETUP.md)
- [Stripe Checkout-configuratie — dormant, buiten deze release](docs/STRIPE_SETUP.md)
- [Production-releaseprocedure](docs/PRODUCTION_RELEASE.md)

## Veiligheidsgrenzen

- Browsercode gebruikt alleen de typed Buildy-API.
- Identiteit en autorisatie worden altijd server-side bepaald.
- Customer-media blijft privé; Buildy publiceert geen permanente object-URL.
- Een deellink geeft alleen kijktoegang en kan worden ingetrokken.
- Checkout blijft uit; de bestaande betaalbeveiliging blijft behouden voor
  eventueel later gebruik.
- PII hoort niet in logs, eventmetadata, idempotencykeys of URL's.
- SQL-migrations zijn append-only.
