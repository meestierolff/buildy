# Provider setup

Dit runbook beschrijft de production-target. Het bevat geen credentials en mag
uitsluitend met environment-specifieke test- of productieaccounts worden
uitgevoerd. Voer stappen in deze volgorde uit en noteer bewijs in het
launchrapport; een gecompileerde build is geen providerbewijs.

## 1. Lokale vereisten

- Bun volgens `packageManager` in `package.json`;
- actuele `neonctl` (`brew install neonctl` of een expliciet gepinde CI-versie);
- `psql` voor rolconfiguratie en restore rehearsals;
- Vercel CLI;
- Stripe CLI;
- Wrangler of de Cloudflare API voor R2;
- toegang tot de juiste Brevo-, Stripe-, Peecho-, Cloudflare-, Neon- en Vercelaccounts.

Controleer versies zonder secrets te printen. Bewaar API-keys alleen in de
provider-secretstore en in Vercel-environmentvariabelen. Gebruik `.env.example`
als namenlijst, nooit als waardenbron.

## 2. Neon

1. Authenticeer `neonctl` en voer `neonctl link` uit in de repository. De
   actuele branch-first CLI bewaart projectmetadata lokaal in `.neon`; commit
   geen verbindingstrings.
2. Gebruik afzonderlijke branches voor local, preview, staging en production.
   `neonctl checkout` kiest of maakt de werkbranch; `neonctl env pull` haalt de
   environmentconfig op. Previewbranches mogen uitsluitend synthetische of
   aantoonbaar geanonimiseerde data bevatten.
3. Plaats de beperkte, pooled webrol-URL in `DATABASE_URL`. Plaats de directe
   applicatiemigratierol-URL uitsluitend in `DATABASE_MIGRATION_URL`; alleen de
   schema-runner (`db:migrate`, `db:verify` en `db:migrate --check`) leest die
   variabele. Reserveer `DATABASE_DIRECT_URL` voor gecontroleerde
   rolconfiguratie, legacy-targetimport en expliciete beheer-/backuphandelingen.
   De web-, migratie- en beheerlogin zijn niet uitwisselbaar.
4. Maak zeven afzonderlijke bestaande loginrollen voor web, account-lifecycle,
   e-mail, media, Bouwboek-rendering, de Stripe-webhook en Peecho-fulfilment. Geen rol mag
   superuser, `BYPASSRLS`, database-eigenaar of tabeleigenaar zijn. Workerrollen
   krijgen geen tabel-DML; zij voeren uitsluitend hun expliciete
   `SECURITY DEFINER`-functies uit. Gebruik per rol een eigen pooled connection
   string voor de betreffende runtimevariabele.
5. Pas migraties transactioneel toe met de expliciete schemarunner-URL, daarna
   de verificatie en ten slotte een tweede migratierun voor het no-opbewijs:

   ```sh
   DATABASE_MIGRATION_URL='<migration-role-url>' bun run db:migrate
   DATABASE_MIGRATION_URL='<migration-role-url>' bun run db:verify
   DATABASE_MIGRATION_URL='<migration-role-url>' bun run db:migrate
   ```

   De ledger moet alle 23 append-only migraties `0001`–`0023` bevatten;
   `db:verify` verwacht 48 publieke tabellen en 43 tabellen met RLS. Dit is
   codeconfiguratie, geen claim dat staging of productie al is gemigreerd.
6. Configureer privileges als migration owner:

   ```sh
   psql "$DATABASE_DIRECT_URL" \
     -v buildy_web_role='<web-role>' \
     -v buildy_account_worker_role='<account-worker-role>' \
     -v buildy_email_worker_role='<email-worker-role>' \
     -v buildy_media_worker_role='<media-worker-role>' \
     -v buildy_photobook_worker_role='<photobook-worker-role>' \
     -v buildy_payment_worker_role='<payment-worker-role>' \
     -v buildy_fulfilment_worker_role='<fulfilment-worker-role>' \
     -f scripts/setup/configure-database-roles.sql
   ```

7. Verifieer dezelfde namen met `scripts/setup/verify-database-roles.sql` en
   voer `/api/readiness` uit via de webrol. De check faalt bewust wanneer RLS
   niet actief is of een begrensde functiegrant ontbreekt.

8. Laat de webrol voor private beta uitsluitend
   `app_reserve_beta_invite(...)`, `app_complete_beta_signup(...)` en
   `app_record_client_product_event(...)` uitvoeren. De create/revoke-
   adminfuncties blijven migration-owner-only. Zet `BETA_MODE=true`; bewijs vóór
   een testercode zowel bestaande login als nieuwe e-mail- en Google-registratie.
   Zie `docs/PRIVATE_BETA.md`. `BETA_MODE=false` opent registratie en is geen
   incident-kill-switch.

Bronnen: [Neon CLI](https://neon.com/cli),
[Neon connection pooling](https://neon.com/docs/connect/connection-pooling).

## 3. Cloudflare R2

1. Maak per omgeving een private bucket; zet publieke bucket access uit.
2. Deel binnen één omgeving uitsluitend `R2_ACCOUNT_ID` en `R2_BUCKET_NAME`.
   Maak daarnaast vijf afzonderlijke bucket-scoped credentialparen met exact
   deze envnamen:

   | Boundary | Access key | Secret key |
   |---|---|---|
   | web/uploadsigning en private proxy | `R2_WEB_ACCESS_KEY_ID` | `R2_WEB_SECRET_ACCESS_KEY` |
   | account-lifecycleworker | `R2_ACCOUNT_WORKER_ACCESS_KEY_ID` | `R2_ACCOUNT_WORKER_SECRET_ACCESS_KEY` |
   | mediaworker | `R2_MEDIA_WORKER_ACCESS_KEY_ID` | `R2_MEDIA_WORKER_SECRET_ACCESS_KEY` |
   | Bouwboekworker | `R2_PHOTOBOOK_WORKER_ACCESS_KEY_ID` | `R2_PHOTOBOOK_WORKER_SECRET_ACCESS_KEY` |
   | Peecho-fulfilmentworker | `R2_FULFILMENT_WORKER_ACCESS_KEY_ID` | `R2_FULFILMENT_WORKER_SECRET_ACCESS_KEY` |

   Ieder access-key-ID en ieder secret moet uniek zijn. Er bestaat bewust geen
   generieke `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`-fallback; ontbreekt één
   boundarypaar, dan blijft die capability fail-closed. Deel geen workercredential
   met webverkeer, een andere worker of CI-previewjobs.
   De offline legacy-storagecopy gebruikt bovendien alleen tijdens een
   goedgekeurde rehearsal of cutover een apart, kortlevend operatorpaar:
   `R2_MIGRATION_ACCESS_KEY_ID` / `R2_MIGRATION_SECRET_ACCESS_KEY`, samen met
   `R2_MIGRATION_ENDPOINT`. Dit is geen zesde runtimeboundary, wordt nooit als
   fallback gebruikt en wordt na het vastgelegde rollbackwindow ingetrokken.
3. Sta CORS alleen toe voor de exacte Buildy-origins en de werkelijk gebruikte
   uploadmethodes/headers. Gebruik geen `*` bij credentials.
4. Configureer lifecycle cleanup voor tijdelijke uploads pas nadat de database-
   en orphan-sweeperretentie zijn afgestemd.
5. Bewijs met een synthetisch object: signed upload, checksum/magic-bytecheck,
   verwerking, private proxy-read, verlopen grant en delete/verificatie. Een
   directe object-URL hoort 403/404 te geven.

## 4. Brevo

1. Verifieer een aparte Buildy-sender en rond DKIM, SPF en DMARC af. Leg de
   DNS-resultaten vast zonder API-key of ontvangstadres te loggen.
2. Maak per environment de templates uit `server/email/templates.ts`. Bewaar
   hun numerieke ID en contentversie in één `BREVO_TEMPLATE_IDS` JSON-object.
3. Configureer verificatie, magic link, wachtwoordreset, alle vijf orderkeys,
   beide ontvangstkeys en de vijf lifecycle/social/security/migratiekeys uit
   `ACCOUNT_EVENT_EMAIL_TEMPLATE_KEYS`; de e-mailcapability blijft anders
   fail-closed. Account-, social-, order- en communitycontent is repo-native, terwijl
   catalogusversie en positief environment-ID het duurzame contentbewijs vormen. Zie
   `docs/TRANSACTIONAL_EMAIL.md`.
4. Maak een transactional webhook voor request/sent, delivered, deferred,
   soft/hard bounce, invalid, blocked, spam en error. Gebruik Brevo's bearer-
   authenticatie met `BREVO_WEBHOOK_SECRET`; callback:
   `/api/webhooks/brevo`.
5. De webhook bewaart geen e-mailadres, onderwerp of raw payload. Alleen een
   payloadhash, provider-message-ID en geminimaliseerde status/tijdmetadata gaan
   naar de inbox. Replay is idempotent.
6. Voer eerst de lokale mailsink- en mocktests uit. Stuur daarna precies één
   synthetische stagingmail en bewijs accepted, webhook, delivered/bounce en
   dashboardstatus. Unit tests mogen Brevo nooit echt aanroepen.
7. Genereer met `bun run email:previews` alle synthetische HTML-/tekstpreviews.
   CI bewaart dit als tijdelijk artifact; gebruik nooit echte klant-, order-,
   adres- of verkoperdata in previews.
8. Bewijs met de dedicated e-mailrol dat
   `app_email_worker_load_community_receipt(uuid,text)` en
   `app_email_worker_load_account_event(uuid,text)` alleen binnen de exacte,
   onverlopen lease ciphertext vrijgeven. Dezelfde rol mag geen tabellen lezen;
   geen andere runtimerol mag deze loaders uitvoeren.

Bronnen: [Brevo transactional email](https://developers.brevo.com/docs/send-a-transactional-email),
[secured webhooks](https://developers.brevo.com/docs/secured-webhooks).

## 5. Vercel

1. Link deze repository aan een afzonderlijk project `buildy`. Controleer team
   en project vóór iedere `env add`, webhookwijziging of deployment.
2. Configureer Preview, Staging en Production afzonderlijk. Een preview krijgt
   nooit productie-DB-, live-Stripe-, live-Peecho- of productie-R2-credentials.
3. Zet `CRON_SECRET` als willekeurige secret van minimaal 32 tekens. Vercel
   stuurt dit automatisch als `Authorization: Bearer …` naar cronroutes.
4. `vercel.json` plant exact deze vijf routes iedere minuut (`* * * * *`):

   - `/api/internal/cron/email`;
   - `/api/internal/cron/account-lifecycle`;
   - `/api/internal/cron/media`;
   - `/api/internal/cron/photobooks`;
   - `/api/internal/cron/peecho-fulfilment`.

   Vercel Hobby ondersteunt deze minuutcadans niet; staging en productie
   vereisen daarom een plan dat alle vijf minuutcrons ondersteunt. Dit blijft
   een onbewezen provider-/abonnementslaunchgate totdat de gedeployde cronlijst,
   vijf daadwerkelijke invocaties en de gemiste-cronalerts als bewijs zijn
   vastgelegd. Verlaag de cadence niet om een ongeschikt plan passend te maken.
5. Controleer build, Functions-regio, securityheaders, cronlijst en logs. Vercel
   retryt een mislukte croninvocatie niet; leases en de volgende minuutrun
   verzorgen herstel.

Bronnen: [Vercel Cron beheren](https://vercel.com/docs/cron-jobs/manage-cron-jobs),
[cronlimieten en prijzen](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## 6. Stripe

1. Controleer eerst de account-ID en testmodus. Meng nooit test- en livesecrets.
2. Configureer checkout uitsluitend met server-owned orderregels, valuta,
   verzendlanden, btwconfiguratie en immutable printproofrevision.
3. Configureer `POST /api/webhooks/stripe` met een apart endpointsecret en
   uitsluitend deze events: `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired` en
   `charge.refunded`. De route verifieert de ongewijzigde raw body en is als
   providercallback vrijgesteld van browser-Origincontrole; de signature is de
   authenticatiegrens.
4. Gebruik `DATABASE_PAYMENT_WORKER_URL` voor de dedicated rol. Die rol kan
   geen tabellen lezen of wijzigen en mag uitsluitend
   `app_apply_stripe_payment_event(...)` uitvoeren. Deze functie vergelijkt
   order-ID, ordernummer, merchantreference, Checkout Session, PaymentIntent,
   exact bedrag en valuta, en schrijft inbox, ordertransition, eventledger en
   outbox atomair.
5. Een browserredirect is nooit betaalbewijs. Alleen een geverifieerd event kan
   `paid` zetten. Replay levert een succesvolle duplicate-uitkomst zonder een
   tweede transition; events buiten volgorde zijn monotone no-ops of gaan bij
   inconsistentie naar `manual_review`.
6. `charge.refunded` bewaart het cumulatieve refundbedrag. Een partial/full
   refund zet fysieke fulfilment voor handmatige beoordeling en annuleert geen
   Peecho-order op basis van alleen Stripebewijs.
7. Bewijs met Stripe CLI: ongeldige signature, exact replay, twee verschillende
   events buiten volgorde, async failure/success, expiry, price/currency/session
   mismatch en partial/full refund. Leg event-ID's vast, nooit payloads met PII
   of secrets.
8. Activeer live mode pas na juridische prijs-/btw-/verkopercontrole en een
   volledige sandboxorder.

Bronnen: [Stripe webhook signatures](https://docs.stripe.com/webhooks/signature),
[Checkout fulfilment en delayed payments](https://docs.stripe.com/checkout/fulfillment),
[Stripe eventtypen](https://docs.stripe.com/api/events/types).

## 7. Peecho REST v3

1. Begin op de sandbox-base-URL en verifieer merchant, product/offering-ID's,
   credits/invoicing en callbackcontract bij Peecho. Verzin geen IDs.
2. Gebruik `DATABASE_FULFILMENT_WORKER_URL` voor de dedicated no-table-DML-rol.
   Die rol mag uitsluitend de negen `app_*peecho*` fulfilment- en callbackfuncties
   uit migration 0016 uitvoeren; `/api/readiness` controleert dit contract.
3. Gebruik alleen private, tijdelijk signed printproof-URLs. De expliciete R2-
   geldigheid moet 300–604.800 seconden zijn. Create en payment zijn afzonderlijke
   stappen; het Peecho-order-ID wordt immutable opgeslagen vóór payment.
4. Configureer callback `POST /api/webhooks/peecho` in exact dezelfde test/live-
   environment. Omdat Peecho's callbackdigest alleen het order-ID dekt, leest de
   route de actuele order read-only terug en verwerkt zij uitsluitend de
   canonieke reference, status en trackingdata voor het gesigneerde order-ID.
   Gerapporteerde callbackvelden sturen zelf geen orderstate. Configureer ook
   `GET /api/internal/cron/peecho-fulfilment` via Vercel Cron en dezelfde minimaal
   32 bytes lange `CRON_SECRET`.
5. Doorloop de foutmatrix uit de hoofdopdracht, inclusief timeout vóór response,
   lokale persistfail na create, verlopen PDF-URL en callbacks buiten volgorde.
6. Laat Peecho vóór launch bevestigen wanneer download voltooid is en wat hun
   bewaartermijn is. Stem R2-verwijdering daarna af op klachten/herdruk en het
   formele privacy-/retentiebeleid; URL-expiry is geen deletebewijs.
7. Een echte productieproefdruk vereist expliciet akkoord nadat alle launchgates
   groen zijn. Zonder fysieke ontvangst mag het launchrapport dit niet claimen.

## Externe blokkades die code niet kan invullen

- provideraccounts, account-/project-ID's en environmentcredentials;
- definitief productie- en stagingdomein;
- Vercel-plan voor alle vijf minuutcrons en bijbehorende alerts;
- geverifieerd Brevo-afzenderdomein en echte template-ID's;
- Cloudflare-account, private buckets, vijf unieke runtimeparen en een alleen
  voor rehearsal/cutover uitgegeven kortlevend migratiepaar;
- Stripe account-/tax-/webhookconfiguratie;
- Peecho-contract, sandbox/live credentials, offering-ID's en credits;
- juridische verkopergegevens, btw-/prijsbesluit, voorwaarden- en privacyversie;
- formele DPA-/retentiebeoordeling en gecontroleerde fysieke proefdruk.
