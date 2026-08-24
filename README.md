# Buildy

Buildy is een privacy-first, foto-first verbouwingsdagboek voor mensen die hun
eigen huis verbouwen en voor de vrienden en familie die willen meeleven.

> Maak van je verbouwing een verhaal om te bewaren.

De kernflow is:

`foto → Bouwmoment → Verhaal → reacties → Bouwboek → Stripe → handmatige fulfilment`

## Product

Buildy brengt verspreide voortgangsfoto's, keuzes en updates samen in één rustig
chronologisch Verhaal. Een eigenaar legt Bouwmomenten vast, volgers beleven de
verbouwing mee en hetzelfde bronmateriaal groeit automatisch uit tot een
persoonlijk Bouwboek.

De zichtbare producttaal is:

- Verbouwing, niet Project;
- Bouwmoment, niet Update of Step;
- Verhaal, niet Timeline;
- Bouwboek, niet Photobook;
- Connecties, niet Friends;
- Volgend, niet Favorites.

Historische `trip`, `step`, project-follow- en project-access-namen mogen in
append-only databasegeschiedenis blijven. Ze zijn geen tweede zichtbaar
productmodel.

## Actieve architectuur

- React 18, TypeScript en Vite;
- typed same-origin Vercel Functions API;
- Neon PostgreSQL, Drizzle, RLS en append-only migrations;
- Google OpenID Connect als enige loginmethode;
- opaque server-owned sessies waarvan alleen hashes in Neon staan;
- private Vercel Blob met autorisatie op iedere customer-mediaread;
- request-driven verwerking van exact het completed media-asset en exact de
  aangevraagde Bouwboekrevisie onder geïsoleerde workerrollen; begrensde
  owner-polling, geen media-/photobookcron;
- TanStack Query v5 en een Wouter-compatibiliteitsrouter;
- Stripe-hosted Checkout met een geverifieerde, idempotente webhook;
- een server-owned, goedgekeurde prijs- en sellerconfiguratie;
- een beheerdergestuurde orderqueue voor handmatige printfulfilment.

Niet actief in de MVP-runtime:

- Better Auth, wachtwoorden, magic links, reset- of e-maillogin;
- Brevo of een andere e-mailprovider;
- Cloudflare R2, AWS S3 of publieke customer-mediaobjecten;
- de Peecho-API, Peecho-webhooks, een Peecho-worker of Peecho-secrets;
- client-owned featureflags, prijzen, sellergegevens of autorisatie.

Stripe is dus niet verwijderd. Preview en geautomatiseerde betaaltests horen
`CHECKOUT_MODE=test` te gebruiken. `CHECKOUT_MODE=live` blijft gesloten totdat
alle commerciële, juridische, prijs-, provider-, hosting- en releasegates groen
zijn. Peecho is alleen een mogelijke handmatige operatorstap buiten de runtime.

## Lokale ontwikkeling

Vereisten: Bun `1.3.3`, Node.js 22 of nieuwer en voor databasevalidatie een
lokale tijdelijke PostgreSQL 16-database.

```sh
cp .env.example .env
bun install --frozen-lockfile
bun run dev
```

De webapp draait standaard op `http://127.0.0.1:8080` en de lokale API op
`http://127.0.0.1:8787`. Gebruik nooit een productie-URL voor lokale migrations
of integratietests.

## Verificatie

```sh
bun run typecheck
bun run lint
bun run test
bun run build
bun run check:bundle
bun run test:e2e
bun run check:launch -- --static
```

Voor een tijdelijke database:

```sh
DATABASE_MIGRATION_URL='<directe tijdelijke migrator-url>' bun run db:migrate:check
DATABASE_MIGRATION_URL='<directe tijdelijke migrator-url>' bun run db:migrate
DATABASE_MIGRATION_URL='<directe tijdelijke migrator-url>' bun run db:verify
```

Configureer en verifieer daarna de afzonderlijke web-, account-, media-,
payment- en photobookrollen met de SQL-scripts in `scripts/setup/`. E-mail- en
Peecho-fulfilmentrollen zijn geen actieve runtimevereisten. Alleen account
lifecycle heeft een dagelijkse Vercel-cron/`CRON_SECRET`; media en Bouwboek
vereisen hun worker-DB-URL plus private Blob en verwerken gerichte requests.

## Release-status

De geïntegreerde werkbranch is `sol/buildy-production-mvp`. Er is op deze
documentatiesnapshot geen nieuwe Preview of productiedeployment als geverifieerd
verklaard en productie is niet gemuteerd.

Productie is expliciet **NO-GO** zolang onder meer het volgende openstaat:

- de verplichte interactieve Playwright MCP-browseraudit; de laatste runtime-
  aanvraag werd door de huidige Codex-gebruikslimiet geblokkeerd;
- een volledig geconfigureerde en geverifieerde Previewomgeving;
- echte Google OIDC- en private Blob-rondreizen op Preview;
- Stripe test Checkout en webhookbewijs op Preview;
- een hosted CI-run en echte provider-/multi-role Previewjourneys;
- goedgekeurde juridische identiteit, voorwaarden, supportcontact,
  prijs-/sellergegevens en printproviderproces;
- commercieel toegestane hosting; het gekoppelde Vercel-account is in de
  huidige controle een Hobby-plan.

Een groene build of het bestaande publieke adres is geen productie-`GO`. Zie
[het release-rapport](docs/MVP_RELEASE_REPORT.md),
[de productieprocedure](docs/PRODUCTION_RELEASE.md) en
[de vereiste operatoracties](docs/OPERATOR_ACTIONS_REQUIRED.md).

## Canonieke documentatie

- [MVP-scope](docs/MVP_SCOPE.md)
- [Productmodel](docs/PRODUCT_MODEL.md)
- [Sociaal state machine](docs/SOCIAL_STATE_MACHINE.md)
- [Stripe-setup](docs/STRIPE_SETUP.md)
- [Handmatige Peecho-fulfilment](docs/MANUAL_PEECHO_FULFILMENT.md)
- [QA-functiematrix](docs/QA_FUNCTION_MATRIX.md)
- [Playwright MCP-audit](docs/PLAYWRIGHT_MCP_AUDIT.md)
- [Productierelease](docs/PRODUCTION_RELEASE.md)

Andere documenten kunnen historische ontwerp-, migratie- of
provideronderzoeken beschrijven. Bij tegenspraak zijn de documenten hierboven,
de actuele typed contracts en de runtimeconfiguratie leidend.

## Veiligheidsgrenzen

- Browsercode gebruikt alleen de typed Buildy-API.
- Identiteit en autorisatie worden server-side afgeleid.
- Media en print-PDF's blijven privé; Buildy geeft geen permanente publieke of
  signed customer-media-URL uit.
- Een profiel-follow of tijdelijke owner-issued `unlisted` share capability
  geeft nooit schrijfrechten.
- Een Stripe-successredirect is nooit betaalbewijs; alleen de geverifieerde
  webhook kan betaalstatus veranderen.
- Prijs, btw, verzending, seller en actuele voorwaarden komen van de server.
- PII hoort niet in logs, eventmetadata, idempotencykeys of URL's.
- SQL-migrations zijn append-only.
