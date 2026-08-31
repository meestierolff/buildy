# Buildy MVP-shiprapport

Peildatum: 30 augustus 2026. Besluit: **NO-GO voor merge en productie**.

## Release-identiteit

- Startbranch: `codex/buildy-production-finish`.
- Start-SHA: `b347a63b6e953af29784bda48d0f4e0ed76c7824`.
- Finale applicatiecandidate: `ac6f21e75767aafc15533bcb091ccd26585b7ee3`.
- De commit die dit rapport toevoegt is uitsluitend een bewijscommit en kan zijn
  eigen SHA niet in zijn eigen inhoud opnemen; de exacte rapport-SHA staat in
  PR #2 en in de finale oplevering.
- Pull request: `https://github.com/meestierolff/buildy/pull/2`.
- Preview: `https://buildy-33482e26x-clarios-projects-05f6a57e.vercel.app`.
- Stabiele Preview-alias:
  `https://buildy-git-codex-buildy-produc-9fc802-clarios-projects-05f6a57e.vercel.app`.
- Productie: `https://buildy-gamma.vercel.app/` op de oude SHA
  `f5aa77d2ff2d030ed25dcebc221fb16ba216df1a`.

## Opgeleverd product

De primaire routes zijn `/`, `/auth`, `/project/nieuw`, `/project/:id`,
`/project/:id/bouwboek`, `/delen`, `/profiel`, `/privacy`, `/voorwaarden` en
`/support`. Zij vormen één flow: foto → Bouwmoment → Verhaal → delen en reageren
→ digitaal Bouwboek → feedback.

Uit de primaire navigatie en normale gebruikersflow zijn verwijderd: Ontdekken,
Volgend/Connectiesbeheer, Meldingen, budget, plattegrond, geavanceerde
mijlpalen, moderatie- en feedbackbeheer, bestellingen, checkout, betaling,
printproof en providerinstellingen. Compatibiliteitsroutes en historische data
blijven waar nodig dormant. De zichtbare authflow bevat uitsluitend Google; er
is geen invite-, wachtwoord-, magic-link- of e-mailflow.

## Product- en journeyresultaten

| Onderdeel | Lokaal/geautomatiseerd | Hosted Preview |
| --- | --- | --- |
| Landing en lokale fotodemo | Groen, inclusief on-device privacycopy en loginhandoff | HTTP 200; juiste belofte en metadata; oude budget-/drukclaims afwezig |
| Google login | Contract en Google-only UI groen | **Geblokkeerd:** Google-client ontbreekt |
| Verbouwing maken | Onboarding en private standaard groen | **Geblokkeerd:** Preview-Neon ontbreekt |
| Foto-upload | Selectie, preview, reorder/remove, voortgang, retry en foutbehoud groen | **Geblokkeerd:** private Blob en mediaworkerrol ontbreken |
| Bouwmoment | Plaatsen, bewerken en reload/persistence geautomatiseerd groen | **Geblokkeerd:** Preview-Neon/Blob ontbreken |
| Delen | Maken, kopiëren, native delen, redeem en intrekken groen | **Geblokkeerd:** Preview-Neon ontbreekt |
| Kijker | Anoniem alleen-lezen en geen editcontrols groen | **Geblokkeerd:** echte deellink en browsercontext ontbreken |
| Reactie/opmerking | Actorgrens, telling, verwijderen en eigenaarsmoderatie groen | **Geblokkeerd:** Google en Preview-Neon ontbreken |
| Bouwboek | Cover, opening, chronologie, foto's, slot, selectie/volgorde en exact twee layouts groen | **Geblokkeerd:** echte Bouwmomenten/media ontbreken |
| Feedback/printinteresse | Drie vragen plus optionele rating; opslagcontract groen | **Geblokkeerd:** Preview-Neon ontbreekt |
| Logout/herlogin | Geautomatiseerd groen | **Geblokkeerd:** Google ontbreekt |

Preview-health voor de applicatiecandidate gaf HTTP 200, `environment=preview`
en exact dezelfde volledige SHA. Het serverprofiel is correct
`feedback_beta`, `BETA_MODE=false` en `CHECKOUT_MODE=off`; invite, e-mail,
checkout en fulfilment staan uit. De providerafhankelijke capabilities falen
gesloten als `unconfigured`/`false`. De beschermde Preview stuurt anonieme
bezoekers naar Vercel SSO. De volledige bedoelde securityheaders zijn op de
echte Preview groen voor `/`, `/?x=1`, `/auth`, `/index.html` en een onbekend
SPA-pad.

## Verificatie

- `bun install --frozen-lockfile`: PASS; lockfile ongewijzigd.
- `bun run typecheck`: PASS.
- `bun run lint`: PASS.
- `bun run test`: PASS; laatste volledige applicatierun 149 bestanden groen,
  18 overgeslagen, 952 tests groen en 27 overgeslagen; daarnaast gerichte
  release-/providerregressies 14/14 groen.
- `bun run build`: PASS.
- `bun run check:bundle`: PASS; 75 JS-assets, 1 CSS-asset, 341,7 KiB gzip JS.
- `bun run check:launch -- --static`: PASS zodra dit verplichte rapport in de
  release-tree aanwezig is.
- Tijdelijke PostgreSQL 16.4: 50 append-only migrations, 23 DB-testbestanden en
  122 tests groen; 53 tabellen/45 RLS-tabellen, rolisolatie, `db:verify` en
  migratiereplay groen.
- Dependency-audit: PASS, geen kwetsbaarheden.
- Chromium desktop: 63/63 groen; mobile-Chromium kernmatrix groen.
- Firefox/WebKit lichte kernsmoke: 14/14 groen. De latere WebKit-only
  navigatiecancel van het lokale Instrument Serif-font is gericht hersteld;
  exacte test 1/1 en volledige deellinkspec 3/3 groen.
- Visuele regressies: 14/14 Darwin en 14/14 Linux groen na exact twee
  polishrondes.
- Hosted CI-run `33295400225` voor de applicatiecandidate is volledig groen:
  typecheck/lint, Vitest, productiebuild, dependency-audit,
  migratievalidatie, DB-integratie, de volledige publieke Playwrightset,
  Firefox, WebKit, mobile/tablet Chromium en de CI-gate. Alleen de bewust
  configuratieafhankelijke protected-stagingjobs zijn overgeslagen. De
  rapportcommit mag alleen worden gemerged wanneer zijn eigen PR-checkset ook
  groen is.

## Playwright MCP

De lokale browseraudit kon de zichtbare printinteresseflow bedienen zonder
console- of API-fouten. De verplichte in-app browserenumeratie voor de echte
Preview gaf exact `[]`; daarnaast is Preview met Vercel SSO beschermd. Daardoor
zijn de volledige owner-, viewer- en productiereizen niet interactief bewezen.

## Resterend P2

- Retireer of herschrijf de optionele oude Stripe-gebaseerde
  `staging-real`-workflow; gebruik die niet als gratis-MVP-bewijs.
- Vereenvoudig DB-setuptooling die nog dormant photobook-/paymentrollen maakt.
- Archiveer legacy commerce-releasedocumenten.
- Houd verborgen compatibilityroutes, discovery/followbeheer, meldingen,
  geavanceerde Bouwboekbewerking en fysiek bestellen buiten de MVP.

## Externe blokkades en operatoractie

De zeven niet-geheime Previewwaarden zijn al branch-scoped gezet: exacte
origin/trusted origin/site URL, `APP_ENV=preview`,
`PRODUCT_PROFILE=feedback_beta`, `BETA_MODE=false` en `CHECKOUT_MODE=off`.

De founder moet nu, rechtstreeks in de dashboards en zonder secrets in chat:

1. een geïsoleerde Preview-Neonbranch maken, migrations `0001`–`0050` toepassen
   en `DATABASE_URL`, `DATABASE_ACCOUNT_WORKER_URL` en
   `DATABASE_MEDIA_WORKER_URL` als unieke TLS-rollen in Preview zetten;
2. unieke Previewwaarden instellen voor de PII-keyring/blind index,
   `CRON_SECRET` en de goedgekeurde retentieversie/-datum;
3. aparte Google-webclients maken voor de stabiele Preview en productie, met
   hun exacte HTTPS-origin en `/api/auth/callback/google`, en de clientgegevens
   in de juiste Vercel-environment zetten;
4. per environment een private Vercel Blob-store koppelen en het token in
   Vercel zetten;
5. geautoriseerde toegang tot Deployment Protection en een ondersteunde
   in-app browser beschikbaar maken;
6. juridische naam, vestigingsadres, KvK indien van toepassing, rechtstreeks
   support-/privacycontact, retentiegrenzen, leeftijdsbeleid en echte
   providerregio/DPA/doorgiftefeiten goedkeuren;
7. vóór productie een backup/restorepunt maken, production-specifieke waarden
   zetten, migrations en `db:verify` uitvoeren, en `DATABASE_DIRECT_URL` plus
   `DATABASE_MIGRATION_URL` daarna uit de Vercel-webruntime verwijderen.

Daarna moeten op exact één Preview-SHA de Google-, upload-, Bouwmoment-, deel-,
kijker-, reactie/opmerking-, Bouwboek-, feedback-, logout- en herloginreizen
groen zijn. Pas dan mag dezelfde SHA naar productie en moet de rooktest op het
publieke domein worden herhaald. Tot dat bewijs is Buildy **NO-GO** voor merge
en productie.
