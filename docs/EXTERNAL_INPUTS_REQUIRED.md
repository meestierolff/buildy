# Externe inputs en launchgates

**Peildatum:** 5 augustus 2026
**Status:** geen van onderstaande productiegegevens wordt uit fixtures of code
afgeleid. Secrets horen uitsluitend in de juiste Vercel environment.

## Gate-overzicht

| Gate | Nodig voor | Huidige status | Bewijs om te sluiten |
|---|---|---|---|
| EXT-01 Juridische identiteit | publieke registratie, checkout | Ontbreekt | goedgekeurde seller/contactgegevens en legal versies |
| EXT-02 Domein/DNS | productie-auth, links, webhooks | Ontbreekt | Vercel domain inspect, HTTPS en redirectsmoke |
| EXT-03 Privacy/voorwaarden | publieke bèta en verkoop | Ontbreekt | eigenaar/privacyreview met versienummers |
| EXT-04 Neon productie | iedere productieflow | Ontbreekt | org/project/regio/plan, DPA, rollen, apply/verify/no-op |
| EXT-05 R2 privé-opslag | uploads, proof, export | Ontbreekt | private bucket, CORS, lifecycle, readback/delete/privacytest |
| EXT-06 Brevo | auth- en ordermail | Ontbreekt | sender/DNS, templates, testmail en deliverycallback |
| EXT-07 Stripe | sandbox/live checkout | Ontbreekt | dedicated account, testbewijs; live apart goedgekeurd |
| EXT-08 Peecho | fulfilment | Ontbreekt | sandboxconfig, offering/quote/callback en fysieke proefdruk |
| EXT-09 Google OAuth | Google-login | Ontbreekt | eigen client, exacte origins/callback en linkingtest |
| EXT-10 Scheduler/alerts | durable jobs | Ontbreekt | ondersteunde cadence, gemiste-cronalert en storingsproef |
| EXT-11 Backup/restore | productie-data | Ontbreekt | rehearsalbewijs volgens `BACKUP_AND_RESTORE.md` |
| EXT-12 Moderatiebeleid | publieke UGC | Ontbreekt | bevoegde moderators, beleid, leeftijdsbesluit, escalatiecontact |
| EXT-13 Private bèta | externe testers | Ontbreekt | testerallowlist/invites, consentcopy en go/no-go-eigenaar |
| EXT-14 Legacybron en cutover | behoud van bestaande accounts/projecten/media | Ontbreekt | source-inventory, read-only bron- en storagecredentials, backup/restorebewijs, rehearsal, reconciliatie en run-gebonden cutoverakkoord |

## Buildy en juridische gegevens

- definitief `PRIMARY_DOMAIN`, apex/www-keuze en registrar;
- juridische verkopersnaam, handelsnaam, rechtsvorm, KvK, btw-ID en adres;
- support-, privacy-, security-, klachten- en contentmeldingsadres;
- telefoon indien vereist, supporturen en escalatie-eigenaar;
- verkooplanden, valuta, btw-/OSS-besluit, verzend- en retourbeleid;
- voorwaarden-, privacy-, contentbeleid- en huisregelsversie plus ingangsdatum;
- maatwerk-/herroepingsbesluit en exacte checkoutcopy;
- leeftijdsgrens en ouderlijke-toestemmingsbesluit;
- account-, order-, support-, moderatie-, log- en back-upretentie;
- RPO/RTO, incidentcontacten en bevoegde operators/moderators;
- definitieve beta-allowlist en invitebeleid.

## Providerinputs

### Neon

Org/project, productie- en stagingbranch, EU-regio/plan, pooled runtime-URLs,
een directe least-privilege schemarunner-URL in `DATABASE_MIGRATION_URL`, een
afzonderlijke gecontroleerde beheer-/targetimport-URL in `DATABASE_DIRECT_URL`,
afzonderlijke workerrollen, API key voor setup, backup/PITR-retentie,
DPA/subprocessors en supporttoegang. `DATABASE_URL` is uitsluitend de beperkte,
pooled webruntime-URL; `DATABASE_DIRECT_URL` mag niet als fallback voor de
schema-runner dienen. Sluit deze gate pas na apply/verify/no-op met alle 23
migraties, 48 publieke tabellen, 43 RLS-tabellen en geverifieerde rolgrants.
Waarden worden nooit in dit document opgenomen.

### Cloudflare R2

Een gedeeld `R2_ACCOUNT_ID` en `R2_BUCKET_NAME` per omgeving, plus vijf unieke,
bucket-scoped least-privilege credentialparen:

- `R2_WEB_ACCESS_KEY_ID` / `R2_WEB_SECRET_ACCESS_KEY`;
- `R2_ACCOUNT_WORKER_ACCESS_KEY_ID` / `R2_ACCOUNT_WORKER_SECRET_ACCESS_KEY`;
- `R2_MEDIA_WORKER_ACCESS_KEY_ID` / `R2_MEDIA_WORKER_SECRET_ACCESS_KEY`;
- `R2_PHOTOBOOK_WORKER_ACCESS_KEY_ID` / `R2_PHOTOBOOK_WORKER_SECRET_ACCESS_KEY`;
- `R2_FULFILMENT_WORKER_ACCESS_KEY_ID` / `R2_FULFILMENT_WORKER_SECRET_ACCESS_KEY`.

Er is geen generiek credentialpaar en geen fallback. Verder zijn exacte CORS-
origins, lifecycle/versioning/backupbesluit, DPA/subprocessors en bewezen private
upload/read/delete per boundary nodig. Een legacy-storagerehearsal of -cutover
krijgt daarnaast een apart, kortlevend operatorpaar in
`R2_MIGRATION_ACCESS_KEY_ID` / `R2_MIGRATION_SECRET_ACCESS_KEY` en het exacte
`R2_MIGRATION_ENDPOINT`. Deze waarden zijn nooit runtimecredentials, worden niet
met één van de vijf paren gedeeld en worden na het overeengekomen rollbackwindow
ingetrokken.

### Brevo

API key, afzonderlijke Buildy-sender, senderdomain, SPF/DKIM/DMARC-bewijs,
environment-specifieke template IDs/versies, webhooksecret, supportcontact en
deliverytest. Env: `BREVO_*`. Template metadata bevat geen persoonsgegevens.

### Stripe

Dedicated Buildy account-ID, test- en livekeys in gescheiden environments,
webhooksecrets/endpoints/events, taxbesluit, statement descriptor, publieke
businessdetails, payout/refund/chargebackproces. Env: `STRIPE_*`, plus formeel
goedgekeurde `ORDER_PRICE_MATRIX_JSON`, `ORDER_SELLER_JSON` en
`ORDER_TERMS_VERSION`.

### Peecho

Test/live merchant key en secret, officiële base-environment, A4 liggend
hardcover offering-ID en productspecificatie, quote/kosten/shipping/doorlooptijd,
credits of invoicing, callbackconfig, contract/DPA/subprocessors, GPSR-rollen en
support-/annulering-/herdrukproces. Vereist een sandboxorder én werkelijk
ontvangen gecontroleerde proefdruk.

### Google OAuth

Eigen client-ID/secret per omgeving, consent screen, exacte JavaScript origins
en redirect URI's, accountlinkingbesluit en delete/revocationprocedure. Geen
oude prototypeprovider-broker.

### Vercel en monitoring

Eigen project/team, plan dat functions en vereiste cronfrequentie ondersteunt,
regio, environment-separatie, deploybeveiliging, logretentie, alerts,
incidentcontacten, custom domain en DPA/subprocessors. Previewcredentials mogen
geen productieproviders muteren. Het plan moet alle vijf routes uit
`vercel.json` iedere minuut kunnen uitvoeren: `email`, `account-lifecycle`,
`media`, `photobooks` en `peecho-fulfilment`. Gatebewijs vereist de werkelijk
gedeployde cronlijst, succesvolle invocatie per route en een geteste
gemiste-cronalert; de repositoryconfig alleen sluit EXT-10 niet.

### Legacybron en cutover

Vóór iedere migratie zijn een eigenaar en inventory van de werkelijke legacy-
database en objectstorage nodig, inclusief tabellen, aantallen, constraints,
orphanen, objecttypen, omvang en ambiguïteiten. Lever alleen via een goedgekeurde
secretstore:

- read-only `LEGACY_DATABASE_URL` en de afzonderlijke
  `LEGACY_STORAGE_S3_ENDPOINT`, `LEGACY_STORAGE_REGION`,
  `LEGACY_STORAGE_ACCESS_KEY_ID` en `LEGACY_STORAGE_SECRET_ACCESS_KEY`;
- exacte bron- en storagehosts in `MIGRATION_EXPECTED_SOURCE_HOST` en
  `MIGRATION_EXPECTED_STORAGE_SOURCE_HOST`;
- een rungebonden `MIGRATION_RUN_ID`, artifactkey en de exacte
  `MIGRATION_SOURCE_READ_CONFIRM` / `MIGRATION_STORAGE_SOURCE_READ_CONFIRM`;
- de gecontroleerde targetimport-URL in `DATABASE_DIRECT_URL`, exacte
  `MIGRATION_EXPECTED_TARGET_HOST` en `MIGRATION_EXPECTED_STORAGE_TARGET_HOST`;
- `R2_MIGRATION_ENDPOINT` plus het uitsluitend voor deze rehearsal/cutover
  uitgegeven `R2_MIGRATION_ACCESS_KEY_ID` /
  `R2_MIGRATION_SECRET_ACCESS_KEY`; nooit een runtimepaar of generieke alias;
- de exacte rungebonden `MIGRATION_TARGET_READ_CONFIRM`,
  `MIGRATION_WRITE_CONFIRM` en `MIGRATION_STORAGE_WRITE_CONFIRM`, plus alleen
  voor productie `MIGRATION_PRODUCTION_CONFIRM` en
  `MIGRATION_STORAGE_PRODUCTION_CONFIRM`;
- provider-native snapshot/PITR-bewijs, encrypted backupchecksum in
  `MIGRATION_BACKUP_ARTIFACT_SHA256`, geslaagde restore rehearsal,
  `MIGRATION_ACCEPTANCE_ARTIFACT_SHA256`, rollbackowner en de vastgelegde
  `MIGRATION_ROLLBACK_WINDOW_ENDS_AT`.

De targetdatabase wordt vóór import met `DATABASE_MIGRATION_URL` opgebouwd en
geverifieerd; deze URL is niet de legacybron- of targetimportcredential. Een
inventory, backup, stagingrehearsal, deltafreeze, reconciliatie en expliciete
go/no-go zijn externe gates. De repository heeft geen broncredentials en er is
geen echte cutover uitgevoerd of hiermee geïmpliceerd.

## Goedkeuringsregel

Een gate wordt alleen gesloten met datum, omgeving, eigenaar, bewijslink of
artifact, werkelijk testresultaat en eventuele vervaldatum. “Secret ingevuld”,
een succesvolle build of documentatie van een provider is geen verificatie.
Live checkout en publieke registratie blijven server-side fail-closed zolang de
relevante gates niet aantoonbaar gesloten zijn.
