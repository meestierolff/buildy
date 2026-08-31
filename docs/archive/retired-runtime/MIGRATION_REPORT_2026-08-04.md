# Migratierapport

> **HISTORISCH ARCHIEF — NIET UITVOEREN.** Dit rapport bewaart de toenmalige
> Better Auth/R2/Brevo/Peecho-cutoveranalyse en claims van 4 augustus 2026.
> Gebruik de actuele releaseprocedure; verwijder geen historische migrations of
> data op basis van dit rapport.

Laatste update: 2026-08-04  
Huidige conclusie: **NO-GO voor een echte data- of productiecutover; tooling is lokaal en provider-vrij geverifieerd.**

Dit rapport maakt onderscheid tussen geïmplementeerde migratiecapaciteit en werkelijk providerbewijs. Er is in deze werkomgeving geen legacy database-, storage-, Neon- of R2-migratie uitgevoerd. Er zijn geen providerwrites, deletes, sessierevokes, DNS-wijzigingen of live cutoveracties gedaan.

## Gebouwd en lokaal bewezen

| Onderdeel | Status | Bewijs |
|---|---|---|
| Default dry-run | Groen | inventory/export/copy/import/reconcile printen zonder expliciete gates alleen een plan |
| Exact-host en run-bound gates | Groen | unit tests voor source, Neon, R2 en extra productiegates |
| PII-veilige artifacts | Groen | AES-256-GCM, canonical JSON, SHA-256, atomic rename, mode `0600`, tampertest |
| Logredactie | Groen | e-mail, adres/name, token/secret, URL en objectkey worden geredact |
| Stable identity mapping | Groen | legacy UUID blijft exact; UUIDv5 is deterministisch en tegen RFC-testvector getest |
| Authmigratieplan | Groen | geen hashes/sessies; password-set, magic-link, OAuth-relink en manual review |
| Source inventory/export | Code gereed | repeatable-read, read-only, allowlisted tabellen, timeouts, orphan- en bucketinventory |
| Mediareferentie-inventory | Groen met synthetic fixtures | avatars, covers, floorplans, update-media en PDFs |
| Private R2-copy | Groen met fake stores | opaque keys, If-None-Match, checksum, readback, resume en conflict zonder overwrite |
| Neon mapping | Groen met synthetic fixtures | ownership/UUID, encrypted adres, projects/updates/media/social/budget/settings |
| Fysieke legacy orders | Fail-closed | altijd fingerprinted manual review; geen proof/seller/terms/price wordt verzonnen |
| Neon importer | Code gereed | allowlist, parameters, transactie, advisory lock, idempotente conflictkeys |
| Delta/final delta | Groen | rowhash én volledige keyset; ontbrekende keys zijn alleen delete-candidates |
| Reconciliation | Groen met synthetic evidence | rows/keys, auth/owner, FK/unique, notification, order en storage gates |
| Cutover/rollback | Groen met synthetic evidence | volledige gate-evaluatie en non-destructief rollbackplan |
| Legacy cleanupmarkering | Groen | offline ledger, rollback/retentietoestand, deletes altijd verboden |

Provider-vrije verificatie op 2026-08-04:

```text
bun run test -- tests/migration/cutover-tooling.test.ts
exit 0 — 1 testbestand, 18 tests geslaagd

bun run migration:typecheck
exit 0

bunx eslint scripts/migration tests/migration
exit 0
```

De migratieconfiguratie en de volledige node-typecheck worden in CI afzonderlijk
uitgevoerd. De accountmigratiemailproducer deelt dezelfde target-writegates en
legt uitsluitend aantallen en artifacthashes vast.

## Legacy audit uit repositorybewijs

De gecommitte legacy schemahistorie bevat minimaal:

- profielen, projecten (`trips`), updates (`steps`) en update-media;
- comments, likes/reactions, projectfollows, user follows, favorites en notifications;
- private projectinformatie, project- en updatebudget;
- floorplans als project-JSON plus updatepins;
- Bouwboeksettings, exclusions, orders en orderevents;
- accountdeletion locks/failures/archive en retired AI-usage;
- storagebuckets `trip-media`, `trip-private`, `avatars` en `photobook-pdfs`.

Vastgestelde storagekarakteristieken:

- `trip-media` begon als publieke bucket en bevat legacy projectmedia;
- `trip-private` werd private, maar verleende anon reads voor media van publieke projecten;
- `avatars` was bewust publiek;
- `photobook-pdfs` bevatte legacy printbestanden;
- objectpaden bevatten vaak owner-, step- of project-ID's en mogen niet als targetkeys worden hergebruikt;
- DB-referenties bestaan zowel als provider-URL als `*_storage_path` en floorplan-JSON.

Daarom kopieert het doelplan alle gerefereerde bytes naar opaque private R2-keys en laat het openbare delivery via de targetproxy lopen. Querytokens uit signed URLs worden niet bewaard.

## Schema- en datamapping

| Domein | ID-strategie | Bijzonderheden | Huidige providerstatus |
|---|---|---|---|
| app user | legacy UUID behouden | authprovider-ID blijft los van domein-FK | Niet uitgevoerd |
| auth identity | deterministic UUIDv5 | status `requires_reset`; target auth-ID pas na verified flow | Niet uitgevoerd |
| profile | profile/user UUID behouden | stable privacy-safe slug; avatar na media-import gekoppeld | Niet uitgevoerd |
| project | trip UUID behouden | `legacy_trip_id` idem; private default semantiek behouden | Niet uitgevoerd |
| phase | deterministic UUIDv5 | targetstandard plus alle legacy/custom gebruikte fasen | Niet uitgevoerd |
| update | step UUID behouden | legacy ID vastgelegd; oude route/geo-velden niet meegenomen | Niet uitgevoerd |
| media | deterministic UUIDv5 uit purpose+bucket+path | private R2, status eerst `uploaded`, worker moet EXIF/process doen | Niet uitgevoerd |
| floorplan/pin | UUID behouden of deterministic UUIDv5 | percentages naar 0..1; rangefouten manual review | Niet uitgevoerd |
| social | legacy UUID waar aanwezig | follow/favorite merge; private toegang expliciet | Niet uitgevoerd |
| budget | deterministic budget/item-ID | decimal euro naar integer cents | Niet uitgevoerd |
| settings | project UUID | legacy layoutpreferences bewaard; exclusions na canonical draft | Niet uitgevoerd |
| orders | geen automatische import | juridisch/financieel bewijs ontbreekt in oud model | Manual review vereist |

De mapper maakt stagingdata waar veilig mogelijk, maar iedere truncatie, ontbrekende owner, storageconflict, unsupported reaction, ongeldige pin, onbekend order- of operationeel record krijgt een PII-vrije quarantaineregel. De volledige bronrij blijft uitsluitend in het encrypted sourceartifact.

## Authrapport

Werkelijke bronwaarden zijn nog onbekend:

| Metriek | Actuele waarde |
|---|---:|
| Totaal legacy auth users | Niet gemeten |
| E-mail verified | Niet gemeten |
| Password-set vereist | Niet gemeten |
| Passwordless first login | Niet gemeten |
| OAuth relink vereist | Niet gemeten |
| Disabled/manual review | Niet gemeten |
| Duplicate normalized e-mail | Niet gemeten |
| Owner mappings ontbrekend | Niet gemeten |

Productiegates die nog ontbreken:

- rehearsal van password-set, magic link en OAuth relink;
- migrationmail via geverifieerde Brevo-sender;
- verified bezit van duplicate/conflictaccounts;
- legacy refresh-tokenrevoke;
- legacy JWT-secret- en anon-keyrotatie;
- synthetisch bewijs dat oude tokens worden geweigerd.

## Databasevalidatie

Onderstaande waarden moeten uit een echte source inventory en read-only target reconciliation komen. Ze mogen niet handmatig als nul worden ingevuld zonder artifactbewijs.

| Controle | Source | Target | Gate |
|---|---:|---:|---|
| row count per mapped tabel | Niet gemeten | Niet gemeten | Exact |
| primary-keyset SHA-256 | Niet gemeten | Niet gemeten | Exact |
| imported-field row SHA-256 | Niet gemeten | Niet gemeten | Exact |
| orphan ownership/FK | Niet gemeten | Niet gemeten | 0 |
| duplicate identity/unique | Niet gemeten | Niet gemeten | 0 |
| unvalidated constraints | n.v.t. | Niet gemeten | 0 |
| notification integrity | Niet gemeten | Niet gemeten | 0 |
| legacy ordercount | Niet gemeten | Niet gemeten | Exact na manual mapping |
| legacy ordertotal minor | Niet gemeten | Niet gemeten | Exact na manual mapping |

De importer is niet tegen een echte Neon-branch uitgevoerd. De recente repositorymigraties zijn daarom geen bewijs van daadwerkelijke data-import of reconciliation.

## Storagevalidatie

| Bucket/purpose | Referenties | Source objects/bytes | Verified R2 | Missing | Conflict | Status |
|---|---:|---:|---:|---:|---:|---|
| avatars | Niet gemeten | Niet gemeten | Niet gemeten | Niet gemeten | Niet gemeten | NO-GO |
| project covers | Niet gemeten | Niet gemeten | Niet gemeten | Niet gemeten | Niet gemeten | NO-GO |
| originals/update media | Niet gemeten | Niet gemeten | Niet gemeten | Niet gemeten | Niet gemeten | NO-GO |
| floorplans | Niet gemeten | Niet gemeten | Niet gemeten | Niet gemeten | Niet gemeten | NO-GO |
| photobook PDFs | Niet gemeten | Niet gemeten | Niet gemeten | Niet gemeten | Niet gemeten | NO-GO |

Naast bytecopy moeten nog bewezen worden:

- magic-byte/decode en contenttype;
- EXIF/GPS-strip voor afbeeldingen;
- display derivatives;
- alle mediarecords `ready` of expliciet manual review;
- anonieme directe R2-read 403/404;
- autoriserende proxy voor alle actorclasses;
- onmiddellijke public→private revocation;
- unsupported legacy video/PDF-afhandeling;
- nul orphan growth na dual-environment test.

## Delta en final delta

Er is nog geen echte full export, delta of final delta. De tooling vergelijkt niet alleen `updated_at`, maar iedere geëxporteerde rowhash en de volledige primary-keyset. Dat is nodig om deletes zichtbaar te maken.

De final-deltagate blijft rood totdat:

- source writes aantoonbaar server-side frozen zijn;
- `finalSnapshotStartedAt >= frozenAt`;
- alle nieuwe/gewijzigde rows zijn toegepast;
- iedere deletiecandidate is beoordeeld en de defaultwaarde nul is;
- volledige reconciliation opnieuw groen is.

## Rollback en cleanup

Nog ontbrekend providerbewijs:

- provider-native database snapshot/PITR-ID;
- encrypted logical backup en readbackchecksum;
- storagebronretentie;
- geslaagde restore rehearsal;
- rollbackowner en eindtijd;
- vastgelegde oude DNS-/webhookconfig;
- werkwijze om writes uit het cutovervenster terug te reconciliëren.

De code genereert een rollbackplan en weigert cleanup vóór een volledig groen productie-gatereport. Zelfs na acceptatie schrijft de cleanupfunctie alleen een offline ledger. Geen legacy resource is gemarkeerd of verwijderd in deze werkomgeving.

## Verwijderde bron-SDK en packagegraph

De nieuwe migratiecode gebruikt `pg` en de S3-compatible AWS SDK. De twee oude SDK-gebaseerde auditentrypoints zijn vervangen door compatibility wrappers naar de nieuwe read-only inventory.

Technische conclusie:

- de oude browser-SDK is verwijderd uit migratie-, audit- en actieve runtimecode;
- de package en bijbehorende lockfile-entries zijn verwijderd;
- bronhosts zijn uitsluitend via een exacte operatorconfiguratie toegestaan;
- zonder exact host + run-bound confirmation is geen netwerkread mogelijk.

## Working-tree decommissionbewijs

De applicatiecutover en de externe brondecommission zijn bewust twee aparte
gates. In de repository is de oude runtime volledig verwijderd:

- providerclients, Edge Functions, providermigraties, providerconfig en oude
  agent-/teamdocumentatie zijn fysiek afwezig;
- de oude browser-SDK, routekaartstack, client-PDF-generator en printwidget zijn
  uit `package.json` en `bun.lock` verwijderd;
- `node scripts/check-launch.mjs --static` controleert zowel deze paden en
  packages als alle vanaf `src/main.tsx` bereikbare productiemodules;
- de tracked-file grep vindt merknamen uitsluitend nog in negatieve
  regressieasserties en de centrale denylist van `scripts/check-launch.mjs`.
  Dat zijn bewuste beveiligingsguards, geen imports, envnamen of netwerkcalls.

De externe bronaccounts, DNS, oude tokens en opgeslagen brondata zijn in deze
sessie niet verwijderd of geroteerd. Dat blijft terecht geblokkeerd totdat een
echte inventory, snapshot, final delta, reconciliation, rollbackwindow en
expliciete acceptatie bestaan.

## Kortste veilige vervolgstappen

1. Provision een geïsoleerde Neon stagingbranch en private R2 stagingbucket.
2. Maak/provider-verifieer source snapshot en restore rehearsal.
3. Plaats least-privilege source-readcredentials en een aparte artifactkey in de secretmanager.
4. Voer `preflight`, `inventory` en `export` met één vaste run-ID uit.
5. Beoordeel tables/orphans/auth en seal de acceptatie van de broninventaris.
6. Plan en kopieer storage; los missing/conflicts op; laat mediaworker alles verwerken.
7. Bouw en apply de stagingimport; los iedere quarantaineregel op.
8. Draai `reconcile-target` tot alle data-, auth-, order- en storagegates exact groen zijn.
9. Rehearse authmigratie, privacytests, providerwebhooks en rollback.
10. Plan maintenance/freeze/final delta en vraag pas daarna expliciete productieacceptatie.

Totdat deze stappen met echte artifacts zijn bewezen, blijft staging-import uitvoerbaar maar de productiecutover NO-GO.
