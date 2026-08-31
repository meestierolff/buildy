# Provider setup

Status: actieve providerinventaris; bevat geen credentials.

## Providerkaart

| Capability | Actieve provider | Niet actief |
| --- | --- | --- |
| web/functions/accountcron | Vercel | tweede application backend; media-/photobookcron |
| database/RLS | Neon PostgreSQL | browser-direct databasegebruik |
| login | Google OpenID Connect | Better Auth, wachtwoord/e-mailauth |
| customer-media/proofs/exports | private Vercel Blob | R2, S3, publieke objecten |
| betaling | Stripe-hosted Checkout | clientbedragen, browser-betaalbewijs |
| print | menselijke operator + goedgekeurde drukker | Peecho API/callback/worker/env |
| supportstatus | Buildy UI en handmatig proces | Brevo/transactionele e-mail |

## Environmentvolgorde

1. Richt eerst een geïsoleerd Preview/stagingdoel in met synthetische data.
2. Gebruik unieke provideraccounts/tokens/DB-branches of minimaal strikt
   gescheiden testcredentials.
3. Verifieer alle automatische én handmatige checks.
4. Bereid Production afzonderlijk voor; kopieer geen testkeys of fixtures.
5. Activeer live commerce alleen na het formele releasebesluit.

De runtime verwacht voor het providercheck-script `APP_ENV=staging` bij het
beschermde Preview/stagingdoel en `APP_ENV=production` met exact
`PRIMARY_DOMAIN=APP_ORIGIN` in Production.

## Neon

- gebruik `DATABASE_URL` voor pooled webruntime;
- unieke worker-URL's voor account, media, photobook en payment;
- `DATABASE_MIGRATION_URL` alleen voor de dedicated migrator;
- `DATABASE_DIRECT_URL` alleen voor gecontroleerde setup/read-only checks;
- configureer/verifieer de vijf actieve rollen en RLS;
- bewijs check, dry-run, apply, `db/verify`, no-op replay en restore.

Alleen account lifecycle heeft een dagelijkse Vercel schedule en gebruikt
`CRON_SECRET`. Media-completion en Bouwboekproofrequests verwerken exact hun
asset/revisie request-driven onder de bijbehorende workerrol. Die twee
capabilities vereisen hun worker-URL plus private Blob, niet het cronsecret. De
dagelijkse accountendpoint mag, na dezelfde cronautorisatie, wel een strikt
begrensde hervatbare orphan-cleanupslice aan de mediaworkerrol delegeren; dit
claimt nooit generiek mediaverwerkingswerk.

## Google OIDC

- scopes: `openid profile email`;
- exacte HTTPS-origin en callback `/api/auth/callback/google`;
- afzonderlijke Preview/staging- en Productionconfig;
- bewijs new/existing login, callback, logout, revocation en veilige redirect;
- geen `SESSION_SECRET`, wachtwoord- of e-mailproviderconfig.

Zie [GOOGLE_AUTH_SETUP.md](GOOGLE_AUTH_SETUP.md).

## Private Vercel Blob

- maak per omgeving een aantoonbaar private store;
- zet alleen `BLOB_READ_WRITE_TOKEN` in de juiste environment;
- bewijs begrensde upload, checksum/size, exact-asset/exact-revision processing,
  owner-poll retry, geautoriseerde read, denial, delete en cleanup;
- bewaar geen permanente provider-URL in customerdata of evidence.

Zie [VERCEL_BLOB_SETUP.md](VERCEL_BLOB_SETUP.md).

## Stripe

- Preview: `CHECKOUT_MODE=test`, `STRIPE_ENVIRONMENT=test`, testkey/webhook;
- Production live: afzonderlijke live key/webhook/account-ID en approvals;
- configureer `DATABASE_PAYMENT_WORKER_URL`, PII-config, verwachte account-ID,
  actuele price matrix, seller-envelope en termsversie;
- registreer exact `POST /api/webhooks/stripe`;
- bewijs account/mode, Checkout, bedragen/valuta, signature, idempotency,
  failures/expiry en refund.

Zie [STRIPE_SETUP.md](STRIPE_SETUP.md).

## Printprovider

De actieve runtime heeft geen printprovidercredential. Een admin downloadt na
betaling de exact geverifieerde proof en plaatst hem handmatig in het vooraf
goedgekeurde drukkerportaal. Providerkeuze, DPA/contract, quote, product,
proefdruk, tracking en refunds zijn menselijke gates. Zie
[MANUAL_PEECHO_FULFILMENT.md](MANUAL_PEECHO_FULFILMENT.md).

## Read-only verificatie

Met de volledige environment veilig geladen:

```sh
bun run setup:providers -- --staging --check
bun run setup:providers -- --production --check
```

Voer de productioncheck pas na approval uit. De commandoutput verbergt secrets
en markeert dashboard-/contractchecks bewust `manual`; een pass is geen release-
GO en maakt geen order/deployment.

De private-Blobprobe is bewust fail-closed: de read-only check selecteert en
inspecteert metadata van één bestaand object uit de doelstore. Een lege store,
een publieke Blob-host of afwijkende metadata levert geen privacybewijs op.

De echte Preview-/providerrondreizen zijn in de huidige snapshot niet bewezen.
Production blijft NO-GO, mede omdat het gekoppelde Vercel-plan Hobby was en de
verplichte Browser MCP-runtime door de huidige Codex-gebruikslimiet geblokkeerd
was.
