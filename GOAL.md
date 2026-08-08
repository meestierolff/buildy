# Buildy production relaunch

## Doelstelling

Transformeer de bestaande Buildy-repository via een bewezen migratiepad van het huidige prototype naar een oorspronkelijke, production-grade en privacy-first sociale verbouwingsapp. Alle code-, ontwerp-, database-, security-, test- en deploymenttaken uit de aangehechte productspecificatie worden uitgevoerd en aantoonbaar geverifieerd. Werk door totdat alleen externe blokkades resteren die niet met code of beschikbare tooling kunnen worden opgelost.

## Actuele fase

Fase 4 — alle code-eigen lokale gates staan groen. Resterend zijn expliciete staging-, provider-, restore-, cutover- en fysieke-proefdrukbewijzen; publieke registratie en live checkout blijven tot die tijd fail-closed.

## Afgeronde taken

- Bestaande Git-status gecontroleerd: de repository was schoon op `main`.
- Werkbranch `codex/buildy-production-relaunch` aangemaakt.
- Duurzame Codex-goal geregistreerd.
- Dit voortgangsbestand aangemaakt.
- Volledige productspecificatie (1.996 regels) gelezen en harde launchgrenzen vastgelegd.
- Bestaande lokale baseline uitgevoerd voor typecheck, lint, unit tests, build en Playwright.
- Ontbrekende officiële Playwright Chromium-runtime geïnstalleerd.
- 102 baseline-screenshots vastgelegd voor lokaal en live, op 390×844, 768×1024 en 1440×1000, met manifest in `artifacts/baseline/`.
- Publieke live referentie read-only gecontroleerd: HTTP 200, maar de headless render bleef leeg op de oude prototypeprovider-badge na.
- Actuele officiële documentatie voor Neon Auth/Drizzle, Vercel Functions en private Cloudflare R2-presigned URLs geraadpleegd.
- Frontend/productaudit afgerond; 49 bestaande en vereiste flows zijn in een feature-paritymatrix gezet.
- Backend/securityaudit afgerond over circa 62 legacy SQL-migraties, 24 effectieve tabellen, policies/RPC's/triggers, vier storagegebieden en zes Edge Functions.
- Operations-/test-/deploymentaudit afgerond en vastgelegd in `docs/CURRENT_STATE_AUDIT.md`.
- Designnulmeting en concrete redesignacceptatie vastgelegd in `docs/DESIGN_AUDIT.md`.
- Implementatielog gestart in `docs/IMPLEMENTATION_LOG.md`.
- Architectuur-ADR geaccepteerd en auditbaseline afzonderlijk gecommit (`a080e64`).
- Bun/Node-toolchain opgeschoond en gelockt; React Router vervangen door een Wouter-compatibiliteitslaag; oude prototypeprovider-tagger en verouderde lockfiles verwijderd.
- Dependency-audit teruggebracht van 53 advisories naar nul actuele advisories.
- Productiedatamodel aangelegd met 35 enums, 43 tabellen, 38 RLS-tabellen, constraints, indexes, triggers en server-side autorisatiehelpers.
- Deterministische migratierunner gebouwd met checksumledger, advisory lock, timeouts, least-privilege/direct-URL-controle, dry-run, no-op replay en schema-verificatie.
- Better Auth-serverfundament gebouwd voor wachtwoord, e-mailverificatie, magic link, reset, optionele directe Google OAuth, veilige cookies/originchecks en database-backed rate limiting.
- PII-envelope-encryptie, key rotation en HMAC-blind indexes toegevoegd; authmail-outbox en rate-limit keys slaan geen plaintext recipient, token, auth-ID, route of IP op.
- Vercel Web API-router, typed API-client, request-ID's, privacybewuste structured logging, health/readiness en securityheaders toegevoegd.
- Private, provider-neutrale objectstorage en Cloudflare R2-adapter toegevoegd met opaque keys, korte upload-/downloadgrants, size/MIME/checksumcontrole en streamende SHA-256-verificatie.
- Provider-neutrale transactionele e-mailadapter met Brevo en lokale testsink toegevoegd.
- Provider-neutrale paymentadapter met Stripe toegevoegd, inclusief account-/environmentcontrole, server-owned checkoutregels, idempotentie en echte webhooksignaturetests.
- Oorspronkelijk design system, merkassets en responsieve app-shell aangelegd; landing en publieke ontdekking volledig herontworpen en visueel op mobiel/desktop gecontroleerd.
- Bestaande publieke medialightbox-regressie hersteld.
- Geconsolideerde CI-pipeline toegevoegd voor frozen install, typecheck/lint, unit/server tests, audit, productiebuild, PostgreSQL 16 migration apply/verify/no-op en provider-vrije Playwright-scenario's.
- Authidentiteit en profiel zijn transactioneel geprovisioneerd; de actieve frontend gebruikt Better Auth met HttpOnly same-origincookies, rate limiting, verificatie/magic-link/reset en sessierevocation zonder oude prototypeprovider-broker.
- Project-, update- en custom-fase-CRUD, discovery, followingfeed, profielrelaties, private projecttoegang, comments, reacties en notificaties gebruiken typed same-origin API's met server-side actorcontext.
- Alle actieve React-imports en browser-envvariabelen voor oude BaaS-provider/oude prototypeprovider zijn verwijderd; ongemounte legacycomponenten en de oude generated clients zijn verwijderd.
- Private R2-upload/proxy/derivativeflow, mediaworker en planning-API voor plattegronden/budget zijn aangesloten met MIME/checksum/ownership- en IDOR-tests.
- Canoniek Bouwboekdocument, deterministische server-PDF, immutable approved proof, viewer/editor, private PDF-opslag en owner-only checkout zijn geïmplementeerd.
- Server-owned prijsmatrix/seller/terms, Stripe Checkout, raw-body signed webhook, replay/out-of-orderbescherming, refund/manual-review en dedicated paymentrol zijn geïmplementeerd.
- Peecho REST v3-adapter, create/payment-scheiding, least-privilege fulfilmentworker, callbackreconciliatie, crash/timeout/retry/manual-review en orderstatusmails zijn geïmplementeerd.
- Duurzame Brevo-outbox ondersteunt auth- en juridisch volledige ordermails met repo-native HTML/tekst, AAD-gebonden decryptie, recipient blind index, deliveryledger en synthetische CI-previewartifact.
- Accountinstellingen ondersteunen actieve sessies, private checksum-ZIP-export en jobgedreven accountverwijdering met actieve-orderblokkade, assetverificatie en minimale retentie.
- Bouwboekgoedkeuring vereist nu een server-issued proof view receipt; de pagina toont de echte private PDF-proof en kan een hash-approval niet meer zonder voorafgaande viewcontrole versturen.
- Updateverwijdering is als eigen append-only saga gemigreerd in `0024_update_deletion_saga.sql`; de statische migratieketen telt nu 24 opeenvolgende migrations.
- De lokale Playwrightmatrix is opgeschoond: provider-vrije suites draaien zonder backend, backend-backed previewtests vereisen nu expliciet `PLAYWRIGHT_BASE_URL`, en de auth-/visuele verwachtingen volgen de canonieke `project`/`bestellingen`-routes.

## Volgende taken

- Staging met echte Neon-, R2-, Brevo-, Stripe-, Peecho- en eventuele Google-credentials koppelen en alle readinessprobes tegen die doelomgeving uitvoeren.
- Een echte PostgreSQL 16 apply/verify/no-op-run voor migrations `0013–0024` plus restore rehearsal en rolverificatie buiten CI aantonen.
- Domein, webhooks, scheduler/alerts en protected staging-E2E met expliciete `PLAYWRIGHT_BASE_URL` en veilige storage state uitvoeren.
- Eén echte Stripe-sandboxbetaling, Brevo-delivery, Peecho-sandboxorder en fysieke proefdruk als launchbewijs verzamelen.
- Eventuele resterende legacy-cutoverbewijzen, final delta en rollbackacceptatie afronden vóór publieke livegang.

## Teststatus

- Actuele typecheck: **PASS** — `bun run typecheck` exit 0.
- Actuele migratie-typecheck: **PASS** — `bun run migration:typecheck` exit 0.
- Actuele volledige Vitest-suite: **PASS** — 810 tests geslaagd, 20 conditionele tests overgeslagen.
- Actuele productiebuild: **PASS** — `bun run build` exit 0; grootste JS-asset 235.1 KiB raw / 67.6 KiB gzip, bundelbudget groen.
- Actuele dependency-audit: **PASS** — `bun audit --audit-level=high` meldt geen advisories.
- Actuele migratiebroncontrole: **PASS** — 24 opeenvolgende migrations statisch gevalideerd; laatste is `0024_update_deletion_saga.sql`.
- Actuele lokale Playwrightsuite: **PASS** — 35 geslaagd, 17 verwachte skips voor suites die expliciet een backend-backed `PLAYWRIGHT_BASE_URL` vereisen.
- Actuele publieke toegankelijkheid: **PASS** — `tests/e2e/public-accessibility.e2e.ts` 3/3 groen.
- Actuele synthetische visuele suite: **PASS** — `tests/e2e/quality-visual.e2e.ts` 14/14 groen.
- Lokale echte PostgreSQL-apply: **PASS t/m 0012 / EXTERNAL REMAINING** — migrations `0013–0024` zijn statisch en in CI bewezen, maar buiten CI nog niet opnieuw lokaal/staging toegepast sinds de sandbox-/quota-beperking.

- Baseline typecheck: **PASS** — exit 0.
- Baseline lint: **PASS met schuld** — exit 0, 0 errors en 149 waarschuwingen voor expliciete `any`-types.
- Baseline unit tests: **PASS** — exit 0, 60 tests geslaagd.
- Baseline build: **PASS met waarschuwingen** — exit 0; dynamische sitemapfetch niet bereikbaar, verouderde Browserslist-data en te grote chunks.
- Baseline Playwright eerste sandboxpoging: **ENVIRONMENT FAIL** — lokale poort mocht niet luisteren.
- Baseline Playwright vóór browserinstallatie: **ENVIRONMENT FAIL** — Chromium executable ontbrak.
- Baseline Playwright na browserinstallatie: **PRODUCT FAIL** — exit 1; 26 geslaagd, 5 auth-afhankelijk overgeslagen, 1 bestaande failure: medialightbox opent niet in de publieke projecttest.
- Visuele baseline: **CAPTURED** — 102/102 screenshots, geen capturefailures. Authenticated/owner-only bewijs ontbreekt omdat geen veilige synthetische storage state of testcredentials beschikbaar waren.
- Security dependencybaseline: **FAIL** — `bun audit` exit 1 met 53 advisories (1 critical, 25 high, 22 moderate, 5 low).
- Legacy launchcheck: **FAIL** — exit 1; 10/13 controles groen, publiek domein/Google niet bereikbaar en orderschemaprobe HTTP 400.
- Legacy private-asset-/socialaudit: **BLOCKED** — beide exit 2 door ontbrekende afgeschermde service-role credential; geen data gewijzigd.
- Actuele dependency-audit: **PASS** — `bun audit` exit 0, geen advisories.
- Migratiebroncontrole: **PASS** — de runner valideert nu 24 migrations, inclusief de update-deletion-saga.
- Migratierunnerunittests: **PASS** — 31 runner-/contracttests vóór de tweede migration; bijgewerkte suite opnieuw groen.
- Nieuwe serverfoundationtests: **PASS** — auth/config/outbox/rate limiting, PII-bescherming, logging, R2-contract, Brevo en Stripe zijn provider-vrij getest.
- Publieke discovery na redesign: **PASS** — 6/6 Playwright-scenario's op productiepreview, inclusief 390px overflow en tap targets.
- Lokale echte PostgreSQL-apply: **ENVIRONMENT BLOCKED** — geen lokale PostgreSQL-binaries of actieve Docker-daemon; de PostgreSQL 16 apply/verify/no-op-cyclus is daarom als verplichte CI-gate ingericht.

## Externe blokkades

- Geen veilige synthetische login/storage state beschikbaar voor de bestaande oude BaaS-provider-baseline; owner-only screenshots en tests konden niet werkelijk ingelogd worden bewezen.
- Live oude prototypeprovider-referentie geeft HTTP 200 maar rendert in headless Chromium uitsluitend een lege pagina met providerbadge.
- Neon, R2, Brevo, Stripe en Peecho accountwaarden/credentials worden nog geïnventariseerd; niets wordt verondersteld of gelogd.
- Legacy live catalogus, storageobjecten en sociale integriteit konden zonder service-role credential niet volledig worden geëxporteerd; schemafiles zijn daarom niet als live waarheid behandeld.
- Neon-, R2-, Brevo-, Stripe-, Google- en Peecho-targetcredentials ontbreken; adapters zijn fail-closed en alleen met veilige fixtures getest.
- Vercel CLI is geauthenticeerd, maar project, environmentvariabelen, domein en providerwebhooks zijn nog niet gekoppeld; er is daarom nog geen stagingdeployment geclaimd.
- Een echte Peecho-proefdruk, Stripe-sandboxbetaling, Brevo-delivery/DNS-verificatie en Neon restore rehearsal vereisen provideraccounts en blijven expliciete launchgates.

## Belangrijke architectuurbesluiten

- Geen big-bang rewrite: waardevolle bestaande productlogica blijft behouden en wordt gefaseerd gemigreerd.
- Privacy en server-side autorisatie zijn harde productgrenzen; client-side verbergen geldt niet als beveiliging.
- Productiebetalingen, printorders en destructieve productiedatamigraties blijven uit totdat hun launchgates aantoonbaar groen zijn.
- Onafgemaakte functionaliteit wordt volledig afgemaakt of via een server-side featureflag onzichtbaar gehouden.
- React/Vite blijft behouden; Vercel ondersteunt voor een frameworkloze Vite-app officiële TypeScript Functions vanuit de rootmap `api/`.
- Cloudflare R2 blijft volledig privé; presigned URLs zijn kortlevende bearer tokens en browseruploads vereisen exact-origin CORS.
- Drizzle gebruikt versioned SQL-migraties als source of truth; `push` is niet het productie-cutovermechanisme.
- Bewezen legacylogica voor order-idempotentie, Stripe-signatures, Peecho create/payment-scheiding, monotone states en deletion locks wordt geport, maar permissieve RLS en URL-/storagecoupling niet.
- Een checkout krijgt uitsluitend een immutable, content-addressed en opnieuw gehashte goedgekeurde PDF-revisie; browser/eigenaar kan de fulfilmentbytes na approval niet wijzigen.
