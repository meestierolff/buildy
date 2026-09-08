# Stripe Checkout setup

Status: canonieke operatorhandleiding voor Buildy's verplichte betaalpad.

Stripe Checkout is de enige actieve betaling voor het Bouwboek. Preview gebruikt
uitsluitend Stripe test mode. Live verkoop blijft fail-closed totdat iedere gate
in [PRODUCTION_RELEASE.md](PRODUCTION_RELEASE.md) groen en vastgelegd is.

## Modi en omgevingen

| Buildy-omgeving | `CHECKOUT_MODE` | `STRIPE_ENVIRONMENT` | Stripe-key | Toegestaan |
| --- | --- | --- | --- | --- |
| lokaal zonder betaaltest | `off` | leeg | leeg | ja |
| geautomatiseerde tests | `test` | `test` | alleen testfixture of `sk_test_…` | ja |
| Vercel Preview / beschermde staging | `test` | `test` | `sk_test_…` | verplicht vóór releasebewijs |
| veilige statische fallback / incidentmitigatie | `off` | leeg | leeg | geen releaseprofiel of releasebewijs |
| Production | `live` | `live` | `sk_live_…` | uitsluitend na alle gates en expliciete live-GO |

`off`, `test` en `live` zijn alle drie fail-closed:

- `off` publiceert geen checkoutcapability;
- `test` weigert live keys, live events en een live prijsmatrix;
- `live` weigert test keys, test events en een testprijsmatrix;
- ontbrekende of verlopen approvals, ontbrekende workerrollen, een ander
  Stripe-account en ongeldige JSON houden checkout dicht.

De browser bepaalt de modus niet. Hij toont checkout alleen wanneer het
server-owned productprofiel `capabilities.checkout=true` teruggeeft.
Het releaseprofiel blijft in Preview, staging en Production altijd
`PRODUCT_PROFILE=feedback_beta`; `public_demo` of checkout `off` kan geen
releasecheck passeren.

## Vereiste serverconfiguratie

Configureer voor `test` of `live` exact:

```dotenv
CHECKOUT_MODE="test"
STRIPE_ENVIRONMENT="test"
STRIPE_SECRET_KEY="sk_test_…"
STRIPE_WEBHOOK_SECRET="whsec_…"
STRIPE_EXPECTED_ACCOUNT_ID="acct_…"
DATABASE_URL="postgresql://…"
DATABASE_PAYMENT_WORKER_URL="postgresql://…"
PII_ENCRYPTION_KEYS='{"1":"…"}'
PII_ENCRYPTION_CURRENT_VERSION="1"
PII_BLIND_INDEX_KEY="…"
ORDER_PRICE_MATRIX_JSON='…'
ORDER_SELLER_JSON='…'
ORDER_TERMS_VERSION="…"
```

Zet deze waarden per Vercel environment; deel Preview- en Production-secrets
niet. `DATABASE_PAYMENT_WORKER_URL` is een afzonderlijke least-privilege
paymentworkerrol. `DATABASE_MIGRATION_URL` is nooit een runtimefallback.

## Goedgekeurde prijsmatrix

`ORDER_PRICE_MATRIX_JSON` is een strikte, versioned approval-envelope. Het
actieve schema accepteert alleen:

```json
{
  "version": 1,
  "environment": "test",
  "currency": "EUR",
  "approvalStatus": "approved",
  "commercialApprovalId": "TEST-APPROVAL-001",
  "approvedBy": "bevoegde beoordelaar",
  "approvedAt": "2026-08-01T00:00:00.000Z",
  "expiresAt": "2027-08-01T00:00:00.000Z",
  "entries": [
    {
      "sku": "a4-landscape-hardcover-v1",
      "countryCode": "NL",
      "minimumPages": 24,
      "maximumPages": 400,
      "minimumQuantity": 1,
      "maximumQuantity": 5,
      "unitBaseMinor": 1000,
      "unitAdditionalPageMinor": 0,
      "shippingBaseMinor": 0,
      "shippingAdditionalCopyMinor": 0,
      "taxRateBasisPoints": 2100,
      "taxTreatment": "vat_included",
      "deliveryEstimate": "operator-goedgekeurde tekst",
      "productReference": "interne-drukkerreferentie"
    }
  ]
}
```

Vul nooit de voorbeeldbedragen hierboven als echte prijzen in. Bedragen zijn
integers in eurocenten en moeten door een bevoegde operator commercieel,
fiscaal en tegen een actuele handmatige drukkerquote zijn goedgekeurd. Een boek
moet een even paginatal hebben binnen de geconfigureerde grenzen. De combinatie
SKU/land mag maar één keer voorkomen. Het oude veld `offeringId` wordt expliciet
geweigerd: Buildy is niet gekoppeld aan een Peecho-catalogus.

De fiscale betekenis van iedere prijsregel ligt exact vast:

- `vat_exclusive`: de geconfigureerde boek- en verzendbedragen zijn netto.
  Buildy rondt de btw eenmaal af over hun gezamenlijke netto bedrag en telt die
  btw bij het totaal op.
- `vat_included`: de geconfigureerde boek- en verzendbedragen zijn bruto
  consumentenprijzen. Per boekregel wordt het nettobedrag afgerond als
  `bruto × 10000 / (10000 + tarief)`, waarna het netto subtotaal volgt uit
  nettobedrag per boek × aantal. De netto verzending wordt op dezelfde manier
  afgerond. De inbegrepen btw is exact het resterende aantal centen tussen die
  nettoregels en het ongewijzigde bruto totaal. Daardoor wordt btw nooit boven
  op de goedgekeurde prijs gezet en is ook bij afrondingscenten de som van de
  Stripe-regels exact gelijk aan het ordertotaal.
- `vat_exempt`: de geconfigureerde bedragen zijn de eindbedragen,
  `taxRateBasisPoints` moet nul zijn en de btw-component blijft nul.

Een quote leeft maximaal vijftien minuten en nooit voorbij `expiresAt` van de
matrix. Bij een ontbrekende regel of ongeldige approval geeft de API geen prijs.

Checkout vereist twee afzonderlijke, letterlijke bevestigingen uit de browser:
`termsAccepted: true` voor de genoemde `termsVersion` en
`personalisedProductAccepted: true` voor het maatwerkproduct. Ontbreken of
`false` wordt vóór orderreservering geweigerd. Nieuwe orders bewaren beide
bevestigingen in de onveranderlijke checkoutsnapshot; `legal_accepted_at` wordt
server-side op het reserveringstijdstip vastgelegd.

## Goedgekeurde seller-envelope

`ORDER_SELLER_JSON` gebruikt eveneens een strikte approval-envelope:

```json
{
  "version": 1,
  "environment": "test",
  "approvalStatus": "approved",
  "approvalId": "SELLER-APPROVAL-001",
  "approvedBy": "bevoegde beoordelaar",
  "approvedAt": "2026-08-01T00:00:00.000Z",
  "expiresAt": "2027-08-01T00:00:00.000Z",
  "seller": {
    "legalName": "juridisch goedgekeurde naam",
    "tradeName": "Buildy",
    "registrationNumber": "goedgekeurd registratienummer",
    "vatNumber": null,
    "address": "volledig goedgekeurd vestigingsadres",
    "countryCode": "NL",
    "supportEmail": "support@example.test"
  }
}
```

De sellergegevens worden server-side in de order vastgezet. De webclient mag ze
niet vervangen. Het supportadres is onderdeel van deze goedgekeurde snapshot;
er is geen losse `SUPPORT_EMAIL`-runtimevariabele en geen e-mailprovider.

## Stripe-dashboard

1. Gebruik in Preview uitsluitend het aangewezen Stripe test-account.
2. Leg het verwachte account-ID als `STRIPE_EXPECTED_ACCOUNT_ID` vast. De server
   verifieert met de geconfigureerde secret key via Stripe
   `accounts.retrieveCurrent` dat iedere checkout- en webhookflow werkelijk aan
   dit account is gebonden.
3. Maak een endpoint voor `POST /api/webhooks/stripe` op de exacte Preview- of
   Production-origin.
4. Abonneer het endpoint op:
   - `checkout.session.completed`;
   - `checkout.session.async_payment_succeeded`;
   - `checkout.session.async_payment_failed`;
   - `checkout.session.expired`;
   - `charge.refunded`.
5. Plaats het bijbehorende `whsec_…` secret alleen in dezelfde Vercel
   environment.

Een browserredirect naar `/bestellingen/:orderId?checkout=success` is alleen een
terugkeerhint. Alleen een webhook met geldige Stripe-signature, juiste
environment/account-identiteit, Buildy-metadata en exact overeenkomende
orderbedragen en valuta mag betaling bevestigen. Provider-event-ID's en
mutaties zijn idempotent in de database.

### Account- en eventverificatie van webhooks

De webhookbody is ook na een geldige signature niet zelfstandig de canonieke
providerwaarheid. Buildy verwerkt iedere ondersteunde Stripe-webhook in deze
volgorde:

1. verifieer de ruwe body tegen het environment-specifieke `whsec_…` secret;
2. verifieer via `accounts.retrieveCurrent` dat de gebruikte Stripe-secret key
   bij exact `STRIPE_EXPECTED_ACCOUNT_ID` hoort;
3. haal met diezelfde accountgebonden key het event-ID opnieuw canoniek op via
   Stripe `events.retrieve`;
4. eis dat signed en opgehaald event exact overeenkomen op event-ID, type,
   created timestamp, livemode, eventueel account-ID en het ID van het
   onderliggende Stripe-object;
5. valideer environment, `app=buildy` metadata, orderbinding, bedragen en valuta
   en normaliseer uitsluitend de gegevens uit het canoniek opgehaalde event.

Een accountmismatch, ontbrekend canoniek event of verschil tussen body en
opgehaald event faalt gesloten en veroorzaakt geen betaalmutatie. Een tijdelijke
Stripe-netwerkfout bij account- of eventverificatie bevestigt evenmin betaling;
de webhook kan volgens het begrensde retrypad opnieuw worden aangeboden. Deze
controle maakt een geldig gesigneerde maar verkeerd gerouteerde of niet-
canonieke payload nooit tot databasewaarheid.

## Verificatie in Preview

Bewaar per verificatie commit-SHA, deployment-URL, tijdstip en geanonimiseerd
bewijs; leg geen secrets, adresgegevens, e-mailadressen of Checkout-URL's vast.

1. Controleer health/readiness en dat checkout `ready` is.
2. Laat een eigenaar een echte synthetische Bouwboekproof genereren en expliciet
   goedkeuren.
3. Vraag een quote aan voor iedere goedgekeurde land-/paginagrens.
4. Maak Checkout aan en controleer dat uitsluitend
   `https://checkout.stripe.com` wordt geopend en het sessie-ID met `cs_test_`
   begint.
5. Rond één testbetaling af; bewijs dat de geldige webhook de order naar betaald
   brengt en dat een herhaalde webhook geen tweede mutatie veroorzaakt.
6. Test ongeldige signature, verkeerd key-account, een niet canoniek
   terugvindbaar event, afwijkingen tussen signed en opgehaald event, live event,
   verkeerde bedragen, verlopen quote, mislukte/asynchrone betaling, verlopen
   sessie en refund.
7. Controleer dat de paid order in `/beheer/bestellingen` verschijnt en het
   customerportaal de actuele serverstatus toont.
8. Test de volledige rolreis ook interactief via de verplichte Playwright MCP-
   browseraudit.

De laatste stap is nog hard geblokkeerd: de Browser MCP-enumeratie gaf exact
`[]` terug. Er is op deze documentatiesnapshot ook geen echte Stripe Preview-
roundtrip bewezen. Stripe test, Previewrelease en live blijven daarom **NO-GO**.

## Live-promotie

Maak nooit testconfiguratie live door alleen `CHECKOUT_MODE` te wijzigen. Voor
live zijn afzonderlijke live keys, webhook, account-ID, price approval,
sellerapproval, actuele voorwaarden en een volledig bewezen handmatig
fulfilmentproces nodig. Voer daarna opnieuw alle releasegates uit. Een live key
of een bestaande publieke deployment is geen toestemming om geld te innen.
