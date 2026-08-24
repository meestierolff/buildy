# Transactionele e-mail

> **ARCHIEF — GEEN ACTIEVE RUNTIME-INSTRUCTIE.** Deze beschrijving bewaart het
> voormalige Brevo/outboxontwerp. De production-MVP heeft geen e-mailprovider,
> e-mailworker, e-mailwebhook, e-mailcron of bijbehorende env. Historische
> migrations/data mogen blijven; voeg deze runtime niet opnieuw toe op basis van
> dit document.

Buildy verstuurt transactionele e-mail uitsluitend vanuit de duurzame
PostgreSQL-outbox. Een gebruikersrequest, Stripe-webhook of Peecho-callback
roept Brevo nooit rechtstreeks aan. Daardoor blijft de domeintransactie leidend
en is iedere logische mail idempotent, leasebaar en herstelbaar.

## Runtimepad

1. De producer schrijft een allowlisted `outbox_events`-record met een stabiele
   idempotentiesleutel. Account-, social-, order- en community-events bevatten alleen versie,
   aggregate-ID en minimale ontvangstmetadata; nooit e-mailadres, vrijetekst,
   adres, signed URL of providerpayload.
2. `app_email_worker_claim` claimt maximaal 25 geschikte events met
   `FOR UPDATE SKIP LOCKED`. Een verlopen lease kan opnieuw worden geclaimd.
3. Voor authmail staat recipient/action-URL alleen als AES-256-GCM-envelope in
   het event. Voor ordermail geeft `app_email_worker_load_order` de versleutelde
   commerciële snapshot uitsluitend vrij aan de worker die de actuele lease
   van precies dat event bezit. Communitybevestigingen gebruiken dezelfde grens
   via `app_email_worker_load_community_receipt`: alleen recipient-ciphertext,
   de bestaande blind index, ontvangstcode en allowlisted context komen vrij.
   Welcome-, toegangs-, security- en migratiemails gebruiken
   `app_email_worker_load_account_event`; het versleutelde adres komt uit
   `email_recipient_profiles` en is gebonden aan AAD
   `email-recipient:{userId}:address`.
4. De Node-worker ontsleutelt in geheugen met veld- en aggregategebonden AAD,
   controleert eventtype, idempotentiesleutel, serverstatus, bedragen, land,
   terms en seller snapshot, en rendert Nederlandse HTML plus platte tekst.
5. `app_email_worker_prepare` legt vóór de providercall alleen recipient blind
   index, template/contentversie en logische idempotentiesleutel vast. Voor
   ordermail wordt ook de interne recipient-user-ID gezet; plaintext PII komt
   niet in deliverymetadata.
6. Brevo ontvangt één templatebericht (auth) of repo-native HTML/tekst (account,
   social, order en communitybevestiging)
   met een deterministisch provider-idempotentie-UUID. Na acceptatie worden
   provider-message-ID en `submitted_at` atomair vastgelegd.
7. Brevo-deliverywebhooks bewaren uitsluitend een hash en geminimaliseerde
   status/tijdgegevens. Replay en events buiten volgorde zijn monotone.

## Ondersteunde ordermails

| Event | Contentversie | Vereiste actuele serverstatus |
|---|---|---|
| `order.email.confirmation.requested.v1` | `order.confirmation` | betaald; `paid_at` aanwezig |
| `order.email.payment_failed.requested.v1` | `order.payment_failed` | order en betaling beide mislukt |
| `order.email.in_production.requested.v1` | `order.in_production` | in productie of al verder |
| `order.email.shipped.requested.v1` | `order.shipped` | verzonden of geleverd |
| `order.email.refund_review.requested.v1` | `order.refund_review` | gedeeltelijk/volledig terugbetaald |

Een stale payment-failure-event nadat de order alsnog is betaald wordt dus niet
als misleidende mail verzonden. Een Stripe-refund annuleert Peecho niet; de mail
meldt expliciet dat betaal- en fysieke productiestatus handmatig worden
beoordeeld.

De duurzame bevestiging komt volledig uit de immutable ordersnapshot en bevat
ordernummer/datum, product en paginatal, aantal, bedrag/btw/verzending/totaal en
valuta, leverindicatie en bestemming, juridische verkoper/contactgegevens,
geaccepteerde termsversie, maatwerkmededeling en een HTTPS-link naar de
authenticated orderstatus.

## Ondersteunde communitybevestigingen

| Event | Contentversie | Privacygrens |
|---|---|---|
| `moderation.report.received.requested.v1` | `moderation.report_received` | Exacte meldingslease; AAD `moderation-report:{id}:contact` |
| `support.confirmation.requested.v1` | `support.confirmation` | Alleen support/derdenverzoek/bezwaar; AAD `feedback-submission:{id}:contact` |

De worker vergelijkt het ontsleutelde adres constant-time met de opgeslagen
`email-recipient` blind index en controleert eventtype, aggregate-ID, exacte
payload, ontvangstcode en idempotentiesleutel. De Nederlandse ontvangstmail
bevat alleen de code en, bij support, het allowlisted verzoektype. Vrijetekst,
doel-ID en contactadres worden bewust niet teruggekaatst.

## Account-, social- en migratiemails

| Event | Contentversie | Producer en voorkeur |
|---|---|---|
| `lifecycle.welcome.requested.v1` | `lifecycle.welcome` | precies één event wanneer `last_authenticated_at` voor het eerst succesvol wordt gezet; een beschermd recipientrecord is vooraf verplicht |
| `social.access_requested.requested.v1` | `social.access_requested` | na een nieuw pending projectverzoek; alleen voor een actieve eigenaar met `social_access_enabled` |
| `social.access_accepted.requested.v1` | `social.access_accepted` | uitsluitend bij de overgang pending → accepted; alleen voor een actieve aanvrager met `social_access_enabled` |
| `security.account_alert.requested.v1` | `security.account_alert` | bij een accountverwijderverzoek, ook wanneer een actieve order het verzoek blokkeert |
| `migration.account.requested.v1` | `migration.account` | uitsluitend via de cutover-only producer en alleen voor een actieve, geïmporteerde identiteit |

Welcome, security en migratie zijn operationele serviceberichten en geen
marketingmail. Sociale toegangsmails zijn afzonderlijk uit te zetten via
`app_set_social_access_email_preference`; gemigreerde gebruikers starten
privacyveilig met deze voorkeur uit totdat zij haar zelf activeren. Een
historische data-import zet transaction-local `app.migration_mode=on`, zodat
oude accessrijen nooit actuele e-mails veroorzaken.

`app_enqueue_migration_account_email` is niet aan een langlevende runtimerol
toegekend. Het cutovercommando `enqueue-migration-account-mails` leest adressen
alleen uit het versleutelde source-exportartifact, versleutelt elk adres vóór de
parameterized databasecall en schrijft uitsluitend aantallen en artifacthashes
naar output. Zonder `--execute` en de run-/host-/backup-/acceptatiegates is het
commando dry-run.

## Configuratie en least privilege

- `DATABASE_EMAIL_WORKER_URL` gebruikt een eigen loginrol zonder tabel-DML.
- `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` en `BREVO_SENDER_NAME` zijn per
  environment gescheiden.
- `BREVO_TEMPLATE_IDS` bevat alle sleutels uit `AUTH_EMAIL_TEMPLATE_KEYS`,
  `ORDER_EMAIL_TEMPLATE_KEYS`, `COMMUNITY_EMAIL_TEMPLATE_KEYS` en
  `ACCOUNT_EVENT_EMAIL_TEMPLATE_KEYS`. Auth gebruikt
  het numerieke Brevo-template-ID. Repo-native order- en communitycontent
  gebruikt het positieve ID alleen als
  environment-configuratieanker; `version` is het duurzame contentbewijs.
- `APP_ORIGIN` moet voor ordermail HTTPS en padloos zijn.
- `CRON_SECRET` beschermt de workerroute. Een minuutcron vereist op Vercel een
  geschikt abonnement; Hobby is hiervoor geen productieconfiguratie.

Voer `scripts/setup/configure-database-roles.sql` na migrations uit en laat
`scripts/setup/verify-database-roles.sql` bewijzen dat alleen de e-mailworker
`app_email_worker_load_order(uuid,text)`,
`app_email_worker_load_community_receipt(uuid,text)`,
`app_email_worker_load_account_event(uuid,text)` en de overige workerfuncties
kan uitvoeren. De web-, account-, media-, Bouwboek-, betaal- en
fulfilmentrollen worden expliciet van alle PII-loaders uitgesloten.

## Tests, preview en live gate

`bun run test` dekt payload/AAD-mismatches, stale status, idempotentie,
providerfouten, retries, deliveryreplay en beide adaptermodi zonder Brevo aan te
roepen. `bun run email:previews` maakt een expliciet synthetische HTML- en
tekstpreviews in `artifacts/email/`, inclusief alle vijf account-/socialvarianten.
CI genereert en bewaart deze veertien dagen
als testartifact; hij bevat geen echte klant-, order-, adres- of verkoperdata.

Live e-mail blijft NO-GO totdat het aparte Buildy-afzenderdomein, DKIM/SPF/DMARC,
environment-templateconfiguratie, webhooksecret en één synthetische stagingmail
met accepted én delivered/bounce-bewijs werkelijk zijn gecontroleerd. Bewaar
geen recipient, onderwerp, raw webhookbody of providersecret in logs of bewijs.
