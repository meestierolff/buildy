# Buildy

Buildy is het dagboek voor je verbouwing.

De publieke feedbackbèta heeft precies één belofte:

`Maak van je verbouwing een verhaal om te bewaren.`

De kleinste production-MVP richt zich alleen op deze flow:

landing → lokale fotodemo → Google sign-in → eerste bouwmoment opslaan →
Verhaal → Bouwboek-preview → deel-link → feedback → accountverwijdering.

## Canonieke stack

- React + Vite + TypeScript
- Vercel Functions
- Neon PostgreSQL + Drizzle
- Google OpenID Connect
- server-owned sessies op Neon
- private Vercel Blob voor media
- `PRODUCT_PROFILE=feedback_beta`
- `CHECKOUT_MODE=off`

Niet onderdeel van de actieve MVP-runtime:

- Better Auth
- wachtwoorden, magic links of e-maillogin
- Brevo
- Cloudflare R2 of AWS S3
- Stripe-checkout
- Peecho-API
- frequente cronjobs of kritieke workers
- publieke discovery/social-feed als primaire productrichting

## Lokale ontwikkeling

```sh
cp .env.example .env
bun install --frozen-lockfile
bun run dev
```

De webapp draait lokaal op `http://127.0.0.1:8080` en de API op poort 8787.
Gebruik alleen lokale of tijdelijke testdatabases voor integratie- en RLS-tests.

## Belangrijkste commands

```sh
bun run typecheck
bun run lint
bun run test
bun run build
bun run check:bundle
bun run test:e2e
bun run check:launch -- --static
```

Database-validatie:

```sh
bunx tsx db/migrate.ts --check
bunx tsx db/verify.ts
```

## Release-status

De codebasis heeft nu een groene lokale kern voor:

- typecheck
- lint
- unit/servertests
- productiebuild
- bundelbudget
- lokale public Playwright-suite
- volledige lokale PostgreSQL migration/RLS-verificatie op een tijdelijke database

De feedbackbèta is nog geen productie-`GO`. Preview- en productie-release
blijven geblokkeerd totdat echte operatorstappen, Google OIDC, Vercel Blob,
Vercel environmentconfiguratie en deploymentbewijs zijn vastgelegd. Zie
[docs/MVP_RELEASE_REPORT.md](docs/MVP_RELEASE_REPORT.md) en
[docs/PRODUCTION_RELEASE.md](docs/PRODUCTION_RELEASE.md).

## Richting

De repository bevat nog historische code en documentatie uit een bredere
sociale/checkout-richting. De canonical productrichting staat in:

- [docs/MVP_SCOPE.md](docs/MVP_SCOPE.md)
- [docs/CORE_FLOW_AND_SCOPE.md](docs/CORE_FLOW_AND_SCOPE.md)
- [docs/PRODUCT_PROFILE.md](docs/PRODUCT_PROFILE.md)
- [docs/ARCHITECTURE_DECISION.md](docs/ARCHITECTURE_DECISION.md)
- [docs/LAUNCH_READINESS.md](docs/LAUNCH_READINESS.md)
- [docs/PROVIDER_SETUP.md](docs/PROVIDER_SETUP.md)

## Veiligheidsgrenzen

- De browser praat alleen met de Buildy API.
- Autorisatie is altijd server-side.
- Media blijft privé en wordt nooit via permanente publieke URL gedeeld.
- Checkout blijft uit in de feedbackbèta.
- Geen kernactie mag afhankelijk zijn van frequente cronjobs of langlopende workers.
- SQL-migrations zijn append-only.
