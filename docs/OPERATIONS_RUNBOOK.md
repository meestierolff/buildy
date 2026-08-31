# Operations runbook

Status: actuele operatorgrens; externe alerts, rollen en restorebewijs moeten per
omgeving nog worden geconfigureerd en bewezen.

## Actieve runtime

Buildy gebruikt Vercel, Neon PostgreSQL, Google OpenID Connect, private Vercel
Blob en Stripe Checkout. Betaalde printorders worden handmatig vanuit Buildy
naar een goedgekeurde drukker overgebracht.

Niet actief: Better Auth, wachtwoord/e-maillogin, R2/S3, Brevo of een andere
e-mailprovider, Peecho API/callback/worker/poller/cron en automatische
printfulfilment. Historische tabellen en migrations zijn geen queue om te
monitoren of opnieuw te activeren.

Een groene build of `/api/health` is geen provider- of releasebewijs. Operators
zoeken op `x-request-id`, intern ordernummer en interne job-/event-ID, nooit op
e-mailadres, adres, objectkey, Checkout-URL of andere PII.

## Scheiding van rollen

| Rol | Toegang | Niet toegestaan |
| --- | --- | --- |
| on-call | Vercel alerts/logs, health/readiness, read-only providerstatus | secrets tonen, orderstatus of database handmatig muteren |
| support | Buildy customer/orderreadmodel en ontvangstcode | providerdashboard, PII-export, role grants |
| moderator | moderatiequeue en toegestane acties | admin-only suspend/block, orders plaatsen |
| order-admin | `/beheer/bestellingen`, private proof, handmatige fulfilmentacties | betaling afleiden uit redirect, proof buiten Buildy delen |
| technisch operator | dedicated read-only Neonrol en providerchecks | runtime-/workercredentials voor ad-hoc SQL |
| releaseoperator | migrator in goedgekeurd venster, Vercel release | eigenstandig legal/commercial GO geven |
| privacy/security | impact, retentie en meldplicht | incident sluiten zonder technisch bewijs |

De actieve database-identiteiten zijn migrator, web, accountworker, mediaworker,
photobookworker en paymentworker. Workerrollen hebben geen table-DML en alleen
execute op eigen begrensde functies. E-mail- en fulfilmentworkerrollen zijn
retired en horen niet in nieuwe configuratie.

Media en Bouwboek zijn request-driven kernpaden. Een geauthenticeerde
media-completion claimt en verwerkt alleen het exacte asset; een proofrequest
claimt en rendert alleen de exacte revisie. Begrensde owner-polling kan die
leased/idempotente verwerking opnieuw activeren. De geïsoleerde workerrollen
blijven dus vereist, maar er zijn geen media-/photobookcronroutes of schedules
en hun capabilities gebruiken geen `CRON_SECRET`.

## Dagelijkse controle

1. Controleer `GET /api/health`: environment, release en capabilities moeten bij
   het bedoelde deploymentdoel horen.
2. Controleer `GET /api/readiness`: HTTP 200, `ready=true`, database `pass` en
   iedere geconfigureerde account/media/payment/photobookworker niet `fail`.
3. Controleer de enige Vercel-cron uit `vercel.json`: account lifecycle om
   02:17 UTC. Alleen `GET /api/internal/cron/account-lifecycle` gebruikt Bearer
   `CRON_SECRET` en verwerkt een count-/tijdbegrensde accountbatch plus een
   begrensde, hervatbare orphan-mediaslice. Bewaar alleen de operationele
   summary; nooit headers, cursors of objectkeys.
4. Controleer retries/dead letters voor export/deletion en de request-driven
   media-/proofverwerking. Kijk naar ouder wordende exacte asset-/revisiejobs en
   mislukte cleanup zonder PII te openen. Een generieke cron is geen
   herstelmechanisme voor deze twee kernflows.
5. Controleer Stripe-webhooks, mislukte/processing/refunded betalingen en
   `manual_review`/`refund_review`. Vertrouw niet op een browserredirect.
6. Controleer `/beheer/bestellingen` op betaalde orders die nog
   `awaiting_review` zijn en volg de handmatige procedure.
7. Controleer open urgente moderatiemeldingen en actieve support-/feedbackintake.
8. Controleer Google, Neon, Vercel/Blob en Stripe status/budgetalerts. Een
   drukkerstatus wordt alleen handmatig en na broncontrole bijgewerkt.
9. Leg datum, environment, release-SHA, tijdvak, aantallen en uitkomst vast;
   nooit rijinhoud of providerpayload.

Voer ad-hoc databaseonderzoek uitsluitend via een tijdelijk, geaudit read-only
operatoraccount uit. Gebruik geen `DATABASE_URL`, worker-URL of migrator voor
dashboardqueries. Rechtstreekse statusupdates zijn verboden; gebruik typed
service/adminacties met versioning en idempotency.

## Alertcatalogus

Onderstaande triggers zijn technische startpunten, geen contractuele SLA.

| Alert | Trigger | Eerste veilige actie |
| --- | --- | --- |
| readiness rood | twee opeenvolgende non-200/`ready=false` | freeze deploys; vergelijk release, env en rolgrenzen |
| accountcron gemist | geen geslaagde account-lifecyclerun binnen twee dagelijkse intervallen | controleer de ene Vercel schedule en het secret; handmatig uitvoeren alleen na scoping/approval |
| account dead letter | één nieuwe export-/deletion-dead letter | stop retentie-/verwijderclaim; inspecteer interne job-ID en checksumgrens |
| media orphan-cleanup retry/dead letter | één veilige cleanupfoutcode of groeiende checkpointachterstand | controleer Blob-status en mediaworkerrol; wijzig cursors/status niet buiten de geaudite operatorprocedure |
| media/proof blijft pending, retry of processing/rendering | ouder dan de begrensde owner-poll/retryperiode | controleer exacte asset-/revisie-ID, lease en veilige foutcode; laat de ownerflow gericht hervatten of escaleer, activeer geen generieke cron |
| private media denial faalt | iedere onverwachte 2xx voor outsider/block | incident; blokkeer release/media en roteer zo nodig credentials |
| Stripe signature/account/env fout | burst of één mismatch op echte eventstroom | checkout fail-closed; controleer endpoint/account, wissel secrets niet blind |
| betaald bedrag/valuta mismatch | iedere mismatch | geen fulfilment; `manual_review`/`refund_review` en paymentaudit |
| betaalde order wacht | paid + `awaiting_review` buiten interne responstijd | page order-admin; maak nooit automatisch een drukkerorder |
| fulfilmentstatus vast | handmatige status zonder onderbouwde voortgang | controleer drukkerbron; update alleen met verwachte versie |
| proof hash/size mismatch | iedere mismatch bij admin-download | niets extern uploaden; `manual_review`, Blob/proofincident |
| urgente melding | één open `urgent` rapport | page moderator/privacy volgens vier-ogenbeleid |
| auth anomalie | login/callback/session errorpiek | controleer Google/config/release; verruim rate limits niet tijdens incident |
| migratiefout | check/apply/verify/replay faalt | geen apppromotie; onderzoek op nieuwe databasebranch en herstel forward |
| unknown 5xx/consolefout | iedere nieuwe reproduceerbare P0/P1 | freeze release; koppel aan regressie en veilig bewijs |

## Herstelgrenzen

- Zet Stripe bij een paymentincident op `CHECKOUT_MODE=off`; dit sluit verkoop
  fail-closed maar is geen commerce-GO.
- Herhaal jobs alleen via hun lease-/idempotencyboundary. Voor media en proofs
  is dat de bestaande owner-geautoriseerde completion/editorflow voor exact het
  asset/de revisie, niet een verwijderde cronroute. Wis geen leasekolommen en pas
  geen statusrij rechtstreeks aan.
- Bij Blobfouten moeten upload checksum/readback of delete-absence eerst bewezen
  zijn voordat de databasefinalisatie doorgaat.
- Bij een onzekere handmatige drukkerorder: plaats nooit een tweede order op
  aanname; controleer de externe referentie in het providerportaal en zet Buildy
  op `manual_review`.
- Een Stripe-refund annuleert geen drukkerorder. Behandel betaling en externe
  productie afzonderlijk, met menselijk besluit.
- Publiceerde migrations worden nooit gewijzigd of down gemigreerd. Herstel
  compatibele appcode en voeg indien nodig een nieuwe forward migration toe.
- Roteer gelekte tokens/keys per provider en onderzoek log/artifactexposure.

## Deploy, rollback en providercheck

Volg [PRODUCTION_RELEASE.md](PRODUCTION_RELEASE.md). Voor een beschermde
Preview/stagingomgeving met secrets veilig geladen:

```sh
bun run setup:providers -- --staging --check
```

Voor Production mag de read-only check pas na formele readinessreview worden
uitgevoerd:

```sh
bun run setup:providers -- --production --check
```

De providercheck verifieert config en optioneel read-only connectiviteit; de
regels met status `manual` blijven menselijke gates. Hij creëert geen Blob,
Stripe-order of drukkerorder.

Rolgrants en migrations zijn afzonderlijke expliciete mutaties via de
migration-ownerverbinding. Rollback is in normale gevallen appcode naar een
schema-compatibele artifact; database restore is een incidentprocedure.

## Bewijs per release

Bewaar alleen environment, SHA, deployment-ID/origin, tijdstip, uitvoerder,
commandonaam, exitstatus, geminimaliseerde tellingen en artifacthashes. Nodig
voor een latere GO zijn onder meer Neon apply/verify/no-op/restore, Google
redirect/callback/session, private Blob upload/read/delete, Stripe testpayment/
webhook/refund, handmatige proefdruk/order/tracking en volledige rolreizen.

Er is in deze snapshot geen nieuwe Preview of productiedeployment bewezen. De
verplichte Browser MCP-runtime was door de huidige Codex-gebruikslimiet
geblokkeerd. Productie blijft **NO-GO** en deze runbookwijziging heeft geen
provider-, database- of productionmutatie uitgevoerd.
