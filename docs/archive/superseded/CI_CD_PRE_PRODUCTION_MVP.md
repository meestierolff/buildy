# Buildy CI/CD

> **SUPERSEDED — NIET ALS ACTIEVE CI-HANDLEIDING GEBRUIKEN.** Deze snapshot
> bevat Better Auth/R2/Brevo/Peecho-rollen, oude schema-aantallen en oude E2E-
> verwachtingen. Gebruik de actuele [`CI_CD.md`](../../CI_CD.md).

**Status:** automatische CI actief als repositoryconfiguratie; deployment blijft bewust geblokkeerd tot provider- en launchgates zijn geverifieerd.

## Doel

De workflow `.github/workflows/ci.yml` vervangt de providerafhankelijke prototypeworkflow. Automatische pull-request- en `main`-checks gebruiken geen providercredentials en sturen geen writes naar externe database-, storage-, payment-, fulfilment-, mail- of OAuth-providers.

De toolchain is vastgezet op:

- Bun `1.3.3`;
- Node.js `22.16.0` voor scripts die expliciet `node` gebruiken;
- installaties met `bun install --frozen-lockfile`;
- PostgreSQL `16.4` als lokale CI-compatibiliteitsvloer.

De gedeelde installatiestap staat in `.github/actions/setup-buildy/action.yml`. Zij controleert de Bun-versie, hergebruikt alleen de Bun-downloadcache en verifieert dat install de dependency manifests niet wijzigt. `node_modules` wordt niet als artifact of cache gedeeld.

Alle externe GitHub Actions zijn vastgezet op de volledige commit-SHA van een expliciete release; de leesbare releaseversie staat ernaast als commentaar. Playwright-browsers worden per job geïnstalleerd en bewust niet gecachet, zodat browser- en OS-dependencies altijd als één compatibele set worden opgebouwd.

## Automatische gates

| Job | Gate | Externe secrets/netwerk |
|---|---|---|
| `Typecheck and lint` | TypeScript, volledige ESLint en `--max-warnings=0` op gewijzigde bronbestanden | Geen secrets |
| `Vitest` | Unit-, contract- en servertests | Geen secrets |
| `Production build` | Viteproductiebundle, sitemap/robots en verwacht outputcontract | Alleen een niet-geheime, niet-routeerbare `VITE_SITE_URL`; geen browserproviderconfig |
| `Dependency audit` | `bun audit --audit-level=high`; high/critical of onbereikbare advisoryservice faalt gesloten | Uitgaand netwerk naar de Bun advisoryservice, geen secrets |
| `PostgreSQL migration validation` | SQL-discovery, checksumledger, advisory lock, dry-run, apply, volledige 43-tabellen/38-RLS-verificatie, geïsoleerde workerrollen inclusief Stripe en Peecho, echte state-machine-integratietests en idempotente replay op schone Postgres | Ephemerale lokale servicecredentials, geen providersecret |
| `Public Playwright E2E` | Expliciete publieke landing/auth-shellroutes tegen exact het gebouwde artifact, zonder skips | Geen secrets of externe provider |
| `CI gate` | Stabiele branch-protectioncheck die alle automatische jobs op `success` eist | Geen |

De workflow annuleert oudere runs voor dezelfde pull request/ref en heeft uitsluitend `contents: read`-rechten.

### Lintbeleid tijdens migratie

De repository bevat bekende legacywaarschuwingen. De volledige lint blijft zichtbaar en faalt op errors volgens de ESLintconfiguratie. Daarnaast moeten alle in een pull request/push gewijzigde JavaScript- en TypeScriptbestanden volledig warningvrij zijn. Zo groeit de schuld niet en wordt legacycode bij aanraking opgeschoond, zonder een los CI-ignorebestand.

### Dependency-audit

High en critical advisories blokkeren. Een netwerkstoring van de advisoryservice blokkeert eveneens; er is geen `continue-on-error`. Een uitzondering mag alleen als expliciet, tijdgebonden en gereviewd repositorybesluit worden toegevoegd — nooit als stil workflowflagje.

## Migrationvalidatie

Alleen `db/migrations/*.sql` is de production-migrationbron. Verwijderde providermigraties zijn geen onderdeel meer van de working tree; de gecontroleerde eenmalige import gebruikt een expliciete tabelallowlist en versleutelde artifacts.

`db/migrate.ts` is de enige execution path. De SQL-bestanden bevatten bewust geen buitenste `BEGIN`/`COMMIT`: de runner bezit de transactiegrens en voert elke pending migration plus ledgerinsert atomair uit. Een fout rolt die migration en haar ledgerregel samen terug; eerder afgeronde migrations blijven hervatbaar.

De runner:

1. leest uitsluitend de expliciete `DATABASE_MIGRATION_URL` en gebruikt nooit `DATABASE_URL` als fallback;
2. accepteert alleen reguliere, niet-gesymlinkte UTF-8-bestanden met een unieke, oplopende `0001_veilige_naam.sql`-prefix en hasht de exacte bytes met SHA-256;
3. weigert onder andere top-level transactiecommando's, psql-metacommands, clusterbrede rol/database/configuratiewijzigingen, niet-transactionele `CONCURRENTLY`/maintenance-statements en directe ledger- of advisory-lockmanipulatie;
4. controleert dat de directe URL werkelijk uitkomt op de genoemde PostgreSQL 16+-database en -gebruiker en weigert een rol met `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION` of `BYPASSRLS`;
5. neemt één begrensde, exclusieve advisory lock en valideert daarna `buildy_meta.schema_migrations`, inclusief primaire key, unieke sequence en onveranderde hashes;
6. faalt vóór nieuwe project-DDL bij een verwijderde/hernoemde migration, onbekende ledgerregel, gewijzigde hash of terugwerkende pending migration;
7. stelt per migration lokaal `search_path`, `lock_timeout`, `statement_timeout` en `idle_in_transaction_session_timeout` in;
8. ondersteunt `--check` zonder database en een read-only plan met `--dry-run`.

De SQL-scanner is een fail-fast reviewgate, geen SQL-sandbox: een migration kan bijvoorbeeld dynamische SQL in een `DO`-blok uitvoeren. De dedicated least-privileged rol en verplichte review op `db/migrations/` blijven daarom de echte bevoegdheidsgrens.

`db/verify.ts` neemt een gedeelde advisory lock en controleert in één read-only, repeatable-read snapshot:

- volledige lokale/ledger-pariteit en nul pending migrations;
- exact 43 verwachte tabellen in `public`;
- exact 38 RLS-tabellen; alleen de vier Better Auth-kerntabellen zijn uitgezonderd;
- `pgcrypto`, vereiste functies en beveiligde `SECURITY DEFINER`-search paths;
- vereiste/actieve integriteitstriggers en uitsluitend gevalideerde constraints;
- de vaste structuur van de migrationledger.

CI bouwt eerst een ephemerale `NOSUPERUSER`-migrationrol, voert daarna `--check`, `--dry-run`, apply en verify uit, en herhaalt apply plus verify. Die tweede apply moet aantoonbaar een succesvolle no-op zijn. Er wordt geen raw `psql`-loop en geen impliciete Drizzle-journal gebruikt.

Drizzle blijft de typesafe schema-/querytool en kan nieuwe SQL helpen genereren, maar `db/migrations/*.sql` plus de gehashte Buildy-ledger zijn de deploymentwaarheid. `drizzle-kit migrate` mag deze runner niet vervangen; de Drizzle-metajournal is geen productieledger.

PostgreSQL `16.4` is de CI-compatibiliteitsvloer. Voor staging/productie blijven daarnaast verplicht: directe TLS migration-connection, verse branch/restore point of back-up, beschermde approval, apply met geannuleerde-cancel uitgeschakeld, verify/readback en een vooraf bepaald rollback- of forward-fixpad.

## Publieke browsertests

Het CI-buildartifact bevat tijdelijk deze gereserveerde, niet-geheime waarden:

- geen legacy database- of storagevariabelen; de browserbundle praat uitsluitend
  met de same-origin typed Buildy API;
- `VITE_SITE_URL=https://ci.buildy.invalid`.

De geselecteerde Playwright-scenario's doen geen login, providerwrite of bestelling. De selectie omvat de marketingpropositie, mobiele navigatie, publieke headernavigatie, 404, login-/registratieshell, veilige `next`-redirect en wachtwoordherstelshell. Nul gevonden tests of één skip maakt de job rood. Gebruik nooit echte preview- of productiesecrets in automatische PR-runs.

## Beschermde staging/auth E2E

Echte auth/provider-E2E draait niet automatisch op pull requests. De job `Protected staging and auth E2E` start alleen via `workflow_dispatch` wanneer `run_staging_e2e=true` is gekozen.

Vereisten:

1. expliciete `staging_base_url` met uitsluitend een HTTPS-origin;
2. een beschermd GitHub Environment met de exacte naam `staging-e2e`;
3. environmentsecret `PLAYWRIGHT_STORAGE_STATE_JSON`, gemaakt met een synthetische staginguser;
4. eventuele reviewer/approvalregels op dat environment;
5. complete stagingfixtures zodat geen test hoeft te skippen.

De workflow schrijft de storage state met mode `0600` naar `RUNNER_TEMP`, valideert dat sessiecookies/origins bestaan en toont de JSON nooit. Ontbrekende of ongeldige configuratie faalt. Na de suite faalt iedere skip eveneens. Gebruik nooit een productiesessie, productieclone of echte klantdata.

De helper controleert de HttpOnly-cookie-backed Better Auth-sessie via de same-origin sessieroute. De beschermde job blijft desondanks geblokkeerd totdat een uitsluitend synthetische staginguser, storage state en geïsoleerde fixtures beschikbaar zijn; een groene run door stil overslaan is nadrukkelijk niet toegestaan.

## Artifacts en retentie

- Gebouwde `dist`: 7 dagen, uitsluitend overdracht naar de publieke E2E-job.
- Playwright HTML-report, traces, screenshots en testresultaten: 14 dagen.
- Storage state en andere secrets worden nooit geüpload.
- CI-artifacts zijn geen deploymentartifact en mogen niet handmatig naar productie worden gekopieerd.

## Branch protection

Maak `CI gate` de verplichte check voor `main`. Aanbevolen aanvullende vereisten:

- minimaal één review;
- CODEOWNERS-review voor `.github/`, `db/migrations/`, auth, storage en ordercode;
- geen force-push naar `main`;
- conversaties opgelost;
- branch moet actueel zijn vóór merge.

De handmatige stagingjob is geen algemene PR-check. Voor een releasecandidate wordt de volledige workflow handmatig met staging-E2E gestart en moet ook die job groen zijn.

## Deploymentbeleid

Deze workflow deployt bewust niet. Een latere CD-workflow mag pas worden toegevoegd wanneer Vercel-, Neon-, R2-, Better Auth-, Stripe-, Peecho- en Brevoconfiguratie werkelijk via CLI/API en dashboard is geverifieerd.

Minimale CD-volgorde:

1. alle automatische gates en beschermde staging-E2E groen;
2. provideraccount-ID's en environment expliciet controleren;
3. Neon restore point/branch en migrationplan bevestigen;
4. immutable build/deployment aanmaken zonder secrets in logs;
5. staging smoke, daarna handmatige production approval;
6. production migration met lock/timeouts en readback;
7. deploy/canary, health/privacy/order smoke en observabilitycontrole;
8. rollback of gecontroleerde forward fix volgens het architectuurbesluit.

Gebruik voor iedere databaseomgeving een eigen workflowconcurrencygroep, bijvoorbeeld `production-database-migration`, met `cancel-in-progress: false`. Zo kan een reeds gestarte transactie niet door een nieuwere deploymentrun worden afgebroken. De runtime pooled `DATABASE_URL` hoort niet in de migrationstap of haar environment; alleen de environment-protected directe `DATABASE_MIGRATION_URL` wordt daar beschikbaar gemaakt.

Previewdeployments krijgen eigen branches/prefixes en sandboxconfig. Een succesvolle CI-run is nooit op zichzelf toestemming voor productie, live betalingen of fulfilment.

## Lokale equivalenten

```bash
bun --version
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test
bun run build
bun audit --audit-level=high
bunx tsx db/migrate.ts --check
bunx playwright test tests/e2e/discovery.e2e.ts tests/e2e/auth.e2e.ts --project=chromium
```

SQL wordt lokaal alleen tegen een expliciete tijdelijke PostgreSQL 16+-database en dedicated migrationrol uitgevoerd. Gebruik nooit een impliciete `DATABASE_URL` uit `.env`:

```bash
export DATABASE_MIGRATION_URL='postgresql://buildy_migrator:<tijdelijk-wachtwoord>@127.0.0.1:5432/buildy_dev_migrations?sslmode=disable'
bunx tsx db/migrate.ts --dry-run
bunx tsx db/migrate.ts
bunx tsx db/verify.ts
unset DATABASE_MIGRATION_URL
```

De gewenste package-scriptaliases zijn `db:migrate` → `tsx db/migrate.ts`, `db:migrate:check` → `tsx db/migrate.ts --check`, `db:migrate:dry` → `tsx db/migrate.ts --dry-run` en `db:verify` → `tsx db/verify.ts`. Tot die aliases in `package.json` zijn gereconcilieerd, zijn de expliciete `bunx tsx`-commando's hierboven leidend.
