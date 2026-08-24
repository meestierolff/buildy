# Account lifecycle

> **ARCHIEF — GEEN ACTIEVE RUNTIME-INSTRUCTIE.** Dit document bewaart de
> voormalige Better Auth/R2/e-mailworkergrens. Gebruik de actuele
> [`ACCOUNT_LIFECYCLE.md`](../../ACCOUNT_LIFECYCLE.md), met Google OIDC-sessies,
> private Vercel Blob en zonder e-mailprovider.

Buildy behandelt sessiebeheer, data-export en accountverwijdering als server-owned accountflows. De browser krijgt nooit Better Auth-sessiontokens, R2-credentials, objectkeys of signed export-URL's.

## HTTP-boundary

- `GET /api/account/sessions` leest de actuele Better Auth-sessies.
- `DELETE /api/account/sessions/:sessionId` trekt alleen een sessie van de ingelogde gebruiker in.
- `GET /api/account/exports` toont maximaal twintig eigen exports.
- `POST /api/account/exports` maakt actor-scoped, idempotent een exportjob.
- `GET|HEAD /api/account/exports/:jobId/download` streamt een gereed, niet-verlopen archief na controle van lengte en SHA-256. De R2-bucket blijft privé.
- `POST /api/account/deletion` vereist `VERWIJDEREN` en daarnaast een sessie van maximaal tien minuten oud of verificatie van het huidige wachtwoord.

Alle mutaties leiden de actor af uit de authoritative Better Auth-session en de actieve `auth_identity_mappings`-koppeling. Een user- of owner-ID uit browserinput wordt niet geaccepteerd. Client-idempotencykeys worden met actor en operatie gehasht voordat ze de databaseboundary bereiken.

## Data-export

`app_request_account_export` maakt een `export_jobs`-record en een private `export_archive`-asset. De dedicated accountworker:

1. claimt één job met `FOR UPDATE SKIP LOCKED` en een begrensde lease;
2. maakt een consistente databasesnapshot en selecteert optioneel alleen actuele, gereedstaande media met vastgelegde lengte en checksum;
3. ontsleutelt PII uitsluitend binnen de worker met de versioned keyring;
4. maakt een begrensde, deterministische ZIP met `data.json`, optionele media en `manifest.json`;
5. verifieert bronchecksums en de bevestigde R2-upload voordat job en asset atomair `ready` worden;
6. verwijdert het private archief na zeven dagen en verifieert daarna dat het object afwezig is.

Transient providerfalen krijgen exponential backoff. Corrupte snapshots/checksums en uitgeputte retries gaan fail-closed naar `dead_letter`. Als accountverwijdering een reeds geleasete export annuleert, verwijdert de worker een eventueel geschreven archief als compensatie.

## Accountverwijdering

De requestfunctie verwijdert geen account- of projectrijen. Zij voert onder één actor-lock het volgende uit:

- controleert actieve bouwboekorders met een expliciete fail-closed classifier;
- schrijft een blocked job zonder lifecyclemutatie als nog een order actief is;
- inventariseert private objecten in `deletion_assets` en legt een SHA-256 van het geordende manifest vast;
- annuleert exports, ontkoppelt de avatar en zet account/projecten op `deletion_pending` en privé.

De accountworker verwijdert vervolgens exact één geïnventariseerd R2-object per lease, controleert de afwezigheid en markeert het pas daarna `verified`. De finale databasejob controleert actieve orders opnieuw. Daarna worden niet-wettelijk benodigde relaties verwijderd of geredigeerd, Better Auth-identiteit en sessies verwijderd, projecten/profiel getombstoned en de `app_users`-rij `deleted` gemaakt.

Geordende bouwboekproofs, order-/payment-/fulfilmentledger en append-only auditbewijzen blijven minimaal behouden vanwege uitvoering, klachten, fraude en wettelijke bewaarplichten. Zij houden alleen de stabiele tombstone-ID en noodzakelijke commerciële bewijzen; gewone projectinhoud, objecten en direct account-PII worden verwijderd of geredigeerd.

## Least privilege en configuratie

`DATABASE_ACCOUNT_WORKER_URL` moet een dedicated rol gebruiken die geen tabel-DML en uitsluitend execute op `app_account_worker_*` heeft. De webrol krijgt alleen de twee requestfuncties. Configureer en controleer dit met:

```sh
psql "$DATABASE_DIRECT_URL" \
  -v buildy_web_role='<web-role>' \
  -v buildy_account_worker_role='<account-worker-role>' \
  -v buildy_email_worker_role='<email-worker-role>' \
  -v buildy_media_worker_role='<media-worker-role>' \
  -v buildy_photobook_worker_role='<photobook-worker-role>' \
  -v buildy_payment_worker_role='<payment-worker-role>' \
  -f scripts/setup/configure-database-roles.sql
```

De runtime vereist daarnaast de private R2-configuratie, `CRON_SECRET` en de bestaande PII-keyring. `ACCOUNT_RETENTION_POLICY_VERSION` en `ACCOUNT_RETENTION_POLICY_APPROVED_AT` moeten de expliciet door eigenaar/boekhouder/privacyreview goedgekeurde beleidsversie vastleggen; zolang één waarde ontbreekt blijft de account-lifecyclecapability fail-closed `unconfigured`. Er is geen wettelijke termijn in code verzonnen. Vercel roept `/api/internal/cron/account-lifecycle` met `Authorization: Bearer $CRON_SECRET` aan.

## Verificatie

De unit- en contracttests dekken actorbinding, step-up, tokenredactie, private checksumdownloads, ZIP-padveiligheid, manifesten, leases, retries, dead-letter en objectverificatie. `tests/db/account-lifecycle.integration.test.ts` draait in CI tegen een disposable echte PostgreSQL 16-database en bewijst RLS, idempotency, no-table-access voor de worker en jobgedreven redactie. Er worden geen echte R2-, Stripe-, Peecho- of andere providercalls gedaan.
