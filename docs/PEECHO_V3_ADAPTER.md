# Peecho REST API v3-adapter

Status: providerlaag, productie-fulfilmentworker, signed callbackboundary en veilige operatorscripts geïmplementeerd op 4 augustus 2026. Er is bewust geen echte providercall, sandboxorder, betaling of proefdruk uitgevoerd; daarvoor ontbreken bevestigde accountwaarden en expliciete operationele toestemming.

## Contract en bron

De implementatie is gebaseerd op de officiële [Peecho REST API v3-documentatie](https://peechoapiv3.docs.apiary.io/) en het officiële artikel [How to place your first Peecho API order](https://www.peecho.com/blog/how-to-place-your-first-peecho-api-order). De machineleesbare bron is Peecho's [API Blueprint](https://peechoapiv3.docs.apiary.io/api-description-document).

De provider-neutrale interface staat in `server/print/printProvider.ts`; `server/print/peechoV3Provider.ts` vertaalt dat contract naar Peecho v3:

| Adapteroperatie | Peecho v3 | Opmerking |
|---|---|---|
| `getOfferings` | `GET offering/list` | Alleen actieve, accountspecifieke offerings |
| `getProductSpecification` | `GET offering/list` | Exacte offering-ID-lookup; Peecho documenteert geen apart productspecificatie-endpoint |
| `getQuote` | `POST quote` | Prijzen worden naar gehele minor units genormaliseerd |
| `createOrder` | `POST order/` | Creëert een onbetaalde order |
| `payOrder` | `POST order/payment` | Aparte, expliciete submit-naar-productiestap |
| `getOrder` | `GET order/details` | Accepteert zowel de gedocumenteerde `201` als conventionele `200` |
| `verifyCallback` | statuscallback | Verifieert `SHA256(secretKey + order_id)` vóór normalisatie |

Test en live hebben vaste origins. Een environmentvariabele kan de URL dus niet ongemerkt naar een ander host sturen:

- test: `https://test.www.peecho.com/rest/v3/`
- live: `https://www.peecho.com/rest/v3/`

## Configuratie

De scripts lezen uitsluitend:

```dotenv
PEECHO_ENVIRONMENT=test
PEECHO_MERCHANT_API_KEY=...
PEECHO_SECRET_KEY=...
PEECHO_TIMEOUT_MS=10000
```

`PEECHO_ENVIRONMENT` moet expliciet `test` of `live` zijn. De merchant key is vereist voor alle operaties. De secret is alleen vereist voor betaling en callbackverificatie. `PEECHO_TIMEOUT_MS` is optioneel en moet een geheel getal tussen 250 en 60.000 zijn.

Een offering-ID, waaronder de beoogde A4-landscape-hardcover, is accountspecifiek en wordt niet in de adapter verzonnen. Stel die pas in nadat `list-offerings` in de juiste Peecho-environment het product werkelijk teruggeeft.

De productie-fulfilmentworker vereist daarnaast deze server-only waarden:

```dotenv
DATABASE_FULFILMENT_WORKER_URL=postgresql://<dedicated-role>:...@.../buildy
CRON_SECRET=...
R2_ACCOUNT_ID=...
R2_BUCKET_NAME=...
R2_FULFILMENT_WORKER_ACCESS_KEY_ID=...
R2_FULFILMENT_WORKER_SECRET_ACCESS_KEY=...
PII_ENCRYPTION_KEYS=...
PII_ENCRYPTION_CURRENT_VERSION=1
PEECHO_OFFERING_ID_A4_LANDSCAPE=233309
PEECHO_PDF_SIGNED_URL_TTL_SECONDS=604800
```

`PEECHO_PDF_SIGNED_URL_TTL_SECONDS` moet expliciet tussen 300 en 604.800 seconden liggen. Cloudflare [begrenst R2 SigV4-presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) op maximaal zeven dagen; de worker controleert ook `X-Amz-Expires` en de lokale vervaltijd vóór create. De URL wordt niet in PostgreSQL, events of logs opgeslagen.

## Productie-fulfilmentstate machine

`server/fulfilment/worker.ts` gebruikt uitsluitend de functies uit `0016_peecho_fulfilment_worker.sql` via de dedicated fulfilmentrol. Die rol heeft geen tabel-DML.

1. Alleen een order met exact `status=paid`, `payment_status=paid`, een locked proof en overeenkomende private PDF-metadata kan worden geleased.
2. De worker controleert offering, afmetingen, paginabereik, quantity, bucket, objectkey, MIME-type, bestandsgrootte en SHA-256 tegen de immutable checkoutsnapshot.
3. Vlak vóór `createOrder` schrijft de database `peecho_create_started_at`. Een timeout of crash daarna zonder duurzaam Peecho-ID gaat naar `manual_review`; create wordt nooit blind herhaald.
4. Na create wordt `peecho_order_id` direct en immutable opgeslagen. Een verloren databaserespons kan daardoor hervatten met dat bestaande ID, zonder een tweede create.
5. Payment is een aparte stap. Een onzekere paymentuitkomst wordt eerst via `getOrder` gereconcilieerd; alleen een bevestigde `OPEN`/payment-required state mag opnieuw worden betaald.
6. Tijdelijke veilige fouten gebruiken begrensde exponentiële backoff. De achtste claim wordt dead-letter plus `manual_review`.
7. Onbekende, fout-, refund- en cancelstatussen worden nooit als succes behandeld en gaan naar handmatige beoordeling.

De cronroute is `GET /api/internal/cron/peecho-fulfilment` met `Authorization: Bearer $CRON_SECRET`. De signed providercallback is `POST /api/webhooks/peecho`. Peecho's gedocumenteerde digest dekt alleen `secretKey + order_id`, niet de overige callbackvelden. De route behandelt de callback daarom uitsluitend als een gesigneerd weksignaal voor dat order-ID en voert daarna een read-only `GET order/details` uit. Alleen de daaruit gelezen canonieke merchantreference, status en trackingdata worden tegen de lokale immutable provideridentiteit verwerkt; gerapporteerde callbackvelden sturen geen state. De inbox bewaart geen ruwe callback of providerresponse. Callbackreplay is idempotent en oudere statussen kunnen een nieuwere status niet terugdraaien.

## Veilige operatorscripts

Voer scripts uit met Bun. Ze loggen geen credentials, klantadres, e-mailadres, bestands-URL of ruwe providerfout. Fouten bevatten alleen een lokaal fouttype, operatie, veilige retryclassificatie, HTTP-status en eventueel Peecho's korte `custom_code`.

```bash
# Alleen lokale configuratie valideren; geen netwerkcall
bun scripts/peecho/verify-config.ts --offline

# Configuratie plus een read-only offeringcall valideren
bun scripts/peecho/verify-config.ts --require-secret

# Accountofferings tonen
bun scripts/peecho/list-offerings.ts --country NL --currency EUR

# Read-only quote
bun scripts/peecho/quote.ts \
  --offering-id 233309 --pages 24 --quantity 1 --country NL --currency EUR

# Lokale PDF-structuur inspecteren, zonder providercall
bun scripts/peecho/validate-pdf.ts --file ./proof.pdf

# PDF ook tegen de actuele accountoffering controleren
bun scripts/peecho/validate-pdf.ts \
  --file ./proof.pdf --offering-id 233309 --country NL --currency EUR

# Read-only catalogus/spec/quote-smoke-test
bun scripts/peecho/smoke-test.ts \
  --offering-id 233309 --pages 24 --quantity 1 --country NL --currency EUR

# Bestaande order read-only opvragen
bun scripts/peecho/check-order.ts --order-id 1234 --reference '<merchant-reference>'
```

`validate-pdf` weigert onder andere symlinks, versleuteling, actieve of embedded content, paginarotatie, inconsistente MediaBoxes, ongeldige afmetingen en ongeldige pagina-aantallen. De lichte statische inspectie bewijst geen RGB-profiel, embedded fonts of effectieve afbeeldings-DPI; de scriptoutput noemt deze grenzen expliciet. De canonical renderer en een fysieke proefdruk blijven daarvoor leidend.

### Sandboxmutaties

`create-test-order` is standaard een PII-vrije dry-run. Een echte create kan alleen met de test-environment én een afzonderlijke bevestigingsflag:

```bash
bun scripts/peecho/create-test-order.ts --input ./sandbox-order.json
bun scripts/peecho/create-test-order.ts \
  --input ./sandbox-order.json --confirm-sandbox-create
```

Een betaling vereist daarnaast zowel `--pay` als `--confirm-sandbox-pay`:

```bash
bun scripts/peecho/create-test-order.ts \
  --input ./sandbox-order.json \
  --confirm-sandbox-create --pay --confirm-sandbox-pay
```

Alle gevraagde bevestigingen worden vóór de eerste write gecontroleerd. Zodra create slaagt, schrijft het script het Peecho-order-ID uit vóór een eventuele paymentcall. Daarmee kan een onzekere paymentuitkomst via `check-order` worden gereconcilieerd. Bij `PEECHO_ENVIRONMENT=live` zijn create en pay in dit script hard geblokkeerd, ook wanneer alle flags aanwezig zijn. De productieadapter zelf ondersteunt live voor een latere, gecontroleerde fulfilmentworker.

## Idempotentie en retries

Peecho v3 documenteert geen generieke idempotency-header. De adapter gebruikt daarom het unieke `order_reference` als create-idempotencygrens. De caller moet één stabiele sleutel per lokale order gebruiken en de provider-ID direct na een geslaagde create duurzaam opslaan.

Een timeout, netwerkfout, `429`, `5xx` of ongeldige respons tijdens `createOrder` of `payOrder` wordt als `reconcile` geclassificeerd, nooit als blinde retry. Eerst moet `getOrder` met de bekende provider-ID/reference of operationele providercontrole de uitkomst vaststellen. Veilige reads mogen bij tijdelijke fouten worden herhaald. Een onbekende providerstatus wordt `unknown`, niet-terminaal en nooit als succes behandeld.

## Nog open voor launch

- Bevestig test- en live-merchantcredentials en houd ze per environment gescheiden.
- Activeer en verifieer de exacte offering-ID en actuele productspecificatie in beide accounts.
- Bevestig credits of invoicing, bedrijfsgegevens en callback-URL in het Peecho-dashboard.
- Verifieer prijs, verzending, belasting en landendekking met echte read-only quotes.
- Laat Peecho schriftelijk bevestigen wanneer het printbestand daadwerkelijk is gedownload en hoe lang de provider het bestand bewaart. Zeven dagen is uitsluitend de technische R2-grens, geen bewijs dat Peecho binnen die termijn heeft opgehaald.
- Stem verwijdering van betaalde PDF's af op downloadbevestiging, klachten-/herdruktermijn, privacygrondslag en het formeel goedgekeurde retentiebeleid. Verwijder nooit alleen omdat de signed URL is verlopen.
- Voer daarna één gecontroleerde Peecho-testorder uit, bewijs create/persist/pay/callback/replay en statusreconciliatie, en keur een fysieke proefdruk goed voordat live fulfilment wordt aangezet.

De officiële Blueprint bevat enkele inconsistente voorbeelden (onder meer landcodevoorbeelden en contentafmetingen). De adapter volgt de beschrijvende contracten: ISO-2-landcodes, millimeters, exacte JSON-responsschema's en accountspecifieke offeringdata. Een afwijkende echte testrespons moet eerst bewust worden onderzocht; het schema wordt niet permissief gemaakt om een onbekende payload stilzwijgend te accepteren.
