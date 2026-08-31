# Private beta operations

## Contract

`BETA_MODE` is standaard `true`. Dan hebben alleen nieuwe Google OIDC-accounts
een geldige invite-reservation nodig; bestaande gekoppelde Google-users kunnen
blijven inloggen. `BETA_MODE=false` opent nieuwe Google-registratie en is geen
incident-killswitch.

Er is geen e-mail/magic-link/wachtwoordregistratie. De actieve authpagina
reserveert invites uitsluitend met provider `google`; eventuele historische
emailproviderwaarden in append-only data/contracts zijn geen actieve loginflow.

## Registratiegrens

1. Browser post invitecode, `provider=google` en idempotencykey naar
   `POST /api/beta/reservations`.
2. Server hasht code/source en slaat alleen blind indexes plus hash van een
   tien minuten geldig opaque reservationtoken op.
3. Alleen een `HttpOnly`, `SameSite=Lax`, op HTTPS `Secure` cookie onder
   `/api/auth` draagt dat token naar de Google callback.
4. Tijdens één databasetransactie verifieert Buildy invite status/expiry/
   allowlist/usage tegen de door Google geverifieerde e-mail, maakt app-user,
   profile en identity mapping en consumeert exact één use.
5. Falen rolt identity/domainmutaties samen terug; concurrency kan usage niet
   overschrijden.

Unknown/expired/revoked/exhausted/mismatch geeft dezelfde publieke fout.
Plain codes, token, Google subject/e-mail en blind indexes horen niet in logs,
URL's, auditmetadata of screenshots.

## Endpoints en beheer

- `GET /api/beta/status` — label en invite requirement;
- `POST /api/beta/reservations` — publieke, origin-beveiligde reservering;
- `POST /api/product-events` — strikt allowlisted first-party events.

Invitebeheer gebruikt uitsluitend `bun run beta:invites` met de migration-owner
en secretfile mode `0600`. Plaats de invitecode nooit als shellargument, ticket,
chat of log. Adminfuncties blijven revoked van runtime/public.

## Productevents

De RLS-enabled first-party ledger accepteert alleen versioned eventnamen en
begrensde properties. Hij mag pseudonieme subject/time/environment/resultaten
bevatten, nooit naam, e-mail, adres, caption/comment, media/PDF/Checkout-URL,
sessiontoken of provider-ID. Er is geen third-party analytics-SDK.

## Rolloutgate

Bewijs op de doel-Preview: invalid/expired/revoked/exhausted/mismatch parity,
same-key replay, concurrent one-use, bestaand Google-account, nieuwe Google
callback, cookie scope/expiry, geen secret/PII in response/log/audit en veilige
productevents. Breid cohorts alleen uit met goedgekeurde tester/privacycopy.

De echte Google Previewregistratie en interactieve journey zijn nog niet
bewezen; Browser MCP was door de huidige Codex-gebruikslimiet geblokkeerd.
Publieke registratie en productie blijven **NO-GO**.
