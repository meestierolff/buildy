# Productierelease

Status: releaseprocedure voor de gratis accountgebaseerde MVP, geen bewijs dat
een release is uitgevoerd. [GRAPH](architecture/GRAPH.md) en
[FLOWS](architecture/FLOWS.md) bepalen de scope; [STATE](architecture/STATE.md)
bevat het actuele bewijs en de resterende blokkade.

Ga pas naar de productiefase wanneer de toepasselijke checks hieronder
aantoonbaar slagen en de uitrol is toegestaan. Een build, merge, Vercel-URL,
healthcheck of handmatige klik afzonderlijk is geen releasebesluit. Stripe,
Peecho, fysieke bestellingen en printproofs vallen buiten deze release.

## Onveranderlijke releasegrenzen

- Google OpenID Connect is de enige loginmethode.
- Customer-media staat in een private Vercel Blob-store en wordt
  uitsluitend na serverautorisatie gelezen.
- Een `unlisted` share-token leeft alleen in het URL-fragment tot body-only
  redemption, staat uitsluitend gehasht in PostgreSQL en wordt daarna vervangen
  door een signed HttpOnly link-ID-cookie. Querystrings/logs/evidence bevatten
  geen raw token of tokenhash.
- Media-completion verwerkt het exacte asset onder een least-privilege
  workerrol. Begrensde owner-polling kan veilig hervatten; er is geen media- of
  photobookcron. Het digitale Bouwboek heeft geen printproof- of printworker nodig.
- Preview, staging en Production gebruiken `PRODUCT_PROFILE=feedback_beta`,
  `BETA_MODE=false` en `CHECKOUT_MODE=off`. Dormante commerce blijft afgeschermd.
- `public_demo` is een rollbackoptie, geen geslaagde accountgebaseerde MVP.
- Er is geen e-mailprovider en geen Peecho-API, callback, worker, cron of env.
- Migrations blijven append-only; historische tabel- en kolomnamen mogen blijven.
- PII, secrets, Blob-URL's en Checkout-URL's komen niet in logs of evidence.
- Productie wordt niet als testomgeving gebruikt en krijgt geen synthetische
  mutaties vóór expliciete toestemming.
- Gebruik CLI/API en Playwright; geen Computer Use. De eigenaar doet persoonlijke
  login en secretinvoer. Wijzig de bestaande Google-configuratie alleen met
  eigenaartoestemming; schakel auth nooit uit om een reis groen te maken.

## Fase 0 — release-identiteit vastzetten

Leg in het releasebewijs vast:

1. repository, branch, commit-SHA en de te mergen pull request;
2. het exacte Vercel-project en team;
3. de exacte Preview- en uiteindelijke Production-origin;
4. doel-Neon-project, branch, regio en database zonder credentials te tonen;
5. private Blob-store en Google-client zonder secrets;
6. migrationledger vóór/na en het goedgekeurde rollback-/incidentvenster;
7. verantwoordelijke releaseoperator en eigenaar voor hosting, privacy en
   toepasselijke voorwaarden.

Stop bij twijfel over één doel. Gebruik nooit een URL uit een lokale `.env` als
bewijs van de echte deploymentidentiteit.

## Fase 1 — externe en menselijke gates

Alle volgende punten moeten vóór productie als groen zijn afgetekend:

- de actuele Vercel-planvoorwaarden en waar vereist DPA staan het beoogde
  gebruik toe; gratis gebruik is niet automatisch niet-commercieel. Leg de
  feitelijke planstatus vast, koop geen plan zonder toestemming;
- verantwoordelijke organisatie/persoon, supportgegevens, voorwaarden, privacy
  en contentbeleid voor de gratis dienst zijn door de bevoegde eigenaar bevestigd;
- Neon backup/recovery, retentie, DPA/regio en least-privilege rollen zijn
  bevestigd;
- bestaande Google consent/origins/callbacks en private Blob zijn bevestigd;
- monitoring, alerting, budgets en incident-eigenaarschap zijn geregeld;
- echte hosted owner- en kijkersessies kunnen de kernreis uitvoeren; persoonlijke
  Google-login blijft bij de betrokken eigenaar/kijker.

Browser-toolnaam of MCP-enumeratie is geen gate. Noteer een werkelijk ontbrekende
provider, toestemming of sessie als blokkade in STATE; oude toolblokkades zijn
geen bewijs van de huidige situatie.

## Fase 2 — geïsoleerde Preview voorbereiden

Gebruik een niet-productie Neon-branch, een private Blob-store/token en checkout
`off`. Vercel Preview is geen reden om echte klantdata of productiecredentials
te kopiëren.

1. Maak een herstelpunt van de doel-Previewdatabase en controleer de directe,
   dedicated migratorverbinding.
2. Voer statische migrationvalidatie uit, toon het plan, pas alle migrations
   één keer toe en verifieer ledger/schema/RLS en de bestaande rolgrenzen. Een
   tweede apply moet een no-op zijn. Behoud de rolchecks voor dormant schema.
3. Configureer afzonderlijke runtimecredentials voor web, accountworker en
   mediaworker. Geen runtimerol mag table-owner, superuser, `BYPASSRLS` of
   migration-owner zijn. Payment- en printproofworkercredentials zijn niet nodig
   voor de gratis hosted kernreis; de bestaande CI-rolisolatietests blijven intact.
4. Configureer de actieve environmentvariabelen uit [`.env.example`](../.env.example).
   Voor het providercheck-script representeert `APP_ENV=staging` het beschermde
   Preview/stagingdoel. Gebruik `PRODUCT_PROFILE=feedback_beta`, `BETA_MODE=false`
   en `CHECKOUT_MODE=off`. `CRON_SECRET` beschermt alleen account lifecycle;
   bevestig dat `vercel.json` geen media-/photobookschedule bevat.
5. Controleer de exacte HTTPS-origin en Google-callback
   `/api/auth/callback/google`; wijzig deze alleen met eigenaartoestemming.
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
De doelmatrix vereist voor `--preview`, `--staging` en `--production`
`PRODUCT_PROFILE=feedback_beta`, `BETA_MODE=false`, `CHECKOUT_MODE=off` en
geslaagde actieve core-readinesschecks. Een `public_demo` of een ontbrekende
coreprovider kan geen MVP-releasecheck passeren. Payment- en printproofworkers
zijn dormant; hun uitgeschakelde status blokkeert de gratis release niet.

### Provider- en rolreizen

Bewijs op de exacte Previewcommit:

- real Google redirect/callback, nieuwe accountkoppeling, bestaande login,
  logout en sessierevocation;
- private Blob upload, voltooiing, checksum/size, geautoriseerde read,
  directe verwerking van exact het asset, owner-poll retry, ongeautoriseerde
  denial, delete en cleanup;
- eigenaar: privéverbouwing → drie foto's over twee Bouwmomenten → herladen →
  bewerken → delen → persoonlijk digitaal Bouwboek, inclusief bewaarde cover en
  inhoudsselectie, zonder checkout of printproof;
- kijker: alleen-lezen deellink → afzonderlijk inloggen → like/reactie →
  herladen; eigenaar trekt link in en link-afgeleide API- en mediatoegang vervallen;
- bestaande profielvolg- en blokkeerregels waar deze toegang geven, inclusief
  toegang intrekken bij follower removal/block en geen herstel na unblock;
- account export/deletion, support/feedback/report en moderatie;
- accountverwijdering wist vóór anonimisering ook de gekoppelde feedbacktekst,
  contactciphertext, contacthashes en correlatievelden; anonieme inzendingen van
  anderen blijven ongemoeid;
- 390×844, 768×1024 en 1440×1000 plus Chromium, Firefox en WebKit.

### Werkelijke hosted kernreis

Voer F1–F6 uit met echte geautoriseerde owner- en kijkersessies via de bestaande
login, hosted API, database en private Blob. Gebruik Playwright en CLI/API en
laat de betrokken gebruikers hun persoonlijke Google-login uitvoeren. Registreer
per actie origin, rol, verwacht/werkelijk resultaat, console/page errors,
relevante requeststatus en veilige artifacts. Geautomatiseerde Playwright-tests
mogen dit bewijzen; mocks en synthetische sessies bewijzen geen echte OIDC-login.
Bewaar geen persoonlijke inhoud, sessiecookies of ruwe deellinks in bewijs.

## Fase 4 — production readiness review

Geef pas GO wanneer:

- alle Fase 0–3 evidence aan exact dezelfde commit is gebonden;
- er nul overgeslagen verplichte tests, open P0/P1-defecten, onbekende 5xx'en of
  ongeclassificeerde consolefouten zijn;
- toepasselijke voorwaarden, privacy, providers en hosting door de bevoegde
  eigenaar zijn bevestigd;
- migrations en role grants op een productieachtige kopie zijn geoefend;
- rollback, incidentcommunicatie en operatorbezetting klaarstaan.

Voor de gratis production-MVP horen `APP_ENV=production`, de exacte
`APP_ORIGIN`/`PRIMARY_DOMAIN`, `PRODUCT_PROFILE=feedback_beta`, `BETA_MODE=false`
en `CHECKOUT_MODE=off` bij elkaar. Neem geen Previewdata of Previewcredentials
over in Production. Deze procedure geeft geen toestemming voor een betaalpad.

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
   check eist exact die health-release, het gratis doelprofiel en geslaagde
   core-readiness; controleer daarnaast het vastgelegde CSP-/providerbewijs.
5. Voer alleen de vooraf goedgekeurde, niet-destructieve productie-smoke uit:
   publiek, login, bestaande testowner-read, private denial, mediaread,
   digitaal Bouwboek en feedbackbeschikbaarheid. Voer productie-inlog of
   mutaties alleen binnen de gegeven toestemming uit.
6. Bewaak errorrate, latency, database, Blob, request-driven mediastatussen en
   de ene account-lifecyclecron gedurende het afgesproken observatievenster.
7. Leg deployment-ID, SHA, tijdstippen, gates, approvers en geanonimiseerde
   uitkomst vast.

## Stop en herstel

Stop of draai de webrelease terug bij iedere auth-loop, identity mismatch,
private-media- of RLS-lek, onbedoelde commerceactivatie, admin-RBAC-lek,
migrationafwijking, brede 5xx-toename of ontbrekende core-readiness.

- Promoot geen nieuwe destructive/down migration. Herstel de vorige compatibele
  webartifact en laat append-only schema staan.
- Houd checkout op `off`. Een rollback naar `public_demo` kan de publieke
  demonstratie herstellen, maar telt niet als herstel van de accountgebaseerde MVP.
- Trek gelekte provider- of databasesleutels in en roteer ze volgens het
  incidentproces.
- Behoud forensische auditmetadata zonder PII en gebruik het goedgekeurde
  backup-/restoreproces wanneer data-integriteit geraakt is.

## Harde stopcriteria

Productie blijft **NO-GO** bij één rood, onbekend of niet vastgelegd punt,
waaronder: toepasselijke hostingvoorwaarden/privacy, Preview-isolatie,
Google-/Blob-kernreis, een aan de release-SHA gebonden clean-room DB-herhaling,
vereiste GitHub CI en de echte hosted owner-/kijkerreis. Een toolmerk, Stripe,
printproof of fulfilment is geen gate voor deze gratis MVP. Er is geen
uitzondering op basis van deadline of het feit dat er al een openbaar
Vercel-adres bestaat.
