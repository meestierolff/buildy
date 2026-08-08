# Buildy

Buildy is een privacy-first sociaal verbouwingsdagboek. Bewoners leggen een
renovatie vast in updates, foto's, planning en budget, bepalen per project wie
mag meekijken en kunnen een goedgekeurde tijdlijn laten drukken als Bouwboek.

De doelruntime bestaat uit React 18/TypeScript/Vite, een typed same-origin API op
Vercel Functions, Neon PostgreSQL met Drizzle, Better Auth met HttpOnly cookies,
private Cloudflare R2-opslag, Brevo transactionele mail, Stripe Checkout en een
server-side Peecho REST v3 fulfilmentworker.

## Lokale ontwikkeling

Vereisten: de Bun-versie uit `packageManager` in `package.json` en Node voor de
server/toolingscripts. Kopieer alleen de benodigde namen; commit nooit waarden:

```sh
cp .env.example .env
bun install --frozen-lockfile
bun run dev
```

De frontend draait standaard op `http://127.0.0.1:8080` en proxyt `/api` naar de
lokale API op poort 8787. Zonder database-/providerconfig blijft de betreffende
capability bewust `unconfigured`; de app verzint geen successtatus.

## Belangrijkste commands

```sh
bun run typecheck
bun run lint
bun run test
bun run build
bun run check:bundle
bun run test:e2e:preview

node --import tsx db/migrate.ts --check
bun run check:launch -- --static
bun run setup:providers -- --staging
bun run setup:providers -- --staging --check
```

Gebruik `bun run test` voor Vitest. Het kale `bun test` commando start Bun's
eigen testrunner en is voor deze repository niet de juiste suite.

## Structuur

- `src/` — React-interface en typed API-clients;
- `api/router.ts` — enkele Vercel Function-entrypoint;
- `server/http/router.ts` — routes, origincontrole, health en readiness;
- `server/` — domeinservices, repositories, workers en provideradapters;
- `shared/contracts/` — Zod-contracten gedeeld door browser en server;
- `db/schema/` — Drizzle-schema;
- `db/migrations/` — append-only SQL-migrations met checksumledger;
- `scripts/setup/` — provider-/databasecontrole zonder secretoutput;
- `scripts/migration/` — hervatbare, fail-closed legacycutovertooling;
- `tests/server`, `tests/db`, `tests/e2e`, `src/test` — testlagen;
- `docs/` — architectuur, runbooks en actuele launchmatrix.

## Security- en privacygrenzen

- De browser spreekt alleen met de Buildy-API en krijgt nooit database- of
  providercredentials.
- Auth gebruikt authoritative server-sessies en Secure/HttpOnly/SameSite cookies;
  mutaties vereisen een vertrouwde exacte Origin.
- Runtime en iedere worker hebben een afzonderlijke database-login. Zij hebben
  geen tabel-DML en alleen `EXECUTE` op hun begrensde `SECURITY DEFINER`-functies.
- R2 is privé. Uploads, reads en printdownloads gebruiken korte, doelgebonden
  grants; objectkeys, magic bytes, bytes en checksums worden server-side bewaakt.
- PII wordt waar mogelijk envelope-encrypted met contextgebonden AAD en blind
  geïndexeerd. Logs accepteren geen e-mail, adres, token, payload of signed URL.
- Webhooks verifiëren raw signatures/account/environment en gaan daarna door een
  idempotente inbox/state-machine.
- Checkout staat los van providerconfig en blijft standaard uit met
  `CHECKOUT_ENABLED=false`.
- AI-plattegrondgeneratie is niet onderdeel van de actieve runtime.

Zie [ARCHITECTURE_DECISION.md](docs/ARCHITECTURE_DECISION.md) en
[CI_CD.md](docs/CI_CD.md) voor de volledige grenzen.

## Database en migraties

Gebruik een directe TLS-verbinding alleen voor migrations en pooled URLs voor de
runtime/workerrollen:

```sh
DATABASE_MIGRATION_URL='postgresql://…?sslmode=require' node --import tsx db/migrate.ts
DATABASE_MIGRATION_URL='postgresql://…?sslmode=require' node --import tsx db/verify.ts
DATABASE_MIGRATION_URL='postgresql://…?sslmode=require' node --import tsx db/migrate.ts
```

De laatste stap moet een no-op zijn. Wijzig nooit een gepubliceerde migration;
maak een volgende forward migration. Richt daarna de rollen in en verifieer ze
met de SQL-scripts in `scripts/setup/`. Details staan in
[PROVIDER_SETUP.md](docs/PROVIDER_SETUP.md).

## Bouwboek, checkout en fulfilment

De server bouwt één canonical document, rendert een deterministische proof,
controleert minimaal 24 en een even aantal pagina's, bewaart hashes en vergrendelt
alleen een expliciet goedgekeurde revision. De klant kan geen prijs, seller,
valuta, offering of proofrevision bepalen.

Stripe-bevestiging reserveert niet rechtstreeks een printorder. Een durable
Peecho-worker claimt fulfilment, maakt een order en betaalt die als twee aparte
idempotente stappen. Bij een onzekere create haalt hij eerst de canonical
providerorder op. Een Stripe-refund is nooit automatisch bewijs van annulering
bij de printer. Zie [PEECHO_V3_ADAPTER.md](docs/PEECHO_V3_ADAPTER.md),
[TRANSACTIONAL_EMAIL.md](docs/TRANSACTIONAL_EMAIL.md) en
[ORDER_SUPPORT_RUNBOOK.md](docs/ORDER_SUPPORT_RUNBOOK.md).

## Staging en deployment

1. Vul uitsluitend stagingcredentials in Vercel en houd Stripe/Peecho in testmode.
2. Voer `bun run setup:providers -- --staging --check` uit; deze probes zijn
   read-only en tonen geen secrets.
3. Pas migrations toe, configureer rollen en controleer `/api/health` en
   `/api/readiness`.
4. Deploy het gebouwde artifact en voer `bun run check:launch -- --staging
   --base-url=https://…` uit.
5. Bewijs private R2, Better Auth/Brevo, Stripe sandbox, Peecho sandbox,
   callbacks, workers, fault injection en restore op niet-productie.
6. Activeer checkout alleen voor de gecontroleerde sandboxflow. Productie en
   publieke registratie blijven dicht tot alle relevante gates zijn getekend.

De setup-, DPA-, DNS-, cron-, juridische en providerstappen staan in
[PROVIDER_SETUP.md](docs/PROVIDER_SETUP.md) en
[EXTERNAL_INPUTS_REQUIRED.md](docs/EXTERNAL_INPUTS_REQUIRED.md).

De eenmalige legacy-import gebruikt bewust een andere, directe targetverbinding
(`DATABASE_DIRECT_URL`) en de bevestigingsgrenzen uit
[MIGRATION_AND_CUTOVER.md](docs/MIGRATION_AND_CUTOVER.md). Verwissel die nooit
met de least-privileged schema-runnerverbinding.

## Launchstatus

De actuele beslissing staat in [LAUNCH_READINESS.md](docs/LAUNCH_READINESS.md).
Op 4 augustus 2026 is publieke productie **NO-GO**: echte provideraccounts,
stagingcutover, volledige authenticated browseracceptatie, monitoring,
restore rehearsal en een ontvangen fysieke proefdruk zijn nog niet bewezen. Een
groene build of ingevulde secret sluit geen van die gates zelfstandig.

Zie het [implementatielog](docs/IMPLEMENTATION_LOG.md), het
[migratierapport](docs/MIGRATION_REPORT.md) en de actuele
[launchmatrix](docs/LAUNCH_READINESS.md) voor gemeten commandostatussen,
synthetische browserartifacts en de precieze resterende externe bewijzen.
