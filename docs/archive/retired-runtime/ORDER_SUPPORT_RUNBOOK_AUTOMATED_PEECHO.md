# Order support runbook

> **ARCHIEF — NIET UITVOEREN.** Deze versie beschrijft een retired automatische
> Peecho-state machine. Gebruik het actuele
> [`ORDER_SUPPORT_RUNBOOK.md`](../../ORDER_SUPPORT_RUNBOOK.md).

**Status:** procesontwerp gereed; definitieve supportcontacten, Peecho-afspraken,
herdrukvoorwaarden en bevoegdheden zijn externe launchgates.

## Veilige identificatie

Laat een ingelogde klant de orderpagina openen. Gebruik intern het Buildy-
ordernummer en de interne order-ID. Vraag nooit om wachtwoord, magic link,
volledig betaalmiddel, webhookpayload, signed PDF-URL of een foto van een
identiteitsbewijs. Deel adres- of trackinggegevens alleen via de authenticated
orderflow.

Een anonieme vraag kan met ontvangstcode worden geregistreerd, maar geeft geen
orderdetails vrij. Verifieer eigendom opnieuw na iedere sessiewissel.

## Status en toegestane actie

| Interne toestand | Betekenis | Supportactie |
|---|---|---|
| `checkout_open` | betaling nog niet bevestigd | Laat klant niet dubbel betalen; controleer Stripe-event |
| `payment_failed` / `expired` | geen geldige succesvolle betaling | Nieuwe checkout alleen via normale productflow |
| `paid` + `unclaimed` | betaling staat vast, productie niet begonnen | Escaleer na operationele drempel; geen handmatige tweede order |
| `claimed` / `peecho_order_created` / `peecho_payment_pending` | worker bezit of bouwt providerorder | Wacht op lease/reconciliatie; providerreference controleren |
| `submitted_to_production` / `in_production` | print is aangeboden/in productie | Wijziging/annulering alleen na expliciete Peecho-bevestiging |
| `shipped` | verzonden | Toon alleen gevalideerde tracking uit canonical providerstatus |
| `delivered` | provider meldt levering | Schade/vermissing als afzonderlijke case behandelen |
| `manual_review` / `failed` | automatische voortgang bewust gestopt | Technisch operator + Peecho; geen directe DB-statuswrite |
| `refunded` | Stripe-refund geregistreerd | Niet aannemen dat print is geannuleerd of terugbetaalbaar bij Peecho |

## Veelvoorkomende cases

### Betaling gelukt, pagina toont dit niet

1. Controleer intern ordernummer en Stripe-eventstatus op dezelfde environment
   en het verwachte account-ID.
2. Laat de idempotente webhookinbox het originele event verwerken of replay via
   de goedgekeurde providerfunctie; muteer de order niet handmatig.
3. Maak geen tweede Checkout Session als het betaalresultaat nog onzeker is.

### Peecho-timeout of onzekere create

1. Pauzeer automatische retry voor deze order indien nodig.
2. Zoek bij Peecho op vaste merchantreference en haal canonical orderdetails op.
3. Bestaat de order, dan persist de bestaande provider-ID via de begrensde
   fulfilmentflow. Bestaat hij aantoonbaar niet, dan mag de idempotente worker
   opnieuw proberen.

### Adreswijziging of annulering

Voor productie: controleer eerst Stripe/Peecho-status en de overeengekomen
wijzigingsmogelijkheid. Na `submitted_to_production` wordt niets beloofd zonder
Peecho-bevestiging. Leg besluit en tijdstip vast zonder het volledige adres in
het ticket te kopiëren.

### Beschadigd, fout of vermist boek

1. Registreer type probleem, ordernummer, leverdatum en alleen noodzakelijke
   bewijsstukken via een afgeschermd kanaal.
2. Controleer print-PDF checksum/revision en canonical Peecho-orderstatus.
3. Vraag Peecho om herdruk/onderzoek volgens de nog contractueel te bevestigen
   procedure. Maak niet zelf een tweede betaalde order.
4. Informeer klant pas over herdruk, refund of termijn nadat provider en
   bevoegde Buildy-eigenaar dit hebben bevestigd.

### Refund of chargeback

Controleer bedrag, valuta, reeds terugbetaald bedrag en productiestatus. Een
Stripe-refund en Peecho-annulering zijn twee afzonderlijke feiten. Bij productie
of een gedeeltelijke refund blijft de order in manual review tot beide kanten
zijn gereconcilieerd. Gebruik geen negatieve of boven-totaal refund.

## Handmatige retry

Alleen een geautoriseerde operator mag via de idempotente fulfilmentboundary een
`manual_review`-order opnieuw laten claimen, nadat provideraccount, bestaande
Peecho-order, PDF-beschikbaarheid en signed-URL-TTL zijn gecontroleerd. Directe
updates aan order-, lease- of provider-ID-kolommen zijn verboden. Als er nog geen
geaudite admincommand beschikbaar is, blijft de case geblokkeerd en is dit een
NO-GO voor live orders.

## Afsluitbewijs

Noteer interne IDs, actor, reden, timestamps, providerreferenties en uitkomst.
Bewaar geen PII of volledige providerpayload. Sluit pas als klantstatus,
paymentledger, fulfilmentstatus, e-mailbewijs en providerstatus onderling
consistent zijn.
