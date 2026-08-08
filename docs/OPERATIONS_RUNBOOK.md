# Operations runbook

**Status:** uitvoerbaar ontwerp; provideralerts, productierollen en restorebewijs
moeten per omgeving nog extern worden geactiveerd en vastgelegd.

## Doel en grenzen

Dit runbook is voor de Vercel/Neon/R2/Brevo/Stripe/Peecho-runtime. Een groene
build is geen bewijs dat een provider werkt. Operators gebruiken nooit de web-
of workercredentials voor ad-hoc SQL en kopiëren geen persoonsgegevens, signed
URLs, providerpayloads of secrets naar tickets of logs.

De vaste correlatiesleutels zijn `x-request-id`, het interne ordernummer en de
interne job- of event-ID. Zoek niet op e-mailadres of adres. JSON-logs uit
`server/observability/logger.ts` laten alleen toegestane scalarvelden door en
weigeren gevoelige veldnamen.

## Operationele rollen

| Rol | Toegang | Niet toegestaan |
|---|---|---|
| On-call | Vercel logs/alerts, read-only dashboard, runbooks | Databasewrites en secrets tonen |
| Support | Authenticated orderreadmodel en ontvangstcodes | Providerpayloads, PII-export of status muteren |
| Technisch operator | Tijdelijke, geaudite read-only Neon-rol; providerdashboards | Runtime-/workerrol hergebruiken voor SQL |
| Incident commander | Coördinatie en vrijgave van herstelstappen | Alleen beslissen over juridische meldplicht |
| Privacy/security | Impact- en meldplichtbeoordeling | Operationele status zonder technisch bewijs sluiten |

Productierollen worden met `scripts/setup/configure-database-roles.sql`
ingericht en met `scripts/setup/verify-database-roles.sql` gecontroleerd. De
webrol heeft alleen ordinary DML onder verplichte RLS en een expliciete
functieallowlist. Workerrollen hebben geen tabel-DML en uitsluitend `EXECUTE`
op hun eigen begrensde functies. `/api/readiness` controleert de afzonderlijke
workergrenzen bij runtime-start.

## Dagelijkse controle

1. Controleer `GET /api/health`; omgeving en release moeten de beoogde deploy
   tonen. De endpoint bevat geen secrets.
2. Controleer `GET /api/readiness`; HTTP 200, `data.ready=true` en alle voor de
   omgeving geconfigureerde workerchecks moeten `pass` zijn.
3. Controleer dat elke cron in de laatste twee verwachte intervallen is
   aangeroepen. Een Vercel-plan dat de minutenplanning niet ondersteunt is een
   launchblokkade; gebruik dan een afzonderlijke geauthenticeerde scheduler.
4. Controleer dead letters, verlopen leases, achterlopende queues, betaalde
   maar ongeclaimde orders en `manual_review`.
5. Controleer providerstatuspagina's en saldo/credits zonder gevoelige waarden
   in het operationele verslag te plakken.
6. Leg release, tijdvak, aantallen en resultaat vast. Leg geen rijinhoud vast.

Gebruik de volgende queries uitsluitend via een afzonderlijke read-only
operatorverbinding. Ze geven alleen tellingen en interne IDs terug:

```sql
-- Achterlopende of doodgelopen outboxevents.
SELECT status, event_type, count(*)
FROM outbox_events
WHERE status IN ('pending', 'retry', 'claimed', 'dead_letter')
GROUP BY status, event_type
ORDER BY status, event_type;

-- Betaald maar niet tijdig door fulfilment opgepakt.
SELECT id, order_number, fulfilment_status, paid_at
FROM photobook_orders
WHERE payment_status IN ('paid', 'partially_refunded', 'refunded')
  AND paid_at < now() - interval '10 minutes'
  AND fulfilment_status = 'unclaimed';

-- Verlopen fulfilmentleases en handmatige beoordeling.
SELECT id, order_number, fulfilment_status, last_error_code
FROM photobook_orders
WHERE (fulfilment_lease_expires_at < now()
       AND fulfilment_status NOT IN ('delivered', 'cancelled'))
   OR fulfilment_status = 'manual_review';

-- E-mailfouten zonder ontvanger of metadata te tonen.
SELECT status, template_key, failure_code, count(*)
FROM email_deliveries
WHERE status IN ('deferred', 'failed')
GROUP BY status, template_key, failure_code
ORDER BY status, template_key;

-- Account-exportjobs die aandacht nodig hebben.
SELECT status, failure_code, count(*)
FROM export_jobs
WHERE status IN ('retry_scheduled', 'dead_letter')
GROUP BY status, failure_code;

-- Project- en accountverwijdering zonder asset- of gebruikersdetails.
SELECT kind, status, count(*)
FROM deletion_jobs
WHERE status NOT IN ('completed')
GROUP BY kind, status
ORDER BY kind, status;

-- Moderatiewachtrij: uitsluitend urgentie/status, nooit meldingstekst.
SELECT urgency, status, count(*)
FROM moderation_reports
WHERE status IN ('open', 'triaged', 'investigating')
GROUP BY urgency, status
ORDER BY urgency DESC, status;

-- Bèta-capaciteit en verlopen reserveringen zonder code/e-mailhash te tonen.
SELECT status, count(*), sum(max_uses - use_count) AS remaining_uses
FROM beta_invites
GROUP BY status;

SELECT status, count(*)
FROM beta_invite_redemptions
WHERE status = 'reserved' AND reservation_expires_at < now()
GROUP BY status;

-- Productevents: alleen toegestane eventnamen en tellingen, geen properties.
SELECT event_name, count(*)
FROM product_events
WHERE occurred_at >= now() - interval '24 hours'
GROUP BY event_name
ORDER BY event_name;

-- Auth/rate-limit-anomalie: alleen tellingen; key_hash nooit exporteren.
SELECT count(*) AS saturated_windows
FROM auth_rate_limits
WHERE expires_at > now() AND count >= 10;
```

## Alertcatalogus

De onderstaande waarden zijn technische startwaarden, geen contractuele SLA.
Wijzigingen worden gereviewd en in het launchrapport vastgelegd.

| Alert | Trigger | Eerste actie |
|---|---|---|
| Runtime niet gereed | `/api/readiness` tweemaal achtereen niet 200 | Freeze deploys; vergelijk release/config en DB-rollen |
| Cron gemist | geen geslaagde run binnen twee intervallen | Controleer scheduler/secret; voer eenmaal veilig handmatig uit |
| Betaald, niet geclaimd | `paid_at` ouder dan 10 min en `unclaimed` | Controleer fulfilmentcron en providerconfig; geen tweede order maken |
| Fulfilment vast | niet-terminale status zonder voortgang >30 min | Inspecteer lease/eventledger; volg orderrunbook |
| Mogelijk dubbel providerorder | één merchantreference met conflicterend provider-ID | Stop fulfilment; Peecho bevestiging; manual review |
| Ongeldige webhookburst | 10+ invalid-signature events in 5 min per provider | Rate limit/edgefilter; controleer endpointsecret en bron |
| E-mailproviderfout | 5+ deferred/failed in 10 min of authmail >5 min | Brevo status/config; worker niet blind versnellen |
| Cleanup vast | account/PDF/media-cleanup na maximale retries | Blokkeer betrokken delete/retentieclaim; onderzoek manifest |
| Storage-orphangroei | reconciliatieverschil groeit tussen twee runs | Stop destructieve cleanup; inventory en checksums vergelijken |
| Upload-/decodefouten | 5+ mediajobs met retry/dead-letter in 10 min | Stop bulkuploads; controleer MIME/decode/limieten en R2-status |
| Auth-/rate-limitpiek | baseline-afwijking of herhaalde verzadigde vensters | Controleer oorsprong en release; verruim limieten niet tijdens het incident |
| Projectdelete vast | niet-terminale projectjob zonder voortgang >30 min | Houd project onzichtbaar; controleer ordergate, manifest en storage-readback |
| Urgente moderatie | één `urgent` open rapport of restrictieconflict | Pagineer moderator/privacy; volg vier-ogenbeleid en immutable audit |
| Bèta-uitputting/replay | geen geldige invitecapaciteit of reservationcollisions | Pauzeer nieuwe invites; controleer policy/ledger, maak codes niet openbaar |
| Producteventafwijking | onbekende eventnaam/property of append-onlyfout | Stop analyticsconsumptie; privacyreview en schema-allowlist controleren |
| Migratiefout | apply/verify/no-op-cyclus faalt | Geen appdeploy; herstel forward op nieuwe branch |
| Provideraccount mismatch | Stripe/Peecho environment/account wijkt af | Checkout/fulfilment uit; secrets niet ter plekke omwisselen |

## Veilige herstelacties

- Een job wordt alleen via zijn idempotente workerboundary opnieuw aangeboden.
  Pas geen statusrij rechtstreeks aan.
- Een verlopen lease mag door dezelfde claimfunctie worden overgenomen. Wis
  leasekolommen niet handmatig.
- Na een onzekere Peecho-create wordt eerst de providerorder op de vaste
  merchantreference opgezocht. Maak nooit preventief een tweede printorder.
- Een Stripe-refund bewijst niet dat Peecho heeft geannuleerd. Zet de order zo
  nodig op `manual_review` en volg `ORDER_SUPPORT_RUNBOOK.md`.
- Bij een storagefout wordt eerst read-after-write/checksum of delete-readback
  bewezen voordat een databasejob wordt afgerond.
- Een mislukte database-migration wordt op een nieuwe stagingbranch onderzocht.
  Reeds gepubliceerde migrations worden niet gewijzigd.

## Deploy en rollback

1. CI moet typecheck, lint, unit/integratie, build, migratie-apply/verify/no-op en
   publieke browserchecks groen tonen.
2. Maak vóór schema- of cutoverwijzigingen een providerbewijs en Neon
   restorepoint/branch volgens `BACKUP_AND_RESTORE.md`.
3. Pas schemawijzigingen eerst toe met de dedicated
   `DATABASE_MIGRATION_URL`; deploy daarna de app met alleen de pooled runtime-
   en afzonderlijke worker-URLs. `DATABASE_DIRECT_URL` is gereserveerd voor
   gecontroleerde setup/admin- en legacy-importtaken.
4. Controleer health/readiness, anonieme privacyprobes, één synthetische ownerflow
   en queueachterstand.
5. Roll back alleen applicatiecode wanneer het schema backward-compatible is.
   Databaseherstel is een incidentprocedure, geen gewone deploystap.

## Bewijs per dienst

Bewaar datum/tijd, omgeving, release-SHA, uitvoerder, commandonaam, exitstatus en
geminimaliseerde tellingen. Vereist voor launch: Neon apply/verify/no-op, R2
private access/readback/delete, Better Auth cookie/OAuth, Brevo testmail en
deliverycallback, Stripe sandboxbetaling/webhook, Peecho testorder/callback en
een ontvangen fysieke proefdruk. Geheimen en volledige providerresponses horen
niet in artifacts.
