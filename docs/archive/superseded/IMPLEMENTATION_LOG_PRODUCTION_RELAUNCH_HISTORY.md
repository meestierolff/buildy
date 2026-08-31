# Implementatielog Buildy production relaunch

> **Historische snapshot — geen actieve instructie.** Dit log bewaart de
> chronologie van eerdere implementatiefasen, inclusief providerpaden en
> testresultaten die later zijn vervangen. Gebruik het niet als huidige setup,
> runtime- of releasewaarheid. Zie [`../../../README.md`](../../../README.md) en
> [`../../MVP_RELEASE_REPORT.md`](../../MVP_RELEASE_REPORT.md).

Dit log bevat alleen daadwerkelijk uitgevoerde werkzaamheden en verificaties. Providerstappen worden pas als voltooid gemarkeerd na echte API-, CLI- of dashboardverificatie.

## 2026-08-04 — fase 0: veilige baseline

### Repository en scope

- Startstatus gecontroleerd: schone `main`, gelijklopend met `origin/main`.
- Werkbranch `codex/buildy-production-relaunch` aangemaakt.
- Duurzame voortgang in `GOAL.md` gestart.
- De volledige aangehechte specificatie van 1.996 regels gelezen.
- Frontend/product, database/security en tests/operations parallel read-only geïnventariseerd.

### Werkelijk uitgevoerde checks

| Commando | Exit | Werkelijke uitkomst |
|---|---:|---|
| `bun run typecheck` | 0 | TypeScriptbaseline slaagt onder de huidige niet-strikte configuratie. |
| `bun run lint` | 0 | 0 errors, 149 waarschuwingen voor expliciete `any`-types. |
| `bun test` | 0 | Buns eigen runner: 60/60 tests geslaagd. Dit is niet de canonieke Vitest-gate. |
| `bun run test` | 1 | Vitest: 54 geslaagd, 6 mislukt; vier `file:`-URL-problemen en twee jsdom-Blobproblemen. |
| `bun run build` | 0 | Build slaagt; sitemapfetch viel terug, Browserslist is verouderd en chunks van circa 598 kB en 467 kB overschrijden de waarschuwinggrens. |
| `bunx playwright test` (sandbox) | 1 | Lokale testserver kon door sandboxbeleid niet luisteren op `127.0.0.1:8090`. |
| `bunx playwright test` (vóór browserinstallatie) | 1 | Alle 32 cases konden niet starten doordat Chromium ontbrak. |
| `bunx playwright install chromium` | 0 | Officiële bijpassende Chromium- en headless-shellruntime geïnstalleerd. |
| `bunx playwright test` (na installatie) | 1 | 26 geslaagd, 5 auth-afhankelijk overgeslagen, 1 echte productfailure: publieke medialightbox opent niet. |
| `bun audit` | 1 | 53 advisories: 1 critical, 25 high, 22 moderate en 5 low. |
| `bun run check:launch` | 1 | 10/13 oude-stackchecks slagen; domein/Google zijn niet bereikbaar en order-schema geeft HTTP 400. |
| `bun run audit:private-assets` | 2 | Niet uitvoerbaar zonder afgeschermde legacy service-role credential. |
| `bun run audit:social` | 2 | Niet uitvoerbaar zonder afgeschermde legacy service-role credential. |
| `curl -I <voormalige-live-referentie>` | 0 | Publieke referentie antwoordt HTTP 200. |
| `vercel whoami` | 0 | Vercel CLI is geauthenticeerd; repository is nog niet aan een project gekoppeld. |

### Visuele baseline

- Chromium heeft 102 screenshots gemaakt in `artifacts/baseline/`:
  - lokaal en de publieke live referentie;
  - 17 scenario's;
  - 390×844, 768×1024 en 1440×1000;
  - 102/102 captures zonder capturefailure.
- Er was geen veilige synthetische bestaande auth-storage-state. Owner-only scenario's tonen daarom bewust hun uitgelogde/toegangsstatus; ze gelden niet als bewijs van een geslaagde ingelogde flow.
- De live referentie gaf HTTP 200 maar renderde headless alleen een lege pagina met oude prototypeprovider-badge.

### Belangrijkste aangetroffen P0's

- Canonieke Vitest-gate is rood en wordt door `bun test` gemaskeerd.
- Hardcoded oude BaaS-provider-URL en publishable token in Vite-config kunnen een build stil tegen de oude gedeelde backend laten praten.
- 53 dependencyadvisories, inclusief critical/high runtime- en toolchainissues.
- Privéprofieltoegang is effectief symmetrisch en kan zonder expliciete goedkeuring lekken.
- Publieke legacy media en langlevende bearer-URLs voorkomen onmiddellijke privacy-intrekking.
- Een gehashte Bouwboek-PDF blijft door de eigenaar overschrijfbaar of verwijderbaar vóór fulfilment; het geprinte bestand hoeft dus niet overeen te komen met het goedgekeurde bestand.
- Project-/update-/accountverwijdering en storagecleanup zijn niet overal transactioneel of hervatbaar.
- De editorpreview en PDF-export zijn twee onafhankelijke renderers.
- Geen enkele vertical slice draait nog op Neon, Vercel API, R2 of Brevo.

### Externe status

- Vercel CLI: lokaal geauthenticeerd.
- Neon/R2/Brevo/Stripe/Peecho/Google targetcredentials: niet aangetroffen in procesomgeving of repository-envcontract.
- Geen provideractie of transactie uitgevoerd.

## 2026-08-04 — fase 1: productieplatform en eerste verticale slices

### Architectuur en database

- ADR-001, feature-paritymatrix en design system vastgelegd; auditbaseline als commit `a080e64` bewaard.
- Drizzle-schema en `0001_production_foundation.sql` toegevoegd met 35 enums, aanvankelijk 42 domein-/authtabellen en 38 defense-in-depth RLS-tabellen.
- `0002_auth_rate_limits.sql` voegt een 43e, uitsluitend interne auth-operatietabel toe. Ruwe requestkeys worden niet bewaard.
- Eigen migratierunner toegevoegd met exacte SQL-bronvalidatie, SHA-256-ledger, advisory lock, directe least-privilegeverbinding, transactie per migration, timeouts, dry-run/check/apply en veilige replay.
- `db/verify.ts` controleert de exacte tabel-/RLS-catalogus, `pgcrypto`, vereiste functies/triggers, constraints en vaste `search_path` van `SECURITY DEFINER`-functies.
- CI past migrations toe op PostgreSQL 16, verifieert het schema, eist een idempotente no-op replay en verifieert opnieuw.

### Server- en providerfundament

- Frameworkloze Vercel Web API-router, lokale Node-adapter, typed responsecontracten, typed browserclient, request-ID's, CSRF/originboundary en health/readiness toegevoegd.
- Better Auth-minimal op Drizzle/Postgres ingericht met veilige hostcookies, verification/magic-link/password-reset, sessierevocation, strikte origins en directe Google-configuratie uitsluitend bij een volledig credentialpaar.
- Authmail gaat eerst naar een durable Postgres-outbox. Recipient, actie-URL/token en auth-ID worden respectievelijk AES-256-GCM versleuteld of HMAC-geblind-indexed.
- Gedeelde auth-rate limiting gebruikt een atomaire PostgreSQL-upsert en alleen een blind index van de requestkey; denied requests verlengen het venster niet.
- Versiebeheerbare PII-encryptie en blind indexes toegevoegd met fail-closed runtimevalidatie.
- Structured JSON-logging toegevoegd met een strikt veldschema en redactie van onder meer e-mail, tokens, cookies, URL's, IP's, request bodies en secrets.
- Provider-neutrale private objectstorage plus R2-adapter toegevoegd. Opaque keys, korte grants, exacte headers, MIME/sizepolicies en bytewerkelijke SHA-256-readback zijn afgedwongen. Checksumreadback streamt om serverless geheugenpieken te voorkomen.
- Provider-neutrale e-mailadapter, lokale mailsink en Brevo-implementatie toegevoegd; providerrequests hebben timeouts, idempotency en retryclassificatie.
- Provider-neutrale paymentadapter en Stripe-implementatie toegevoegd met verwacht account, server-owned line items, environment/account mismatchcontrole, idempotency en SDK-signatureverificatie.
- `vercel.json` toegevoegd met Bun frozen install/build, regio `fra1`, API-/SPA-rewrites, immutable assetcache en securityheaders/CSP.

### Toolchain, CI en frontend

- Eén tekstuele Bun-lockfile is canoniek; oude `bun.lockb` en npm-lockfile zijn verwijderd. `bun install --frozen-lockfile` slaagt.
- Vite/Vitest/Bun-afhankelijkheden bijgewerkt en kwetsbare transitive versies vastgepind. `bun audit` rapporteert geen advisories.
- React Router verwijderd ten gunste van een kleine Wouter-compatibiliteitslaag; bestaande routecall-sites kunnen gefaseerd migreren.
- App-shell, mobiele navigatie, merk-SVG's, lokale fonts en gedeelde status-/layoutprimitives toegevoegd.
- Landing en publieke discovery herontworpen rond “Van eerste sleutel tot laatste plint”, met expliciet privacy-model en Bouwboekproductbewijs.
- Medialightbox opent weer bij de eerste foto-interactie; de gerichte publieke regressietest slaagt.
- Eén CI-workflow is nu de automatische gate voor kwaliteit, tests, audit, build, database en provider-vrije publieke E2E.

### Werkelijk uitgevoerde aanvullende checks

| Commando | Exit | Werkelijke uitkomst |
|---|---:|---|
| `bun install --frozen-lockfile` | 0 | Canonieke Bun-lockfile is reproduceerbaar. |
| `bun audit` | 0 | Geen dependencyadvisories gevonden. |
| `bun run db:migrate:check` | 0 | Twee gecommitte migrations volledig gevalideerd; lokaal buiten sandbox uitgevoerd omdat `tsx` een IPC-socket nodig heeft. |
| `bunx vitest run tests/server/runtime-data-protection.test.ts tests/server/auth-postgres-rate-limit.test.ts tests/db/migrate.test.ts` | 0 | 41/41 tests geslaagd. |
| `bunx vitest run tests/server/objectStorage.test.ts` | 0 | 9/9 private-storagecontracttests geslaagd. |
| `PLAYWRIGHT_MODE=preview ... discovery.e2e.ts` | 0 | 6/6 publieke discoverycases na redesign geslaagd. |

### Eerlijke provider- en omgevingsstatus

- Geen Neon-, R2-, Brevo-, Stripe-, Google- of Peecho-targetcredentials aangetroffen of gebruikt.
- Geen echte providerrequest, betaling, maildelivery, fulfilment of proefdruk geclaimd.
- Lokale PostgreSQL-apply kon niet worden uitgevoerd: PostgreSQL-binaries ontbreken en er is geen actieve Docker-daemon. Dezelfde apply/verify/no-op-cyclus is wel als harde PostgreSQL 16 CI-gate vastgelegd.
- Vercel CLI is geauthenticeerd, maar deze repository is nog niet aan een targetproject gekoppeld en is nog niet als stagingdeployment gevalideerd.

## 2026-08-04 — account lifecycle

- Sessiebeheer gebruikt authoritative Better Auth-primitives; sessiontokens blijven server-side en een gebruiker kan alleen eigen sessies intrekken.
- Actor-scoped, idempotente data-export toegevoegd met een private R2-ZIP, canonieke JSON, optionele checksummed media, manifestchecksum, authenticated streaming en automatische expirycleanup na zeven dagen.
- Accountverwijdering is request-time uitsluitend `deletion_pending`. Een durable worker inventariseert objecten, verwijdert en verifieert ze per lease en voert pas daarna database-redactie/tombstoning uit.
- Actieve bouwboekorders blokkeren fail-closed bij aanvraag én finale redactie. Geordende bewijs-/orderdata en append-only auditbewijs blijven minimaal behouden.
- Een dedicated accountworkerrol zonder tabel-DML, bounded leases, exponential retry en dead-letterpaden is toegevoegd; rolisolatie wordt statisch en in PostgreSQL-CI gecontroleerd.
- Accountinstellingen toont nu actieve sessies, exportstatus/download en expliciet bevestigde verwijdering met recente-login-/wachtwoord-step-up.
- Geen echte providercall uitgevoerd. Nieuwe unit-/contracttests slagen lokaal; de twee echte PostgreSQL-integratietests zijn aan de PostgreSQL 16 CI-job gekoppeld en worden lokaal zonder disposable DB-DSN bewust overgeslagen.

## 2026-08-08 — relaunch takeover en finale lokale gates

### Afgeronde reparaties

- Bouwboekapproval sluit nu echt aan op de proof-view-grens: `src/pages/Photobook.tsx` rendert de private `PhotobookProofViewer`, bewaart het server-issued `viewReceipt` en verstuurt dat verplicht mee bij goedkeuring van een exacte proof.
- De proof-contractwijziging is doorgetrokken in `src/test/photobookApi.test.ts`, `tests/server/photobook-service.test.ts` en `tests/server/photobook-http.test.ts`; verouderde mocks kregen `documentSha256` en een receipt-issuer/verifier.
- `tests/db/migrate.test.ts` kent nu de nieuwe `0024_update_deletion_saga.sql`, zodat de statische migratieketen weer overeenkomt met de werkelijke repository.
- De synthetische visuele suite mockt nu ook de private proof-PDF-route met checksum- en receiptheaders; de update-composerassertie volgt de canonieke `?update=<uuid>`-deeplink.
- De lokale Playwrightopdracht is opgeschoond: preview-/backendafhankelijke suites voor profiel, projectdetail en Bouwboek vereisen expliciet `PLAYWRIGHT_BASE_URL`, terwijl de provider-vrije auth-/quality-/a11y-gates lokaal blijven draaien.
- Het lichte thema kreeg hogere AA-contrastwaarden voor `muted-foreground` en `accent`; daarnaast gebruikt de auth-foutbanner nu donkere tekst op een rode tintachtergrond.

### Werkelijk uitgevoerde checks

| Commando | Exit | Werkelijke uitkomst |
|---|---:|---|
| `bun run typecheck` | 0 | App- en server-TypeScript groen na proof-receiptwiring. |
| `bun run test -- tests/server/photobook-http.test.ts tests/server/photobook-service.test.ts src/test/photobookApi.test.ts tests/db/migrate.test.ts` | 0 | 49/49 gerichte regressietests groen. |
| `bun run test` | 0 | Volledige Vitestsuite groen: 810 passed, 20 skipped. |
| `bun run lint` | 0 | Repositorylint volledig groen. |
| `bun run build` | 0 | Productiebundle groen; grootste JS-asset 235.1 KiB raw / 67.6 KiB gzip. |
| `bun run check:bundle` | 0 | Bundelbudget groen. |
| `bun run check:launch -- --static` | 0 | 7/7 statische launchchecks groen; 24 migrations gevalideerd. |
| `bun run migration:typecheck` | 0 | Migratie-/setup-TypeScript groen. |
| `bun run db:migrate:check` | 0 | 24 migrations statisch gevalideerd; laatste is `0024_update_deletion_saga.sql`. |
| `bun audit --audit-level=high` | 0 | Geen high/critical advisories. |
| `bunx playwright test tests/e2e/quality-visual.e2e.ts` | 0 | 14/14 synthetische visuele scenario's groen. |
| `bunx playwright test tests/e2e/public-accessibility.e2e.ts` | 0 | 3/3 publieke axe-scenario's groen. |
| `bunx playwright test` | 0 | 35 passed, 17 skipped; backend-backed previewcases vragen nu expliciet `PLAYWRIGHT_BASE_URL`. |

### Eerlijke reststatus

- Lokale code-, browser-, lint-, build-, audit- en statische migratiegates zijn groen.
- Echte staging-/providerbewijzen blijven open: Neon apply/verify buiten CI, R2 privacy/CORS, Brevo delivery/DNS, Stripe-sandboxbetaling, Peecho-sandboxorder/proefdruk, protected staging E2E, restore rehearsal en domein/webhookkoppeling.
