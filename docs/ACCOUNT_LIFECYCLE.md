# Account lifecycle

Status: actieve Google OIDC-/Neon-/Vercel Blob-runtime.

Buildy behandelt sessies, data-export en accountverwijdering als server-owned
flows. De browser ontvangt geen providercredentials, sessietoken voor eigen
opslag, Blob-objectkey of permanente download-URL.

## Sessies

Google OpenID Connect is de enige loginmethode. Na de geverifieerde callback
maakt Buildy een opaque, high-entropy sessie aan; alleen de tokenhash staat in
Neon. De cookie is `HttpOnly`, `SameSite=Lax` en op HTTPS `Secure`.

Actieve routes:

- `GET /api/account/sessions` — maximaal de eigen server-owned sessies;
- `DELETE /api/account/sessions/:sessionId` — trekt alleen een eigen sessie in.

De server leidt de actor af uit de cookie en identity mapping. Clientheaders,
profiledata of requestbody kunnen geen gebruiker kiezen. Er is geen Better
Auth, wachtwoord, magic link, e-mailverificatie, resetflow of `SESSION_SECRET`.

## Data-export

Actieve routes:

- `GET /api/account/exports`;
- `POST /api/account/exports` met actor-scoped idempotencykey en optionele media;
- `GET|HEAD /api/account/exports/:jobId/download`.

De dedicated accountworker claimt begrensd één job, maakt een ZIP met
`data.json`, optionele actuele media en `manifest.json`, ontsleutelt PII alleen
binnen de worker en controleert bron- en archiefchecksums. Media wordt alleen
geaccepteerd wanneer `storageProvider=vercel_blob` en bucket/object exact bij de
geconfigureerde private store horen.

Download is owner-only, `private, no-store`, same-origin en pas mogelijk nadat
bytegrootte en SHA-256 van het private Blob-object overeenkomen. Het contract
begrensd een archief tot 250 MiB. Exportstatus is een van `requested`,
`processing`, `retry_scheduled`, `ready`, `expired`, `failed`, `dead_letter` of
`deleted`.

## Accountverwijdering

`POST /api/account/deletion` vereist:

- een ingelogde actor;
- exact de bevestiging `VERWIJDEREN`;
- een actor-scoped idempotencykey;
- een huidige sessie die maximaal tien minuten geleden is aangemaakt.

Is die sessie ouder, dan moet de gebruiker opnieuw via Google inloggen. Er is
geen wachtwoord-step-up. De requestfunctie voert de langdurige cleanup niet in
de browserrequest uit.

De database inventariseert private assets en maakt de Verbouwing/accountdata
fail-closed onzichtbaar. Actieve Bouwboekorders blokkeren finalisatie. De worker
verwijdert vervolgens alleen geïnventariseerde private Blob-objecten, controleert
na iedere delete dat het object afwezig is en rondt redactie/tombstoning pas af
wanneer de order- en storagegates opnieuw slagen.

Mogelijke deletionstatussen zijn `requested`, `blocked_active_order`,
`deletion_pending`, `database_redaction`, `storage_cleanup`, `verification`,
`completed`, `retry_scheduled`, `manual_review` en `dead_letter`. Wettelijk of
contractueel noodzakelijke order-, payment-, fulfilment- en append-only
auditbewijzen kunnen onder het goedgekeurde retentiebeleid blijven; gewone
projectinhoud en directe account-PII worden verwijderd of geredigeerd.

Wanneer gekoppelde feedback/support bij finalisatie wordt geanonimiseerd, wist
de databasegrens in dezelfde update eerst bericht- en contactciphertext,
contact-/request-/sourcehashes, idempotencyveld, route, screenshotrelatie en
user-agentfamilie. Alleen een inzending waarvan `submitted_by_id` exact het te
verwijderen account is wordt geraakt; reeds anonieme inzendingen van anderen
blijven ongewijzigd. De trigger draait pas bij finale anonimisering, niet bij
export of het eerste verwijderverzoek, zodat export-before-delete intact blijft.

## Worker en configuratie

De dagelijkse Vercel-cron `GET /api/internal/cron/account-lifecycle` vereist
`Authorization: Bearer $CRON_SECRET`. De endpoint verwerkt een strikt op
claimaantal en tijd begrensde accountbatch en reserveert binnen de
Vercel-functieduur een aparte slice voor orphan-mediaonderhoud. Het
response-overzicht bevat alleen operationele aantallen, interne job-ID's van
nieuwe dead letters en veilige foutcodes, nooit PII of objectkeys. Retries
gebruiken leases en begrensde backoff; na uitgeputte of niet-retryable fouten
volgt `dead_letter`/menselijke beoordeling. Statusrijen worden niet handmatig
overgeslagen.

Orphan-cleanup is geen tweede mediaverwerkingspad. Alleen oude private Blob-
objecten zonder beschermende databaserelatie komen in aanmerking. De drie
privacyvrije `temporary`/`originals`/`display`-cursors leven als geleasede
maintenance-events in de bestaande outbox, zodat iedere dagelijkse begrensde
slice hervat en deletefouten retry/dead-letterbaar blijven. Deze cleanup draait
alleen wanneer ook de geïsoleerde mediaworkerrol is geconfigureerd.

Benodigd voor de capability:

- `DATABASE_URL`;
- een unieke `DATABASE_ACCOUNT_WORKER_URL`;
- Google OIDC en de PII-keyring/blind-index;
- `ACCOUNT_RETENTION_POLICY_VERSION` en een geldige
  `ACCOUNT_RETENTION_POLICY_APPROVED_AT`;
- private `BLOB_READ_WRITE_TOKEN`;
- `CRON_SECRET`.

De accountworker heeft geen table-DML en alleen execute op zijn eigen
`app_account_worker_*`-functies. Configureer en verifieer samen met de vier
andere actieve rollen via `scripts/setup/configure-database-roles.sql` en
`scripts/setup/verify-database-roles.sql`. Er is geen e-mailworkerrol.

## Operationele gates

Vóór productie moeten op een tijdelijke clean room en daarna Preview zijn
bewezen: session listing/revocation, reauth, idempotente export/deletion,
inclusieve exportchecksum, private denial, expiry/cleanup, active-order block,
retry/dead-letter, Blob delete-readback en finale PII-redactie. Gebruik alleen
synthetische data en leg geen export of persoonsgegevens als testartifact vast.

Een echte Google-, Blob- en Preview-rondreis is in de huidige release-snapshot
niet bewezen. De verplichte Browser MCP-runtime was door de huidige Codex-
gebruikslimiet geblokkeerd; interactieve accountverificatie en productie
blijven **NO-GO**.
