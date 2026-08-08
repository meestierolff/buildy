# Data-, storage- en authmigratie en gecontroleerde cutover

Status: tooling en provider-vrije tests gereed; bron-, staging- en productie-uitvoering geblokkeerd totdat de juiste credentials, backups, providerconfiguratie en expliciete acceptatie beschikbaar zijn.

Dit runbook migreert de bestaande Buildy-data gefaseerd naar Neon, Better Auth en private R2. Het is geen big-bang restore. De genormaliseerde doeldatabase wijkt bewust af van de legacy database en het legacy authschema wordt nooit blind in de nieuwe runtime geladen.

## Niet-onderhandelbare veiligheidsregels

- Ieder commando is zonder expliciete flags een lokale dry-run zonder netwerkverkeer.
- Een bronread vereist een exacte host, een run-ID en `READ:<run-id>:<host>`.
- Een Neon-read vereist afzonderlijk `READ-TARGET:<run-id>:<host>`.
- Een write vereist `--execute`, een exacte targethost en `APPLY:<run-id>:<environment>:<host>`.
- Productiewrites vereisen daarnaast de checksums van een geverifieerde backup en acceptatie-artifact plus `PRODUCTION-CUTOVER:<run-id>:<host>`.
- Database en R2 hebben afzonderlijke hosts en confirmations; een Neon-bevestiging kan geen R2-write autoriseren.
- De tooling accepteert alleen expliciet toegestane source- en targettabellen en parameteriseert alle waarden.
- Secrets, e-mailadressen, adressen, tokens, signed URLs en source objectkeys komen niet in logs.
- Artifacts zijn AES-256-GCM-versleuteld, SHA-256-gechecksummed, atomair geschreven, mode `0600` en staan onder het gitignored `artifacts/migration/`.
- Een bestaand R2-object met een andere checksum wordt nooit overschreven.
- Deletes worden niet uitgevoerd. Bronrecords die in een delta ontbreken zijn alleen delete-candidates voor handmatige beoordeling.
- Legacy cleanup wordt uitsluitend in een offline ledger gemarkeerd. `destructiveActionsAllowed` blijft altijd `false`.

## Tooling

De entrypoint is:

```sh
bun run migration:run -- <command> [flags]
```

Beschikbare commands:

| Command | Netwerk of write | Uitvoer |
|---|---|---|
| `preflight` | nooit | run-ID, vereiste gates en alleen secret-presence |
| `inventory` | optionele afgeschermde bronread | tabel-, auth-, bucket-, policy-, function- en orphaninventaris |
| `export` | optionele afgeschermde bronread | versleutelde consistente logical export zonder passwordhashes/sessies |
| `plan-storage` | lokaal | alle bekende DB-mediareferenties, deterministische asset-ID's en opaque R2-keys |
| `copy-storage` | standaard dry-run; expliciete source-read en R2-write | hervatbare per-object checksum/readback-checkpoints |
| `build-import` | lokaal | allowlisted, getransformeerde Neon-import plus manual-reviewlijst |
| `apply-import` | standaard validatie; expliciete Neon-write | transactionele, advisory-locked, idempotente upserts |
| `delta --final` | lokaal | volledige keysetdelta inclusief deletiecandidates |
| `reconcile-target` | optionele afgeschermde Neon-read | row/key checksums, mapping-, constraint-, notification-, order- en storagecontrole |
| `reconcile` | lokaal | evaluatie van een samengesteld reconciliation-evidenceartifact |
| `rollback-plan` | lokaal | immutable rollbackstappen zonder provideractie |
| `evaluate-cutover` | lokaal | GO/NO-GO per cutovergate |
| `mark-cleanup` | lokaal | non-destructief post-acceptance cleanup-ledger |
| `verify-artifact` | lokaal | decryptie-, envelope- en checksumcontrole zonder payload te loggen |

`MIGRATION_ARTIFACT_KEY` is een aparte willekeurige 256-bits base64sleutel uit de secretmanager. Hergebruik geen app-, auth-, R2- of PII-key. De sleutel moet gedurende de volledige rollback- en bewijsretentie beschikbaar blijven.

## Geaudite legacy bron

De schemahistorie bevat de volgende relevante datasets:

| Legacy bron | Doel/dispositie |
|---|---|
| `profiles` | `app_users`, `profiles`, avatar-`media_assets` |
| `trips` | `projects`, `project_phases`, cover/floorplan-assets |
| `trip_private_info` | `project_private_details`; adres wordt vóór import field-bound versleuteld |
| `steps` | `updates`, optionele `floorplan_pins` |
| `step_media` | `media_assets`, `update_media` |
| `step_contractor_info` | encrypted export en manual review; doelschema heeft geen gelijkwaardige per-update private notitie |
| `trip_budgets`, `step_budget` | `project_budgets`, `budget_items` in integer eurocenten |
| `follows`, `favorites` | projectaccess/followers; deduplicatie met private-projectsemantiek |
| `user_follows` | directionele `user_relationships` |
| `comments`, `reactions`, `likes` | comments/mentions en genormaliseerde reacties |
| `notifications` | nieuwe notifications met stabiele ID en lege, PII-vrije legacy payload |
| `photobook_settings` | nieuwe settings plus legacy layoutpreferences |
| exclusions | manual review totdat een canonical draft bestaat |
| orders en orderevents | altijd manual review; geen proof, seller snapshot, terms of bedragen verzinnen |
| AI-usage | bewust retired; geen AI-runtime naar de target importeren |
| deletion locks/failures/archive | manual review vóór account- of ordercutover |

Historische storage omvat minimaal `trip-media`, `trip-private`, `avatars` en `photobook-pdfs`. `trip-media` was publiek; `avatars` is publiek; `trip-private` is wel een private bucket maar kende anon reads voor publieke projecten. Daarom worden alle bytes, óók van publieke projecten en avatars, naar private R2-objecten gekopieerd. Publieke weergave loopt daarna uitsluitend via de autoriserende imageproxy.

De referentiecollector volgt:

- profielavatar;
- projectcover;
- legacy en multi-floor floorplans;
- alle update-media;
- alle gerefereerde Bouwboek-PDF's.

Querystrings van signed URLs worden bij parsing weggegooid. Source paden worden op traversal, backslashes, control characters en lengte gecontroleerd. De versleutelde storage-planartifact bewaart de source locator voor hervatten; logs bevatten alleen een keyed fingerprint.

## Stabiele identiteiten

- Een geldige legacy user-, project-, update-, media-, comment- of relatie-UUID blijft waar het doelschema dit toelaat exact gelijk.
- Afgeleide records gebruiken RFC 4122 UUIDv5 binnen één vaste Buildy-migratienamespace. Dezelfde bron levert bij iedere rehearsal dezelfde ID.
- `app_users.id` blijft de legacy user-UUID. Alle ownership-FK's wijzen naar deze domeinidentiteit.
- `auth_identity_mappings` krijgt `legacy_provider=legacy_auth`, de legacy subject-ID en status `requires_reset`.
- Een Better Auth-ID wordt pas gekoppeld nadat de gebruiker een gecontroleerde first-loginflow voltooit.

De tooling exporteert nooit `encrypted_password`, passwordhashes, access-/refresh-tokens of source sessies. Per gebruiker wordt alleen vastgesteld of een password bestond en welke providers gebruikt werden. De strategie is:

- bestaand password: geverifieerde password-setflow;
- passwordless: magic-link first login;
- OAuth: opnieuw veilig koppelen na bezit van hetzelfde geverifieerde account;
- disabled user of e-mailconflict: manual review.

Een authmigratie is pas productiegeldig nadat password-set, magic link, OAuth relink en migratiemail met synthetische accounts op staging zijn bewezen.

Na een succesvolle targetimport produceert het afzonderlijke, standaard
dry-run commando de operationele accountmails:

```bash
bun run migration:run -- enqueue-migration-account-mails \
  --source artifacts/migration/<run-id>/source-export.sealed.json
```

Voor uitvoering zijn daarnaast `--execute`, de exacte targethostbevestiging,
backup- en acceptatieartifacthashes en in productie de aparte cutoverbevestiging
vereist. Het adres wordt uit het sealed sourceartifact gelezen, met runtime-AAD
`email-recipient:{appUserId}:address` versleuteld en nooit gelogd. Accounts in
`manual_review` worden niet automatisch gemaild. Herhaling gebruikt dezelfde
outbox-idempotentiesleutel en levert geen tweede bericht op.

## Opaque private storagecopy

Een bestemming heeft de vorm:

```text
<purpose>/<uuid-prefix>/<deterministic-asset-uuid>/source
```

De key bevat geen user-ID, project-ID, bestandsnaam of source pad. Copy verloopt sequentieel en idempotent:

1. `HEAD` source en valideer een grens van maximaal 512 MiB.
2. Lees exact de gemelde bytes en bereken SHA-256.
3. Vergelijk een aanwezige sourcechecksum.
4. `HEAD` destination.
5. Sla een bestaande exacte match over; zet een mismatch op `conflict` zonder overwrite.
6. Schrijf met `If-None-Match: *`.
7. `HEAD` en, indien nodig, volledige readback van destination.
8. Schrijf atomair een versleuteld checkpoint met checksum, omvang en content type.

De database-import zet gekopieerde legacy assets eerst op `uploaded`, niet op `ready`, en `exif_stripped=false`. De bestaande mediaworker moet magic bytes/decode, EXIF/GPS-strip, derivatives en definitieve `ready`-status uitvoeren. Een storagecopy alleen is dus geen media-cutoverbewijs. Video's of andere formaten die de targetworker nog niet accepteert blijven private in R2 en blokkeren cutover via manual review; ze worden niet stilzwijgend overgeslagen.

## Uitvoeringsfasen

### 1. Source inventory

Maak een run-ID en voer lokaal uit:

```sh
bun run migration:run -- preflight --run-id <uuid>
```

Zet daarna `LEGACY_DATABASE_URL`, de exacte `MIGRATION_EXPECTED_SOURCE_HOST` en de getoonde `MIGRATION_SOURCE_READ_CONFIRM`. Voer pas dan uit:

```sh
bun run migration:run -- inventory --run-id <uuid> --allow-network-read
bun run migration:run -- export --run-id <uuid> --allow-network-read
```

De databaseadapter gebruikt één `REPEATABLE READ READ ONLY`-transactie, één connectie, statement- en locktimeouts en een expliciete table allowlist. Controleer dat alle verwachte tabellen bestaan, row counts plausibel zijn en alle orphan counts nul zijn. Een ontbrekende bekende tabel is bewijs dat de werkelijke bron eerst opnieuw moet worden gemapt.

### 2. Providerbackup en rollbackbasis

Vóór iedere targetwrite:

1. maak een provider-native source snapshot/PITR-checkpoint;
2. maak waar toegestaan een gecontroleerde encrypted logical databasebackup;
3. bewaar de source storage ongewijzigd;
4. verifieer backupreadback en voer een restore rehearsal uit op een geïsoleerde, niet-productieomgeving;
5. seal uitsluitend backup-ID, timestamp, restore-resultaat en checksum als evidence;
6. leg rollbackowner en rollbackwindow vast.

De logical Buildy-export is migratie-input, maar vervangt geen provider-native rollbackbackup. De source blijft intact en wordt niet gedecommissioned gedurende het rollbackwindow.

### 3. Storage rehearsal

```sh
bun run migration:run -- plan-storage --source <source-export.sealed.json>
bun run migration:run -- copy-storage --plan <storage-plan.sealed.json>
```

De tweede regel is alleen een dry-run. Voor de echte stagingcopy zijn afzonderlijke
legacy S3- en R2-hosts/credentials plus beide run-bound confirmations vereist.
Gebruik voor het doel uitsluitend een tijdelijk, bucket-scoped
`R2_MIGRATION_ACCESS_KEY_ID`/`R2_MIGRATION_SECRET_ACCESS_KEY`-paar. Hergebruik
geen web- of workercredential en laat dit paar buiten iedere runtimeomgeving.
Voeg dan pas `--allow-network-read --execute` toe. Hergebruik bij hervatten
`--checkpoint <storage-checkpoint.sealed.json>`.

Controleer per bucket:

- source object count en bytes;
- referenced, duplicate en orphan object counts;
- verified destination count en bytes;
- source/destination SHA-256;
- ontbrekende en conflicterende objects;
- publieke directe R2-read geeft 403/404;
- autoriserende proxy respecteert public, private, block en privacywijziging.

Geen enkele legacy objectdelete vindt in deze fase plaats.

### 4. Neon staging import

Bootstrap eerst een lege Neon-stagingdatabase met de applicatiemigratierol. Gebruik
hiervoor bewust niet de runtime-URL en ook niet de legacy-import-URL:

```sh
DATABASE_MIGRATION_URL=<neon-migration-role-url> bun run db:migrate
DATABASE_MIGRATION_URL=<neon-migration-role-url> bun run db:verify
DATABASE_MIGRATION_URL=<neon-migration-role-url> bun run db:migrate
```

De tweede migratierun moet een no-op zijn. De ledger moet exact alle 23 migraties
`0001` tot en met `0023` bevatten; `db:verify` moet exact 48 publieke tabellen en
43 tabellen met ingeschakelde RLS rapporteren. Configureer en verifieer daarna met
de afzonderlijke beheerverbinding de least-privilege rollen en grants uit
`db/roles/`:

```sh
psql "$DATABASE_DIRECT_URL" -v ON_ERROR_STOP=1 \
  -v buildy_web_role='<web-role>' \
  -v buildy_account_worker_role='<account-worker-role>' \
  -v buildy_email_worker_role='<email-worker-role>' \
  -v buildy_media_worker_role='<media-worker-role>' \
  -v buildy_photobook_worker_role='<photobook-worker-role>' \
  -v buildy_payment_worker_role='<payment-worker-role>' \
  -v buildy_fulfilment_worker_role='<fulfilment-worker-role>' \
  -f scripts/setup/configure-database-roles.sql
psql "$DATABASE_DIRECT_URL" -v ON_ERROR_STOP=1 \
  -v buildy_web_role='<web-role>' \
  -v buildy_account_worker_role='<account-worker-role>' \
  -v buildy_email_worker_role='<email-worker-role>' \
  -v buildy_media_worker_role='<media-worker-role>' \
  -v buildy_photobook_worker_role='<photobook-worker-role>' \
  -v buildy_payment_worker_role='<payment-worker-role>' \
  -v buildy_fulfilment_worker_role='<fulfilment-worker-role>' \
  -f scripts/setup/verify-database-roles.sql
```

`DATABASE_MIGRATION_URL` is alleen voor schemamigraties. `DATABASE_DIRECT_URL`
is alleen voor deze gecontroleerde rolbootstrap, target-import en andere expliciete
beheerhandelingen; de webruntime krijgt uitsluitend zijn beperkte
`DATABASE_URL`. Begin geen legacy-import zolang migratieledger, schema-aantallen,
RLS en rolverificatie niet allemaal exact groen zijn.

Na deze bootstrap en een volledig geverifieerde storagecopy:

```sh
bun run migration:run -- build-import \
  --source <source-export.sealed.json> \
  --plan <storage-plan.sealed.json> \
  --checkpoint <storage-checkpoint.sealed.json>

bun run migration:run -- apply-import --import <target-import.sealed.json>
```

De tweede regel valideert alleen. Een stagingwrite vereist `APP_ENV=staging`,
`DATABASE_DIRECT_URL`, de exacte Neon-host, `MIGRATION_WRITE_CONFIRM` en
`--execute`. Deze URL is hier dus de gecontroleerde target-importverbinding, niet
de schemamigratie- of webrol.

De importer:

- gebruikt een transactionele advisory lock;
- schrijft alleen allowlisted tabellen en kolommen;
- gebruikt parameterized values;
- gebruikt stabiele conflictkeys en veilige upserts;
- behoudt constraints en foreign keys;
- schrijft geen authcredentials;
- importeert geen ambiguë fysieke orders;
- bewaart alle afgewezen records uitsluitend als PII-vrije fingerprints in de manual-reviewlijst; de volledige bron blijft in het encrypted exportartifact.

Na import draait de mediaworker totdat alle ondersteunde migrated assets `ready` zijn. Maak daarna canonical Bouwboekdrafts uit de gemigreerde tijdlijn; importeer legacy exclusions pas na expliciete koppeling aan zo'n draft.

### 5. Reconciliation

Een Neon-read is een aparte gate:

```sh
bun run migration:run -- reconcile-target \
  --import <target-import.sealed.json> \
  --plan <storage-plan.sealed.json> \
  --checkpoint <storage-checkpoint.sealed.json> \
  --allow-network-read
```

Hiervoor zijn de exacte targethost en `MIGRATION_TARGET_READ_CONFIRM=READ-TARGET:<run-id>:<host>` nodig. De query draait read-only en vergelijkt alleen gemigreerde keys/velden.

Cutover vereist:

- row count en primary-keyset per targettabel exact;
- row checksums exact;
- iedere app-user en ownershipmapping aanwezig, zonder duplicates;
- geen onvalidated FK/unique/check constraints;
- geen notification orphan;
- storage expected = verified, nul missing/checksumconflicts/destinationduplicates;
- legacy ordercount en totalen exact handmatig gereconcilieerd;
- alle quarantainerecords opgelost of expliciet en aantoonbaar veilig gemapt.

Omdat oude orders niet automatisch naar een onvolledig nieuw juridisch snapshot worden vertaald, levert ieder onopgelost legacy order bewust `order_count_mismatch` en dus NO-GO op.

### 6. Dual-environment rehearsal en delta

Laat legacy de enige writer blijven. Test de nieuwe omgeving met shadow reads en synthetische writes; voer geen ongecontroleerde bidirectionele dual write in.

Maak later een tweede source-export en bereken:

```sh
bun run migration:run -- delta --base <full-export> --current <delta-export>
```

De delta vergelijkt per tabel de volledige keyset en iedere rowchecksum. `updated_at` alleen is onvoldoende, omdat deletes dan onzichtbaar zijn. Nieuwe/gewijzigde rows zijn upsert-input; ontbrekende keys zijn nooit automatische deletes.

### 7. Maintenance, freeze en final delta

1. Kondig het onderhoudsvenster aan.
2. Stop nieuwe legacy writes server-side; alleen een verborgen knop is onvoldoende.
3. Verifieer met een synthetische mutatie dat writes werkelijk worden geweigerd.
4. Registreer `frozenAt`.
5. Start daarna een nieuwe repeatable-read export en registreer `finalSnapshotStartedAt`.
6. Bereken `delta --final`.
7. Beoordeel iedere deletiecandidate; de cutovergate accepteert standaard nul candidates.
8. Pas alleen gevalideerde upserts toe op Neon en herhaal volledige reconciliation.
9. Houd de bron frozen en intact.

### 8. Oude sessies invalidaren

Direct vóór productieverkeer:

1. revoke alle legacy refresh-sessies via afgeschermde beheercredentials;
2. roteer legacy JWT-secret;
3. roteer de oude/hardcoded anon key als gecompromitteerd;
4. controleer de onafhankelijke Better Auth-cookie name, origin en signing secret;
5. bewijs met uitsluitend synthetische tokens dat een oude token op legacy én target wordt geweigerd;
6. seal alleen timestamps en evidencechecksums, nooit de tokens of secrets.

OAuth-users linken daarna opnieuw via de geverifieerde migratieflow. Bron- en targetauthsessions worden nooit samengevoegd.

### 9. Productiecutover

Maak eerst een cutover-evidenceartifact met backup, restore rehearsal, source freeze, final delta, reconciliation, auth rehearsals, session invalidation, privacy-smokes, rollbackwindow, providerroutebewijzen en expliciete owneracceptatie. Evalueer lokaal:

```sh
bun run migration:run -- evaluate-cutover --evidence <cutover-evidence.sealed.json>
```

Alle gates moeten groen zijn. Voer daarna in één gecontroleerd venster uit:

1. activeer nieuwe production environment in read-only modus;
2. zet Stripe, Peecho en Brevo callbacks naar de reeds geteste exacte targetroutes;
3. wijzig DNS/apex/www en verifieer TLS, canonical redirects en trusted origins;
4. voer auth, private/public project, media, update en orderstatus smokes met synthetische accounts uit;
5. open targetwrites pas nadat reads en privacytests groen zijn;
6. monitor auth failures, 4xx/5xx, storage, mail, payment en fulfilment;
7. laat legacy frozen, bereikbaar voor rollbackoperators maar niet voor eindgebruikers.

Een DNS- of browserredirect markeert geen cutover als geslaagd; alleen het gesigneerde gateartifact doet dat.

## Rollback

Maak vóór cutover een verzegeld plan:

```sh
bun run migration:run -- rollback-plan --run-id <uuid>
```

Rollback wordt gestart bij ownershipverschil, private dataleak, order-/paymentverschil, kritieke writefout of verkeerde webhookenvironment. Volgorde:

1. zet de target onmiddellijk read-only;
2. exporteer targetwrites/auditevents uit het cutovervenster als encrypted delta;
3. herstel vooraf vastgelegde DNS- en webhookroutes;
4. configureer legacy auth veilig voordat de freeze wordt opgeheven;
5. voer privacy-, auth- en order-smokes opnieuw uit;
6. reconcileer targetwrites handmatig terug; blind overschrijven is verboden;
7. behoud alle Neon-, R2- en sourcebackups.

## Post-acceptance legacy cleanup

Pas na een groen productie-gatereport:

```sh
bun run migration:run -- mark-cleanup \
  --cutover-report <cutover-gates.sealed.json>
```

Binnen het rollbackwindow wordt iedere resource `retained_for_rollback`. Na het window blijft zij `awaiting_retention_decision` totdat backupretentie expliciet is goedgekeurd. Alleen dan kan het offline ledger `eligible_for_manual_decommission` melden. Dit voert nog steeds geen delete, revoke, shutdown of providerwrite uit.

De uiteindelijke, afzonderlijk geautoriseerde decommissionvolgorde is:

1. bewijs backupretentie en restore;
2. roteer/revoke oude secrets;
3. schakel oude hosting uit;
4. archiveer auth/database/storage volgens goedgekeurd beleid;
5. verwijder providers pas in een later change window;
6. bewaar het audit- en acceptatiebewijs.

## Externe blockers

Niet lokaal te bewijzen of uit code af te leiden:

- source database- en storagecredentials met uitsluitend benodigde readrechten;
- een actuele source inventory en encrypted export;
- Neon staging/production branches en migration-role credentials;
- private R2-bucket en aparte least-privilege migrationcredential;
- provider-native snapshot/PITR en een geslaagde restore rehearsal;
- exacte legacy orderafhandeling en financiële totals;
- succesvolle stagingauthmigratie, migrationmail en OAuth-herkoppeling;
- definitieve domain/DNS- en webhookconfiguratie;
- rollbackowner/window en expliciete productacceptatie;
- juridische/privacyretentiebesluiten.

Zonder deze waarden blijft de cutover terecht NO-GO; de scripts verzinnen geen bewijs en doen geen live provideractie.
