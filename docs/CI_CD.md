# Buildy CI/CD

Status: de workflow is repositoryconfiguratie; dit document claimt geen
GitHub-run, deployment of productie-GO.

## Automatische workflow

`.github/workflows/ci.yml` draait op pull requests, pushes naar `main` en
handmatige dispatch. Rechten zijn `contents: read`; oudere runs voor dezelfde
PR/ref worden geannuleerd.

| Job | Actuele gate |
| --- | --- |
| `quality` | typecheck, volledige lint en gewijzigde JS/TS warningvrij |
| `unit-tests` | Vitest buiten de echte DB-integratiebestanden |
| `build` | productiebuild, bundlebudget, static launch en distartifact |
| `dependency-audit` | Bun audit, high/critical fail-closed |
| `migration-sql` | migrationtests/check/dry/apply, vijf rolgrenzen, verify, no-op replay |
| `database-integration` | alle 18 actuele RLS/social/account/payment/manual-fulfilment/project/share/feedback/notificatie-integraties op PostgreSQL 16.4 |
| `public-e2e` | volledige `chromium-desktop`-suite zonder bestandsfilter of skips; testcount komt uit de actuele run |
| `cross-browser-core` | Firefox, WebKit, mobile Chromium en tablet Chromium zonder skips |
| `ci-gate` | vereist success van iedere automatische job hierboven |
| `staging-auth-e2e` | optionele beschermde handmatige stagingrun na groene `ci-gate` |

De automatische database gebruikt alleen ephemerale lokale credentials. De
actieve rollen zijn web, accountworker, mediaworker, paymentworker en
photobookworker; geen e-mail- of Peecho-fulfilmentworker. Aantallen tabellen,
RLS-objecten, migrations of tests horen uit de actuele scripts/run te komen en
worden hier niet hardgecodeerd.

## Migrationgrens

- `db/migrations/*.sql` en de checksumledger zijn deploymentwaarheid;
- `DATABASE_MIGRATION_URL` is de enige migratorinput en heeft geen runtimefallback;
- published migrations blijven byte-identiek en append-only;
- runner valideert files, role safety, advisory lock, timeouts en ledger;
- `db/verify.ts` controleert de actuele schema-/RLS-/functiecontracten;
- een tweede apply moet een no-op zijn;
- functionele integratie wacht op de structurale migrationjob.

Drizzle blijft schema-/querytool, niet een tweede productieledger. Production
migrations vereisen daarnaast TLS, herstelpunt, approval en forward-fixplan.

## Browserjobs

De PR-jobs gebruiken het exact gebouwde artifact en provider-vrije/synthetische
fixtures. De historisch benoemde job `public-e2e` voert
`--project=chromium-desktop` zonder expliciete bestandslijst uit en omvat dus de
volledige Chromium-desktopselectie. JUnit met nul tests of een skip faalt.
Playwrightdiagnostics en
qualityscreenshots hebben begrensde artifactretentie; secrets/storage state
worden niet geüpload.

De protected stagingjob vereist een expliciete HTTPS-origin, het GitHub
Environment `staging-e2e` en een synthetische server-session storage state. Die
state moet bij Google/server-owned sessions horen; oude Better Auth/password-
fixtures zijn ongeldig. De job mag geen productieorigin, echte klantdata,
Stripe live key of echte drukkerorder gebruiken.

Automated Playwright is geen vervanging voor de verplichte in-app Browser MCP-
audit. De laatste runtime/tool-aanvraag werd door de huidige Codex-
gebruikslimiet afgewezen tot 2026-08-29 02:26.

De huidige lokale configuratie inventariseert **205 tests**: Chromium desktop
69 en 34 elk voor Firefox core, WebKit core, mobile Chromium en tablet
Chromium. Geen daarvan werd in de huidige tree uitgevoerd: de sandbox blokkeerde
de previewpoort en de vereiste escalatie werd quota-afgewezen. De hosted CI-run
en run tegen een vastgezette echte Preview zijn evenmin vastgelegd. Zie
[QA_FUNCTION_MATRIX.md](QA_FUNCTION_MATRIX.md).

## Deploymentbeleid

Deze workflow bevat geen automatische Vercel production deploy. Een CI-pass is
geen toestemming voor Previewpromotie, live Stripe, databaseproductiemutatie of
fulfilment. Volg [PRODUCTION_RELEASE.md](PRODUCTION_RELEASE.md) met separate
providerchecks, human approvals en bewijs aan één SHA.

Preview betaaltests horen `CHECKOUT_MODE=test` te gebruiken. Production live
blijft NO-GO totdat Vercel commercial/Hobby, legal, price/seller, printprovider,
Preview, providerroundtrips, cross-browser/rollen en MCP groen zijn.

## Lokale equivalenten

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test
bun run build
bun run check:bundle
bun run check:launch -- --static
bun run test:e2e
bun run db:migrate:check
```

Databasecommands mogen alleen met een expliciete tijdelijke, dedicated
`DATABASE_MIGRATION_URL`; gebruik nooit production voor lokale verificatie.
