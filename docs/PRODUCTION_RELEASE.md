# Productierelease

Status: releaseprocedure, geen bewijs dat een release is uitgevoerd.

De huidige Buildy-snapshot is **NO-GO** voor productie. Deze procedure mag pas
naar de productiefase door wanneer alle harde gates hieronder aantoonbaar groen
zijn. Een build, merge, Vercel-URL, healthcheck of handmatige klik afzonderlijk
is geen releasebesluit.

## Onveranderlijke releasegrenzen

- Google OpenID Connect is de enige loginmethode.
- Customer-media en print-PDF's staan in een private Vercel Blob-store en worden
  uitsluitend na serverautorisatie gelezen.
- Een `unlisted` share-token leeft alleen in het URL-fragment tot body-only
  redemption, staat uitsluitend gehasht in PostgreSQL en wordt daarna vervangen
  door een signed HttpOnly link-ID-cookie. Querystrings/logs/evidence bevatten
  geen raw token of tokenhash.
- Media-completion verwerkt het exacte asset en een Bouwboekproofrequest de
  exacte revisie onder least-privilege workerrollen. Begrensde owner-polling kan
  veilig hervatten; er is geen media- of photobookcron.
- Preview gebruikt `CHECKOUT_MODE=test`; production commerce gebruikt
  `CHECKOUT_MODE=live`. Iedere mismatch of ontbrekende approval faalt gesloten.
- Alleen een geverifieerde Stripe-webhook bevestigt een betaling.
- Betaalde Bouwboeken worden vanuit `/beheer/bestellingen` handmatig bij een
  vooraf goedgekeurde drukker geplaatst.
- Er is geen e-mailprovider en geen Peecho-API, callback, worker, cron of env.
- Migrations blijven append-only; historische tabel- en kolomnamen mogen blijven.
- PII, secrets, Blob-URL's en Checkout-URL's komen niet in logs of evidence.
- Productie wordt niet als testomgeving gebruikt en krijgt geen synthetische
  mutaties vóór expliciete toestemming.

## Fase 0 — release-identiteit vastzetten

Leg in het releasebewijs vast:

1. repository, branch, commit-SHA en de te mergen pull request;
2. het exacte Vercel-project en team;
3. de exacte Preview- en uiteindelijke Production-origin;
4. doel-Neon-project, branch, regio en database zonder credentials te tonen;
5. private Blob-store, Google-client en Stripe-account-ID zonder secrets;
6. migrationledger vóór/na en het goedgekeurde rollback-/incidentvenster;
7. verantwoordelijke releaseoperator, legal/commercial approver en
   fulfilmentoperator.

Stop bij twijfel over één doel. Gebruik nooit een URL uit een lokale `.env` als
bewijs van de echte deploymentidentiteit.

## Fase 1 — externe en menselijke gates

Alle volgende punten moeten vóór productie als groen zijn afgetekend:

- Vercel-plan, voorwaarden en waar vereist DPA staan het beoogde commerciële
  gebruik toe; het in deze snapshot gekoppelde Hobby-plan is geen
  live-commerce- of verwerkersovereenkomstgoedkeuring;
- juridische entiteit, handelsnaam, registratie, btw-behandeling, vestigings- en
  supportgegevens, voorwaarden, privacy, herroeping en contentbeleid zijn door
  een bevoegde eigenaar goedgekeurd;
- de test- én live-prijsmatrix en seller-envelope hebben actuele, niet verlopen
  approvals;
- de gekozen drukker, verwerkersrol, landen, productiegrenzen, actuele quote,
  proefdruk, support-/refundpad en handmatige operatorprocedure zijn goedgekeurd;
- Neon backup/recovery, retentie, DPA/regio en least-privilege rollen zijn
  bevestigd;
- Google consent/origins/callbacks, private Blob, Stripe-account en
  webhookregistraties zijn bevestigd;
- monitoring, alerting, budgets en incident-eigenaarschap zijn geregeld;
- de verplichte interactieve Playwright MCP-audit kan daadwerkelijk draaien.

De laatste verplichte browser-runtime/tool-aanvraag werd door de huidige Codex-
gebruikslimiet afgewezen tot **2026-08-29 02:26**; een eerdere enumeratie in
dezelfde werkstroom leverde geen browsertool op. Zolang deze blokkade bestaat,
kan geen Preview- of productie-GO worden gegeven.

## Fase 2 — geïsoleerde Preview voorbereiden

Gebruik een niet-productie Neon-branch, een private Blob-store/token en Stripe
test mode. Vercel Preview is geen reden om echte klantdata of live keys te
kopiëren.

1. Maak een herstelpunt van de doel-Previewdatabase en controleer de directe,
   dedicated migratorverbinding.
2. Voer statische migrationvalidatie uit, toon het plan, pas alle migrations
   één keer toe, configureer de vijf actieve rollen en verifieer ledger/schema/
   RLS. Een tweede apply moet een no-op zijn.
3. Configureer afzonderlijke credentials voor web, accountworker, mediaworker,
   photobookworker en paymentworker. Geen rol mag table-owner, superuser,
   `BYPASSRLS` of migration-owner zijn.
4. Configureer de actieve environmentvariabelen uit [`.env.example`](../.env.example).
   Voor het providercheck-script representeert `APP_ENV=staging` het beschermde
   Preview/stagingdoel. Gebruik `CHECKOUT_MODE=test` en
   `STRIPE_ENVIRONMENT=test`. `CRON_SECRET` beschermt alleen account lifecycle;
   bevestig dat `vercel.json` geen media-/photobookschedule bevat.
5. Registreer de exacte HTTPS-origin, Google-callback
   `/api/auth/callback/google` en Stripe-webhook `/api/webhooks/stripe`.
6. Bevestig in het Vercel-dashboard dat de Blob-store private is. Bewaar geen
   provider-URL als customer-mediareferentie.
7. Deploy uitsluitend een nieuwe Vercel Preview van de vastgezette commit. Maak
   geen production deployment en wijzig geen productie-alias.

## Fase 3 — Preview bewijzen

### Automatische gates

Voer tegen de vastgezette tree minimaal uit:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test
bun run build
bun run check:bundle
bun run check:launch -- --static
bun run test:e2e
```

Voer daarnaast de volledige tijdelijke PostgreSQL-apply/configure/verify/replay
workflow en alle door CI geselecteerde integratietests als één clean-room run
uit. Eis een succesvolle GitHub Actions-run; lokale resultaten vervangen CI
niet.

Controleer providerconfiguratie read-only met de juiste environment geladen:

```sh
bun run setup:providers -- --staging --check
LAUNCH_EXPECTED_GIT_SHA="$(git rev-parse HEAD)" \
  bun run check:launch -- --staging --base-url="$PREVIEW_ORIGIN"
```

De live launchcheck accepteert uitsluitend de volledige 40-teken-SHA en eist
dat `/api/health` exact die deploymentidentiteit teruggeeft. Zet
`PREVIEW_ORIGIN` eerst op de expliciet vastgelegde HTTPS-origin.
De doelmatrix is fail-closed: `--preview` en `--staging` vereisen
`PRODUCT_PROFILE=feedback_beta`, `CHECKOUT_MODE=test` en alle zes readinesschecks
op `pass`; `--production` vereist hetzelfde profiel met `CHECKOUT_MODE=live`.
Een `public_demo`, checkout `off`, een mode-mismatch of een niet uitgevoerde
payment-/photobookworkercheck kan dus geen releasecheck passeren.

### Provider- en rolreizen

Bewijs op de exacte Previewcommit:

- real Google redirect/callback, nieuwe accountkoppeling, bestaande login,
  logout en sessierevocation;
- private Blob upload, voltooiing, checksum/size, geautoriseerde read,
  directe verwerking van exact het asset, owner-poll retry, ongeautoriseerde
  denial, delete en cleanup;
- eigenaar: Verbouwing → Bouwmoment → Verhaal → Bouwboek → locked proof;
- proofrequest → directe verwerking van exact de revisie → begrensde
  owner-editorpoll bij `rendering`, zonder cronroute;
- openbaar volgen en privéverzoek: send/cancel/accept/reject/remove/unfollow;
- vier projectvisibilities, block-revocation en geen herstel na unblock;
- Stripe test quote → Checkout → webhook → paid order, plus cancel, expiry,
  async failure, duplicate webhook en refund;
- admin-RBAC, exact-PDF-download en iedere handmatige fulfilmentovergang;
- account export/deletion, support/feedback/report en moderatie;
- accountverwijdering wist vóór anonimisering ook de gekoppelde feedbacktekst,
  contactciphertext, contacthashes en correlatievelden; anonieme inzendingen van
  anderen blijven ongemoeid;
- 390×844, 768×1024 en 1440×1000 plus Chromium, Firefox en WebKit.

### Verplichte interactieve audit

Herhaal de volledige rol-/route-/formuliermatrix in de in-app Playwright MCP-
browser. Registreer per actie origin, rolfixture, verwacht resultaat, werkelijk
resultaat, console/page errors, relevante requeststatus en echte artifacts.
Automated Playwright, een screenshot-CLI en een synthetische API-fixture zijn
geen vervanging. Zie [PLAYWRIGHT_MCP_AUDIT.md](PLAYWRIGHT_MCP_AUDIT.md).

## Fase 4 — production readiness review

Geef pas GO wanneer:

- alle Fase 0–3 evidence aan exact dezelfde commit is gebonden;
- er nul overgeslagen verplichte tests, open P0/P1-defecten, onbekende 5xx'en of
  ongeclassificeerde consolefouten zijn;
- legal, commercial, privacy, provider, hosting en fulfilment schriftelijk zijn
  goedgekeurd;
- live Stripe-configuratie afzonderlijk is gevalideerd zonder een echte order
  aan te maken;
- migrations en role grants op een productieachtige kopie zijn geoefend;
- rollback, incidentcommunicatie en operatorbezetting klaarstaan.

Voor production commerce horen `APP_ENV=production`, de exacte
`APP_ORIGIN`/`PRIMARY_DOMAIN`, `CHECKOUT_MODE=live`,
`STRIPE_ENVIRONMENT=live`, afzonderlijke live Stripe-secrets en uitsluitend
live-goedgekeurde price/seller-envelopes bij elkaar. Testdata en testkeys horen
niet in Production.

## Fase 5 — gecontroleerde productie-uitrol

Deze fase is een instructie voor een later goedgekeurd releasevenster; zij is in
de huidige snapshot niet uitgevoerd.

1. Controleer opnieuw doelproject, SHA, backup/recovery point en operatorbezetting.
2. Pas append-only migrations toe via de production migrator en verifieer
   ledger, schema, RLS en actieve rolisolatie vóór webpromotie.
3. Deploy de vastgezette artifact/commit één keer naar Production.
4. Zet `PRODUCTION_ORIGIN` op de vastgelegde HTTPS-origin en voer
   `bun run check:launch -- --production --base-url="$PRODUCTION_ORIGIN"` uit
   met `LAUNCH_EXPECTED_GIT_SHA` op de vastgezette volledige commit-SHA. De
   check eist exact die health-release, een actieve checkoutcapability en een
   geslaagde paymentworkercheck; controleer daarnaast het vastgelegde CSP-/
   providerbewijs.
5. Voer alleen de vooraf goedgekeurde, niet-destructieve productie-smoke uit:
   publiek, login, bestaande testowner-read, private denial, mediaread,
   orderread en admin-read. Maak geen echte betaling of drukkerorder zonder
   aparte expliciete toestemming.
6. Bewaak errorrate, latency, database, Blob, Stripe-webhook, request-driven
   media-/proofstatussen en de ene account-lifecyclecron gedurende het
   afgesproken observatievenster.
7. Leg deployment-ID, SHA, tijdstippen, gates, approvers en geanonimiseerde
   uitkomst vast.

## Stop en herstel

Stop of draai de webrelease terug bij iedere auth-loop, identity mismatch,
private-media- of RLS-lek, payment/account/environment mismatch, bedrag- of
valutaverschil, webhookduplicatie, proof-hashfout, admin-RBAC-lek, migration-
afwijking, brede 5xx-toename of ontbrekende readiness.

- Promoot geen nieuwe destructive/down migration. Herstel de vorige compatibele
  webartifact en laat append-only schema staan.
- Zet checkout fail-closed op `off` wanneer het betaalpad onbetrouwbaar is; dit
  is incidentmitigatie, geen geslaagde commerce-release.
- Trek gelekte provider- of databasesleutels in en roteer ze volgens het
  incidentproces.
- Markeer onzekere betaalde orders `manual_review`/`refund_review`; plaats geen
  drukkerorder.
- Behoud forensische auditmetadata zonder PII en gebruik het goedgekeurde
  backup-/restoreproces wanneer data-integriteit geraakt is.

## Harde stopcriteria

Productie blijft **NO-GO** bij één rood, onbekend of niet vastgelegd punt,
waaronder: Vercel Hobby/commercial, legal, prijs/seller, drukker/provider,
Previewenvironment, Google/Blob/Stripe-roundtrip, een aan de release-SHA
gebonden clean-room DB-herhaling, GitHub CI, Preview-cross-browser/rolreizen of
Browser MCP. Er is geen uitzondering op basis van deadline of het feit dat er
al een openbaar Vercel-adres bestaat.
