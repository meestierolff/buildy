# Account lifecycle

De accountflow gebruikt gebruikersnaam/wachtwoord, Neon en private Vercel Blob.
Zie [F6](architecture/FLOWS.md) voor het contract en [STATE](architecture/STATE.md)
voor werkelijk uitgevoerd bewijs. Een geaccepteerd verwijderverzoek is geen
bewijs dat fysieke cleanup al klaar is.

## Sessies

Wachtwoorden worden met scrypt en een eigen salt gehasht. Buildy bewaart alleen
de hash van een willekeurig sessietoken in Neon. De sessiecookie is `HttpOnly`,
`SameSite=Lax` en op HTTPS `Secure`. De server bepaalt de actieve gebruiker;
clientheaders, profieldata of requestbody kunnen geen identiteit kiezen.
Gebruikersnaamaccounts verzamelen geen e-mailadres. Wachtwoordherstel bestaat
niet; beloof geen reset- of recoveryflow.

- `GET /api/account/sessions` toont alleen eigen sessies.
- `DELETE /api/account/sessions/:sessionId` trekt alleen een eigen sessie in.
- Uitloggen trekt de huidige sessie in. Mutaties behouden origin/CSRF-controles
  en rate limiting.

## Data-export

`GET /api/account/exports` toont eigen aanvragen. `POST /api/account/exports`
gebruikt een gebruikersgebonden idempotencykey en kan actuele media meenemen.
`GET|HEAD /api/account/exports/:jobId/download` is alleen voor de eigenaar.

De accountworker maakt een ZIP met `data.json`, optionele media en
`manifest.json`, maximaal 250 MiB. PII wordt alleen binnen de worker ontsleuteld.
Media moet bij de exacte geconfigureerde private Blob-store horen. Bron- en
archiefchecksums worden gecontroleerd. Download vereist overeenkomende
bytegrootte/SHA-256 en gebruikt `private, no-store` via de same-origin route;
de browser krijgt geen permanente Blob-download-URL.

Exportstatussen zijn `requested`, `processing`, `retry_scheduled`, `ready`,
`expired`, `failed`, `dead_letter` en `deleted`. Controleer status en veilige
foutcode voordat een operator een probleem als opgelost meldt.

## Accountverwijdering

`POST /api/account/deletion` vereist een actieve gebruiker, de exacte bevestiging
`VERWIJDEREN`, een gebruikersgebonden idempotencykey en een huidige sessie die
maximaal tien minuten geleden is aangemaakt. Bij een oudere sessie logt de
gebruiker opnieuw in met gebruikersnaam en wachtwoord.

De aanvraag trekt sessies in en maakt account/projectinhoud direct onzichtbaar.
Langdurige cleanup gebeurt via de accountworker. Die verwijdert uitsluitend
geïnventariseerde private assets en controleert na iedere delete of het object
afwezig is. Redactie en tombstoning volgen pas wanneer de manifestcontroles en
retentievoorwaarden slagen.

Historische niet-afgeronde orders kunnen finalisatie blokkeren, ook al is
bestellen uit de app verwijderd. Noodzakelijke historische order-, payment- en
auditbewijzen blijven volgens het goedgekeurde retentiebeleid behouden. Omzeil
deze bescherming niet door statussen handmatig te wijzigen.

Deletionstatussen zijn `requested`, `blocked_active_order`, `deletion_pending`,
`database_redaction`, `storage_cleanup`, `verification`, `completed`,
`retry_scheduled`, `manual_review` en `dead_letter`.

Bij finale anonimisering van gekoppelde feedback/support worden bericht- en
contactciphertext, contact-/request-/sourcehashes, idempotencyveld, route,
screenshotrelatie en user-agentfamilie samen gewist. Dit raakt alleen inzendingen
waarvan `submitted_by_id` exact het verwijderde account is. Reeds anonieme of
andermans inzendingen blijven ongemoeid. Dit gebeurt niet bij export of het
initiële verzoek, zodat export vóór verwijdering mogelijk blijft.

## Worker en configuratie

De dagelijkse Vercel-cron `GET /api/internal/cron/account-lifecycle` vereist
Bearer `CRON_SECRET`. Deze verwerkt een begrensde accountbatch en een aparte
begrensde slice orphan-mediaonderhoud. Leases, backoff en dead letters maken
hervatting mogelijk; sla geen statussen of manifestitems handmatig over.

Orphan-cleanup verwijdert alleen oude private objecten zonder beschermende
databaserelatie. De hervatbare `temporary`/`originals`/`display`-cursors staan als
geleasede maintenance-events in de outbox. Hiervoor is ook de mediaworkerrol
nodig. Dit is geen tweede pad voor mediaverwerking.

Benodigd zijn `DATABASE_URL`, de afzonderlijke `DATABASE_ACCOUNT_WORKER_URL`,
de PII-keyring/current version/blind-index, `ACCOUNT_RETENTION_POLICY_VERSION`,
`ACCOUNT_RETENTION_POLICY_APPROVED_AT`, `BLOB_READ_WRITE_TOKEN` en `CRON_SECRET`.
Bewaar bestaande encryptiesleutels zolang bewaarde gegevens ze nodig hebben.

De accountworker heeft geen algemene table-DML, alleen execute op eigen
begrensde functies. De bestaande [rolconfiguratie](../scripts/setup/configure-database-roles.sql)
en [rolcontrole](../scripts/setup/verify-database-roles.sql) leggen deze grens vast.
Bewaar bij onderzoek alleen omgeving, SHA, job-ID, aantallen en veilige
foutcodes. Deel geen exports, persoonsgegevens, cookies of objectkeys.
