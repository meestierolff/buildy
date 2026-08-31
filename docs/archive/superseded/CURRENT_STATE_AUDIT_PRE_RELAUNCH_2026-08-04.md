# Buildy — audit van de huidige staat

> **Historische snapshot — geen actieve instructie.** Dit document beschrijft
> de repository vóór de huidige relaunch en bevat inmiddels vervangen
> architectuur-, provider-, test- en launchbevindingen. Gebruik het niet voor
> setup of releasebeslissingen. Zie [`../../../README.md`](../../../README.md) voor de
> actuele documentatieroutes.

Datum audit: 4 augustus 2026

Repository: `meestierolff/buildy`

Branch: `codex/buildy-production-relaunch`

## 1. Doel, scope en bewijskracht

Dit document legt de toestand vast vóór de production-grade herbouw. Het is een read-only beoordeling van de actieve applicatiecode, databasegeschiedenis, tests, CI, scripts, configuratie, documentatie, providerintegraties en de browserbaseline.

De audit combineert:

- inspectie van alle tracked applicatie-, test-, migratie-, script- en configuratiebestanden;
- lokale typecheck-, lint-, test- en buildcommando's;
- een niet-destructieve launch-check tegen de geconfigureerde omgeving;
- de bestaande Playwright-suite en haar HTML-/failure-artifacts;
- 102 baseline-screenshots in `artifacts/baseline/`;
- een actuele `bun audit`;
- een browserprobe van de huidige live referentie.

Geen geslaagde compileer- of HTTP-status wordt in dit document behandeld als bewijs dat een gebruikersflow, providertransactie of productieomgeving correct werkt. Waar productiecredentials, provideraccounts of service-role toegang ontbraken, staat dat expliciet als onbekend vermeld.

## 2. Samenvattend oordeel

De repository bevat veel waardevolle productlogica en een omvangrijke oude BaaS-provider-databasegeschiedenis, maar is op dit moment **NO-GO voor publieke productie en echte betalingen**.

Belangrijkste redenen:

1. De verplichte doelarchitectuur — Vercel Functions, Neon/Drizzle, private R2-storage en Brevo — is nog niet aanwezig.
2. De huidige live referentie antwoordt met HTTP 200, maar rendert in de browser een leeg scherm. HTTP-bereikbaarheid is dus geen applicatiegezondheid.
3. De canonieke Vitest-opdracht faalt 6 van 60 tests, terwijl `bun test` door een andere runner ten onrechte volledig groen lijkt.
4. De browserbaseline eindigt op 26 geslaagde, 5 overgeslagen en 1 mislukte Playwright-test; authenticated ownerflows zijn niet aantoonbaar afgedekt.
5. `bun audit` rapporteert 53 advisories, inclusief 1 critical en 25 high.
6. De live launch-check slaagt slechts 10 van 13 controles: het publieke domein resolveert niet, Google OAuth is daardoor niet bereikbaar en de order-schemacontrole geeft HTTP 400.
7. CI kan bij ontbrekende secrets terugvallen op een in Git vastgelegde oude BaaS-provider-configuratie en gebruikt gedeelde, niet-synthetische backendrecords.
8. Provider-, mail-, monitoring-, backup-, cron- en incidentprocessen zijn niet als production-grade infrastructuur geïmplementeerd of aantoonbaar getest.

## 3. Repository-inventaris

### 3.1 Applicatie

De huidige frontend is een React 18 SPA met TypeScript, Vite, Tailwind CSS en shadcn/Radix-componenten.

| Onderdeel | Aangetroffen |
|---|---:|
| Componentbestanden onder `src/components/` | 79 |
| Paginabestanden onder `src/pages/` | 19 |
| Hooks onder `src/hooks/` | 4 |
| Bibliotheekmodules onder `src/lib/` | 8 |
| Integratiebestanden onder `src/integrations/` | 3 |
| Vitest testbestanden | 9 plus `setup.ts` |
| Playwright specs | 6 plus `helpers.ts` |
| oude BaaS-provider SQL-migraties | 62 |
| oude BaaS-provider Edge Functions | 6 plus 2 gedeelde modules |
| Repositoryscripts | 5, inclusief de baseline-capture |

De twee grootste actieve pagina's zijn:

- `src/pages/Photobook.tsx`: 2.580 regels;
- `src/pages/TripDetail.tsx`: 948 regels.

Dit bevestigt dat met name Bouwboek en projectdetail te veel datafetching, domeinlogica en UI-verantwoordelijkheden in één module combineren.

### 3.2 Routes

`src/App.tsx` definieert 16 concrete routes en één wildcardroute:

| Route | Huidige pagina / functie | Observatie |
|---|---|---|
| `/` | `Index` | Landing en publieke ontdekking gecombineerd |
| `/auth` | `Auth` | Login, registratie, magic link en Google via oude prototypeprovider |
| `/wachtwoord-vergeten` | `ForgotPassword` | oude BaaS-provider resetmail |
| `/wachtwoord-resetten` | `ResetPassword` | oude BaaS-provider sessie-/passwordflow |
| `/account` | `AccountSettings` | Account, privacy en deleteflow |
| `/trips/new` | `NewTrip` | Legacy `trip`-terminologie |
| `/trip/:id` | `TripDetail` | Overzicht, tijdlijn, foto's en plattegrond |
| `/trip/:id/photobook` | `Photobook` | Editor, preview, PDF en checkout |
| `/trip/:id/budget` | `Budget` | Projectbudget |
| `/favorieten` | `Favorites` | Feitelijk gevolgd/feed; terminologie is inconsistent |
| `/vrienden` | `Friends` | Ontdekken, volgen en verzoeken gecombineerd |
| `/profile/:userId` | `Profile` | Publiek/privé profiel |
| `/bestelling/:orderId` | `OrderConfirmation` | Orderstatus/retourroute |
| `/voorwaarden` | `Terms` | Juridische placeholder-/waarschuwingsstatus |
| `/privacy` | `Privacy` | Beschrijft huidige leveranciers en open besluiten |
| `/herroeping` | `Withdrawal` | Maatwerk-/herroepingsinformatie |
| `*` | `NotFound` | SPA 404 |

Er zijn nog geen nieuwe routes zoals `/project/:id`, redirects vanaf legacy `/trip/...`, afzonderlijke dashboard-/connectie-/notificatiepagina's, support, contentbeleid, feedback of moderatiemelding.

### 3.3 Werkboom tijdens de baseline

De branch was niet volledig schoon door doelbewust aangemaakte baseline-artifacts:

- `GOAL.md`;
- `artifacts/baseline/`;
- `scripts/capture-baseline.mjs`.

De buildbaseline wijzigde tijdelijk het tracked `public/sitemap.xml`; dat gegenereerde neveneffect is na bewijsverzameling teruggezet naar de oorspronkelijke inhoud.

Deze audit heeft geen bestaande gebruikerswijzigingen overschreven.

## 4. Huidige architectuur en dependencies

### 4.1 Runtime

De huidige architectuur is browser-to-oude BaaS-provider:

```text
React/Vite SPA
  ├─ oude BaaS-provider Auth
  ├─ oude BaaS-provider PostgREST/RPC
  ├─ oude BaaS-provider Storage
  ├─ oude BaaS-provider Edge Functions
  ├─ oude prototypeprovider OAuth broker
  ├─ oude prototypeprovider AI Gateway
  ├─ Stripe REST/Checkout via Edge Functions
  └─ Peecho REST/pingback plus legacy clientwidget-helpers
```

Actieve providerafhankelijkheden zijn onder meer:

- `oude browser-SDK`;
- `oude OAuth-wrapper`;
- `oude componenttagger`;
- browser-side `jspdf`;
- Stripe- en Peecho-aanroepen vanuit oude BaaS-provider Edge Functions.

De doelafhankelijkheden voor Neon, Drizzle, Vercel Functions, Cloudflare R2/S3 en Brevo ontbreken. Ook ontbreken `db/`, `api/`, `scripts/setup/`, `drizzle.config.ts`, `vercel.json` en provider-neutrale serveradapters.

### 4.2 Package management

`package.json` bevat 57 runtime- en 24 devdependencies en 14 scripts. Er staan drie lockfiles in Git:

- `bun.lock` — de actuele Bun-lockfile;
- `bun.lockb` — een veel oudere binaire Bun-lockfile;
- `package-lock.json` — npm lockfile v3.

Risico's:

- onduidelijk welke package manager normatief is;
- GitHub Actions gebruikt `bun-version: latest`;
- `packageManager` en `engines` ontbreken;
- de Playwright-browsercache hasht de oude `bun.lockb` in plaats van de actieve `bun.lock`;
- npm- en Bun-audits zien aantoonbaar verschillende dependencygrafen.

### 4.3 Aangetroffen configuratiezwaktes

- `vite.config.ts` bevat een hardcoded oude BaaS-provider endpoint- en publishable-tokenfallback. Daardoor slaagt een build zonder expliciete environmentconfiguratie en kan een PR onbedoeld een gedeelde backend benaderen.
- De oude prototypeprovider component tagger is nog actief in development.
- De Vite HMR-overlay staat uit en kan ontwikkelfouten minder zichtbaar maken.
- `tsconfig.app.json` heeft `strict: false`, `noImplicitAny: false`, geen effectieve strict-nullcontrole en `skipLibCheck: true`.
- `tsconfig.node.json` typecheckt alleen `vite.config.ts`; Playwright, Vitest, Tailwind, scripts en Edge Functions vallen erbuiten.
- ESLint behandelt expliciete `any` alleen als warning en lint geen `.mjs`-, SQL- of stylebestanden.
- Er is geen centraal, getypeerd env-schema en geen fail-closed startupvalidatie.

## 5. Database- en backendsamenvatting

### 5.1 Statisch bekende schema-oppervlakte

De gegenereerde oude BaaS-provider-types noemen twintig tabellen:

- `profiles`;
- `trips`;
- `trip_private_info`;
- `trip_budgets`;
- `steps`;
- `step_media`;
- `step_budget`;
- `step_contractor_info`;
- `comments`;
- `likes`;
- `reactions`;
- `favorites`;
- `follows`;
- `user_follows`;
- `notifications`;
- `photobook_settings`;
- `photobook_excluded_media`;
- `photobook_excluded_steps`;
- `photobook_orders`;
- `photobook_order_events`.

Bekende RPC's in dezelfde typesnapshot zijn onder meer:

- `can_view_trip`, `can_view_step`, `can_view_budget`;
- `get_profiles_basic`, `get_trip_access_info`, `search_profiles`;
- request/respond-RPC's voor project- en userfollows.

De 62 SQL-migraties bevatten historisch 27 `CREATE TABLE`-, 55 functie-, 40 trigger-, 144 policy-, 26 RLS-enable- en 22 indexstatements. Dit zijn aantallen over de volledige migratiegeschiedenis en **geen bewijs van de uiteindelijke live toestand**: objecten kunnen later zijn gewijzigd of verwijderd.

### 5.2 Edge Functions

Aangetroffen functies:

- `create-photobook-checkout`;
- `stripe-webhook`;
- `peecho-pingback`;
- `cleanup-photobook-retention`;
- `delete-account`;
- `floorplan-blueprint`.

De repository bevat nuttige logica voor ownershipchecks, Stripe-signatures, Peecho-statusmapping, order-idempotentie, PDF-retentie, accountcleanup en AI-quota. Vijf functies hebben in `verwijderde providerconfig` `verify_jwt = false` omdat zij webhook-, cron- of eigen authvalidatie uitvoeren. Dit vereist per functie integratietests; broncode-inspectie alleen is onvoldoende.

### 5.3 Wat live wel en niet is bewezen

De launch-check kon de geconfigureerde oude BaaS-provideromgeving bereiken en bevestigde:

- publieke projectquery werkt als anonieme gebruiker;
- notifications en privé-adresgegevens leverden geen anonieme rijen;
- e-mailauth, magic links en registratie staan aan;
- checkout, AI, accountdelete en cleanup weigeren anonieme verzoeken;
- Stripe- en Peecho-webhooks weigeren ongeldige signatures.

Niet bewezen:

- dat alle 62 migraties live in exact dezelfde volgorde zijn toegepast;
- dat alle RLS-policies en constraints de repositoryversie volgen;
- dat storagebuckets vrij zijn van publieke privémedia en orphans;
- dat alle sociale foreign keys gevalideerd zijn;
- dat accountdelete en cleanup onder partiële fouten herstellen;
- dat backups, PITR, regio en retentie correct zijn ingesteld.

De `photobook_orders`-launchprobe gaf HTTP 400. De precieze response is niet als bewijs van één oorzaak gebruikt, maar de uitkomst is wel een concrete indicatie van schema- of deploydrift.

De read-only asset- en social-audits konden niet worden uitgevoerd omdat `LEGACY_SOURCE_ADMIN_KEY` niet beschikbaar was. Zij eindigden beide met exitcode 2 zonder data te wijzigen.

## 6. Waardevolle logica die behouden moet blijven

Een providermigratie rechtvaardigt geen big-bang productrewrite. De volgende logica is aantoonbaar waardevol en moet als gedrag worden behouden, opnieuw getypeerd en getest:

### Projecten en updates

- projectownership en public/private zichtbaarheid;
- tijdlijn op datum en renovatiefase;
- mijlpalen;
- updates toevoegen en bewerken;
- mediagroepering, covers en voor/na-koppelingen;
- client-side bestandstype-/groottelimieten en beeldcompressie;
- stabiele storage-pathnormalisatie en path-traversalchecks.

### Social en toegang

- afzonderlijke projecttoegang en user-followrelaties;
- pending/accepted-statussen en response-RPC's;
- comments, reactions en notifications;
- privacyregels waardoor een profielrelatie niet automatisch projecttoegang geeft;
- publieke basisprofiel-readmodels.

### Plattegrond en budget

- meerdere plattegronden en floorplan-assets;
- pins/locatiecontext binnen het renovatieproject;
- budgettotalen en updategebonden kosten;
- scheiding van privé-adres-, aannemer- en budgetinformatie.

### Bouwboek, betaling en fulfilment

- automatische Bouwboekopbouw uit projectupdates;
- uitsluitingen en layoutoverrides;
- minimum/even pagina-aantallen;
- browser-side PDF-opbouw als referentiegedrag, niet noodzakelijk als eindarchitectuur;
- PDF-magic-bytes-, trailer-, formaat- en bereikbaarheidchecks;
- immutable checkout snapshot met prijs, verkoper, levering en voorwaardenversie;
- Stripe-sessionvalidatie, signaturecontrole en monotone betaalstatus;
- idempotente Peecho-create/paymentretry met bestaand provider-ID;
- mapping van productie-, verzend-, review- en foutstatussen;
- retention- en cleanupbeslissingen;
- blokkeren van accountdelete bij actieve fulfilment.

Deze logica moet migreren naar één canonical page/documentmodel, een eigen server-API, provideradapters en transactionele/outboxprocessen. Oude publieke PDF's, de Peecho-widget en clientvertrouwen mogen niet worden behouden.

## 7. Testinventaris en exacte baseline

### 7.1 Typecheck en lint

| Commando | Exit | Resultaat |
|---|---:|---|
| `bun run typecheck` | 0 | Slaagt onder de huidige, zwakke TypeScriptinstellingen |
| `bun run lint` | 0 | 149 warnings, 0 errors |
| `bun run lint -- --max-warnings=0` | 1 | ESLint weigert de 149 warnings bij een nulgrens |

De meeste waarschuwingen zijn expliciete `any`-types in `Photobook`, `TripDetail`, `Friends`, `Favorites`, `Budget`, `Profile`, settings en Edge Functions.

### 7.2 `bun test` is niet hetzelfde als `bun run test`

Dit verschil is een kritieke baselinebevinding:

| Commando | Runner | Uitkomst |
|---|---|---|
| `bun test` | Buns ingebouwde runner | 60 geslaagd, 0 mislukt |
| `bun run test` | `vitest run` volgens `package.json` | 54 geslaagd, 6 mislukt |

`bun test` volgt `vitest.config.ts` en de jsdom-setup niet op dezelfde manier en mag daarom niet als canonieke projectgate worden gebruikt.

De zes echte Vitest-fouten zijn:

- twee `peecho.test.ts`-tests: jsdoms `Blob.slice()` levert geen object met de verwachte `arrayBuffer()`-implementatie;
- vier `photobookCheckout.test.ts`-tests: `readFileSync(new URL(..., import.meta.url))` krijgt onder Vitest/jsdom geen `file:`-URL.

De negen testbestanden bevatten veel waardevolle pure checkout-, privacy- en pathchecks, maar ook beperkingen:

- meerdere securitychecks zijn stringasserties op migratie- of functiebroncode;
- `example.test.ts` test alleen `true === true`;
- er zijn geen React componenttests;
- er is geen coverageprovider of threshold;
- er zijn geen echte Neon/oude BaaS-provider-, auth-, storage-, Stripe-, Peecho- of mailintegratietests.

### 7.3 Build

`bun run build` is in een geïsoleerde tijdelijke kopie uitgevoerd en slaagde met exitcode 0. De build transformeerde 2.911 modules en waarschuwde voor chunks boven 500 kB en verouderde Browserslist-data.

Het normale buildscript is niet zuiver read-only:

- `scripts/generate-sitemap.mjs` herschrijft tracked `public/sitemap.xml` en `public/robots.txt`;
- het gebruikt de actuele datum, waardoor identieke broncode verschillende diffs kan produceren;
- backendfetchfouten worden gelogd maar niet fataal gemaakt, zodat een incomplete sitemap alsnog als geslaagde build geldt;
- dynamische resultaten zijn begrensd op 500 projecten en 500 profielen zonder paginatie.

### 7.4 Playwright

De suite telt 32 testdefinities in 6 specs. Baseline-uitkomst:

- **26 geslaagd**;
- **5 overgeslagen**;
- **1 mislukt**.

De mislukte test is de projectdetail-lightboxflow die een foto opent en met het sluitcontrol moet sluiten. De owner-afhankelijke en data-afhankelijke flows kunnen conditioneel worden overgeslagen.

Structurele risico's:

- vaste project- en user-ID's uit een gedeelde backend;
- geen lokale synthetische seed en teardown;
- follow- en budgettests kunnen gedeelde data wijzigen;
- 9 conditionele `test.skip`-locaties;
- alleen Chromium en één worker;
- veel vaste timeouts en `networkidle`;
- consolefilter negeert breed `Failed to load resource` en kan echte regressies maskeren;
- geen test voor volledige registratie, verificatie, upload, private access, sandboxbetaling, delete, export of moderatie.

### 7.5 Screenshots

`artifacts/baseline/` bevat:

- 102 PNG-screenshots;
- één `manifest.json`;
- local en live captures;
- mobile, tablet en desktop;
- 17 benoemde scenario's per omgeving/viewportcombinatie.

De scenario's omvatten landing, auth, nieuw project, eigen/publiek/privéproject, updatecomposer, voor/na, connecties, profiel, notificaties, budget, plattegrond, Bouwboek, checkout, orderstatus en accountinstellingen.

De bestandsnamen maken eerlijk zichtbaar welke captures slechts uitgelogde of niet-beschikbare states zijn, bijvoorbeeld `*-unavailable-logged-out` en `*-unauthenticated`. De 102 bestanden zijn daarom een visuele baseline, geen bewijs dat alle 102 flows functioneel zijn doorlopen.

## 8. Security- en dependencybaseline

De actuele Bun-audit rapporteert:

| Ernst | Aantal |
|---|---:|
| Critical | 1 |
| High | 25 |
| Moderate | 22 |
| Low | 5 |
| **Totaal** | **53** |

De critical raakt de vastgezette Vitestversie. Andere gemelde ketens omvatten onder meer React Router, DOMPurify via jsPDF, lodash via Recharts, PostCSS, `ws`, glob-/minimatchtooling en jsdomdependencies.

Een npm-audit op de aparte npm-lockfile gaf een veel kleiner aantal advisories. Die discrepantie is juist bewijs dat de drie lockfiles en dependencygrafen eerst moeten worden geconsolideerd; het lagere getal mag niet als weerlegging van de Bun-audit worden gebruikt.

Aanvullende securityrisico's:

- tracked hardcoded providerfallback in `vite.config.ts`;
- huidige authsessie in browser/localStorage via oude BaaS-provider;
- actieve oude prototypeprovider OAuth-broker en AI Gateway;
- geen centrale CSRF-, rate-limit- of request-ID-laag;
- geen provideraccount-ID guard voor Stripe/Peecho;
- geen CI-secret scan of dependency review;
- publieke/private media-integriteit niet live geaudit;
- geen aantoonbare structured PII-redaction of security alerts.

## 9. CI

Er is één workflow: `.github/workflows/e2e.yml`. Deze draait bij PR's en pushes naar `main`:

1. checkout;
2. Bun latest installeren;
3. `bun install --frozen-lockfile`;
4. Chromium installeren;
5. `bun run test`;
6. `bun run build`;
7. `bun run test:e2e:preview`;
8. Playwright-rapport uploaden.

Positief:

- frozen install;
- productiebuild vóór E2E;
- retries en failure-artifacts;
- HTML-rapport wordt bewaard.

Ontbrekend of defect:

- de huidige Viteststap faalt lokaal en blokkeert de workflow;
- geen typecheck of warning-vrije lint;
- geen coverage, security, secret, migration of schema drift gate;
- geen integration-, accessibility- of visual-regressionjob;
- geen Vercel previewdeploy of geïsoleerde database/storagebranch;
- geen concurrency/cancel-in-progress;
- geen minimale workflowpermissions;
- acties zijn op tags en niet op commit-SHA gepind;
- geen Dependabot/Renovateconfig.

De workflow zet `PLAYWRIGHT_STORAGE_STATE` op een secret met de naam `PLAYWRIGHT_STORAGE_STATE_PATH`, maar maakt dat bestand nergens aan. Een JSON-secret wordt als bestandspad behandeld en een lokaal pad bestaat niet op de runner. Authenticated ownertests zijn hierdoor niet betrouwbaar actief.

## 10. Environment- en secretinventaris

De lokale `.env` bestaat, is door `.gitignore` beschermd en bevat vijf aanwezige keys:

- `LEGACY_SOURCE_PROJECT_ID`;
- `LEGACY_SOURCE_PUBLIC_KEY`;
- `LEGACY_SOURCE_URL`;
- `VITE_PEECHO_SCRIPT_URL`;
- `VITE_PEECHO_BUTTON_KEY`.

Er zijn geen waarden in deze audit opgenomen.

`.env.example` bevat 40 keys voor oude BaaS-provider, Stripe, Peecho, sellergegevens, retentie en oude prototypeprovider AI. Ontbrekend voor de doelarchitectuur zijn onder andere:

- Neon runtime- en migrationconnecties;
- authkeys/sessionsecret;
- R2 account, bucket en least-privilege credentials;
- Brevo API- en templateconfig;
- Vercel/provider account-ID guards;
- `PRIMARY_DOMAIN` en environment-identiteit;
- observability- en alertconfig.

Er zijn geen `.env.local`, `.env.production` of `.env.test` en er is geen getypeerde environmentvalidator.

## 11. Documentatie-audit

### Waardevol

- `README.md` beschrijft de huidige Stripe/Peecho-orderlogica en benoemt duurzame ordermail terecht als launchblocker.
- `LAUNCH_READINESS.md` bevat een serieuze NO-GO-lijst voor consumentenrecht, privacy, retentie, DSA, GPSR en operatie.
- `.team/` bevat bruikbare historische analyses per discipline.
- `AGENTS.md` legt domeinterminologie en belangrijke bestaande bestanden vast.

### Tegenstrijdig of stale

- `AGENTS.md` verplicht oude BaaS-provider en de publieke Peecho Print Button en noemt TanStack Query v5, terwijl die dependency niet aanwezig is.
- `verwijderde providerprompt` vraagt om publieke PDF's en een directe widgetflow, in strijd met zowel de huidige checkoutcode als de nieuwe opdracht.
- `.github/copilot-instructions.md` herhaalt de oude widgetflow en verbiedt wijzigingen aan juist de legacyonderdelen die gemigreerd moeten worden.
- `verwijderd providerplan` bevat achterhaalde productstatussen en oude prototypeprovider-specifiek Stripeadvies.
- `.team/verification.md` meldt 9 unit- en 14 E2E-tests; de werkelijke suite telt 60 en 32, en Vitest faalt.
- De huidige documentatie is verspreid over root, `verwijderde providerconfig/` en `.team/`; de verplichte `docs/`-architectuur-, provider-, migration-, operations- en runbookdocumenten bestonden bij aanvang niet.

Deze bestanden mogen pas worden verwijderd nadat hun waardevolle context is overgenomen en de betreffende product slice aantoonbaar is gemigreerd.

## 12. Deployment- en providerstatus

### Vercel

Niet aanwezig:

- `.vercel/` projectlink;
- `vercel.json`;
- Vercel Functions/API-directory;
- SPA-rewrite voor directe deeplinks;
- security headers/CSP;
- cronconfig;
- environment- en accountverificatiescript;
- staging/production deploymentbewijs.

Zonder expliciete SPA-rewrite bestaat op een statische Vite-deploy een concreet risico dat directe requests naar `/auth`, `/project/...` of legacy `/trip/...` een platform-404 geven.

### Neon/Drizzle

Niet aanwezig: databaseproject, branches, `db/schema`, migrations, seeds, querylaag, Drizzleconfig, pooled/direct connection split, snapshot-/restoreprocedure of schema-check in CI.

### Cloudflare R2

Niet aanwezig: provider-neutrale storage-interface, private buckets, lifecycle, presigned upload/download, CORS per origin, checksum/readbackmigratie of least-privilege tokencheck.

### Brevo

Niet aanwezig: adapter, senderverificatie, templates, outboxworker, retry/dead-letterflow of testmail. Daardoor ontbreekt nog steeds de launch-blocking duurzame orderbevestiging.

### Stripe en Peecho

Er is veel serverlogica aanwezig in oude BaaS-provider Edge Functions, maar niet aantoonbaar:

- welk Stripe-account en welke mode gekoppeld zijn;
- of account-ID guards bestaan;
- of het webhookendpoint in het dashboard exact overeenkomt;
- welke Peecho-environment en offering actief zijn;
- of credit/invoicing en callbackconfig werken;
- of ooit een volledige gecontroleerde sandboxorder is afgerond;
- of bedragen, btw, verzending en providerquote exact reconciliëren.

Geen van deze punten mag als afgerond worden aangemerkt zonder echte providerverificatie.

### Operations

Er zijn geen aantoonbare:

- health/readiness endpoints;
- structured logs met correlation IDs en PII-redaction;
- metrics of alerts voor stuck orders, mail, cleanup en webhookbursts;
- Vercel cronstatus;
- backup-/restore rehearsal;
- incident-, operations-, order-support- of securityrunbooks;
- rollback- en provider-cutoverautomatisering.

## 13. Live referentie en browserbaseline

De huidige live referentie retourneerde tijdens de audit **HTTP 200**, maar de browserrender bleef leeg. Dit betekent:

- DNS/HTTP op die host is op zichzelf bereikbaar;
- de frontendboot, runtimeconfig, JavaScriptassets, authinitialisatie of backendafhankelijkheid werkt niet aantoonbaar;
- HTTP 200 mag niet als smoke-testsucces worden geregistreerd.

De precieze oorzaak van de lege render is nog onbekend en moet met browserconsole, networktrace en deploymentlogs worden vastgesteld. De aparte launch-check gebruikte het geconfigureerde publieke domein en kreeg daarvoor `ENOTFOUND`; dit wijst bovendien op een verschil tussen de live referentie en de standaard/geconfigureerde productie-origin.

## 14. P0-risico's

1. **Live app rendert leeg.** Publieke gebruikers kunnen ondanks HTTP 200 geen bruikbaar product zien.
2. **Doelarchitectuur ontbreekt volledig.** Er is nog geen production slice op Vercel/Neon/R2/Brevo.
3. **Canonieke unitgate faalt.** CI gebruikt de falende Vitest-opdracht; `bun test` geeft een misleidend groen signaal.
4. **Dependencybasis is onveilig en niet deterministisch.** 53 Bun-advisories en drie lockfiles.
5. **Hardcoded backendfallback.** Builds en PR's kunnen zonder expliciete configuratie een gedeelde oude BaaS-provideromgeving raken.
6. **E2E is niet geïsoleerd.** Vaste gedeelde records, conditionele skips en mogelijk muterende tests voldoen niet aan de eis uitsluitend synthetische data te gebruiken.
7. **Authenticated kernflows zijn niet bewezen.** Vijf tests worden overgeslagen en de CI-storage-stateflow is defect.
8. **Live schemadrift.** De orderprobe geeft HTTP 400; migrations en runtime zijn niet aantoonbaar gelijk.
9. **Private media en sociale integriteit zijn niet geverifieerd.** Service-role audits konden niet draaien.
10. **Provideraccounts en omgevingen zijn niet beschermd.** Geen account-ID guards of geverifieerde sandbox-/live-scheiding.
11. **Duurzame ordermail ontbreekt.** Een succesvolle betaling kan nog geen complete, bewaarbare verkoopbevestiging opleveren.
12. **Geen Vercel/deeplink/securityheaderconfig.** De deployment is niet production-ready.
13. **Geen operationele vangrails.** Geen alerts, restore rehearsal, cronbewijs of incidentrunbooks.
14. **Build is niet reproduceerbaar.** De sitemapgenerator muteert tracked output en slikt netwerkfouten.
15. **Instructies spreken elkaar tegen.** Oude oude prototypeprovider/oude BaaS-provider/Peecho-richtlijnen kunnen nieuwe implementatie terug richting legacy sturen.

## 15. Expliciete unknowns en externe blockers

De volgende informatie kan niet betrouwbaar uit de repository worden afgeleid en is niet verzonnen:

- de oorzaak van de lege live browserrender;
- het definitieve productiedomein, DNS-eigenaarschap en Vercel-project/account;
- welke oude BaaS-provider-migraties, policies, constraints en functies werkelijk live staan;
- productievolume, datakwaliteit, publieke media, orphans en auth-providerverdeling;
- oude BaaS-provider regio, plan, backup, PITR, log- en storageretentie;
- mogelijkheid om bestaande passwordhashes naar de gekozen Neon Auth-oplossing te migreren;
- Neon project/account, EU-regio, branches en restoremogelijkheden;
- R2 account, buckets, lifecycle en credentials;
- Stripe account-ID, sandbox/live-mode, webhooks, tax-, receipt- en refundconfig;
- Peecho contract, environment, offering-ID, prijzen, quote, credit/invoicing, callbacks en GPSR-rol;
- Brevo account, senderdomain, templates en deliverability;
- juridische verkopersidentiteit, KvK/btw/contactgegevens en goedgekeurde voorwaardenversie;
- definitieve verkoopprijs, btw-/OSS-behandeling, landen, verzending en leverbelofte;
- leverancierscontracten/DPA's, subverwerkers, regio's en transfermechanismen;
- support-, moderatie-, security-, privacy- en incidentbezetting;
- een geslaagde echte Stripe/Peecho-order, Brevo-testmail of restore rehearsal.

## 16. Betrouwbare vervolgbaseline

Totdat de test- en datalaag zijn geïsoleerd, zijn de minimale lokale gates:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint -- --max-warnings=0
bun run test
bun run build
bun audit
```

Playwright mag pas als launchbewijs gelden wanneer:

- de backend synthetisch en reproduceerbaar is geseed;
- auth-storage-state werkelijk op de runner wordt aangemaakt;
- ownerflows niet conditioneel worden overgeslagen;
- tests geen gedeelde of productiegegevens muteren;
- alle 32 bestaande tests en de nieuw vereiste flows groen zijn;
- screenshots en traces buiten productbundles worden bewaard.

De volgende architectuurfase moet beginnen met één verticale slice — auth/profiel — op de nieuwe server/API/databasebasis, met datamigratie, autorisatietests en rollback vóórdat legacycode wordt verwijderd.
