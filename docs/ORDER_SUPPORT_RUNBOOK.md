# Order support runbook

Status: actieve Stripe + handmatige fulfilmentprocedure; externe support-,
drukker- en refundafspraken zijn nog launchgates.

## Veilige identificatie

Laat een ingelogde klant `/bestellingen/:orderId` openen. Gebruik intern het
Buildy-ordernummer en de interne order-ID. Vraag nooit om loginsecret, volledig
betaalmiddel, webhookpayload, Blob/Checkout-URL, identiteitsbewijs of een kopie
van het volledige adres in chat/ticket. Een `HELP-…`-ontvangstcode geeft geen
orderdetails vrij.

## Statusbronnen

- order: `draft`, `awaiting_payment`, `checkout_open`, `paid`,
  `payment_failed`, `expired`, `cancelled`, `manual_review`;
- payment: `unpaid`, `processing`, `paid`, `partially_refunded`, `refunded`,
  `failed`;
- fulfilment: `awaiting_review`, `reviewed`, `ordered_manually`,
  `in_production`, `shipped`, `completed`, `manual_review`, `cancelled`,
  `refund_review`.

Stripe signature/account/environment/event plus de interne ledger bepalen
payment. De Buildy-adminaudit plus handmatig gecontroleerde externe referentie
bepalen fulfilment. Een browserredirect, klantbericht of drukker-e-mail is geen
statuswaarheid.

## Veelvoorkomende cases

### Betaling lijkt gelukt, Buildy toont dit niet

1. Controleer intern ordernummer, juiste Stripe environment/account,
   Checkout/Payment Intent en geverifieerd event.
2. Controleer metadata, bedrag en valuta tegen de locked order.
3. Laat het originele event idempotent verwerken/replayen via de goedgekeurde
   webhookboundary. Geen directe DB-update.
4. Maak geen tweede Checkout zolang de eerste status onzeker is.

### Checkout mislukt of verloopt

Controleer eerst dat geen late async payment/webhook bestaat. Alleen de normale
productflow mag daarna met een actuele proof/quote/terms een nieuwe checkout
maken. Support maakt geen URL of prijs handmatig.

### Adres, aantal of annulering

Vóór externe bestelling: zet zo nodig `manual_review`, controleer payment en
approved quote/terms, en gebruik alleen de typed beheeractie. Na
`ordered_manually` wordt wijziging/annulering pas beloofd wanneer de drukker dit
handmatig bevestigt. Kopieer geen adres naar tickets.

### Beschadigd, fout of vermist boek

1. Registreer ordernummer, probleemtype, leverdatum en minimaal noodzakelijk
   bewijs via het goedgekeurde afgeschermde kanaal.
2. Controleer locked document-/PDF-hash, quantity, externe referentie en
   trackingstatus.
3. Vraag de drukker handmatig om onderzoek/herdruk volgens contract; plaats geen
   tweede betaalde order op aanname.
4. Beloof herdruk/refund/tijd pas na bevoegd intern en providerbesluit.

### Refund of chargeback

Controleer totaal, currency, eerder refunded bedrag en externe productiestatus.
Zet `refund_review`; voer een refund uitsluitend in het juiste Stripe-account
uit en laat `charge.refunded` de Buildy-paymentstatus synchroniseren. Een refund
annuleert geen drukkerorder. Een drukkercredit is geen Stripe-refund.

## Handmatige fulfilmentacties

Alleen server-side admin kan de queue/detail/PDF/routes gebruiken. Normaal pad:

`awaiting_review → reviewed → ordered_manually → in_production → shipped → completed`

Acties vereisen verwachte versie, idempotencykey en audit. Externe referentie is
verplicht bij `ordered_manually`; tracking moet HTTPS; notes zijn versleuteld.
Directe updates aan order-, payment-, fulfilment-, lease- of providerkolommen
zijn verboden.

Volg voor elke order [MANUAL_PEECHO_FULFILMENT.md](MANUAL_PEECHO_FULFILMENT.md).
De naam Peecho geeft alleen een mogelijke handmatig gekozen drukker aan; er is
geen API/worker/callback/env.

## Afsluitbewijs

Leg interne IDs, actor, begrensde reasoncode, timestamps, externe referentie en
uitkomst vast. Geen PII/providerpayload. Sluit pas wanneer customerreadmodel,
paymentledger, fulfilmentaudit en handmatig gecontroleerde providerstatus
consistent zijn. Er wordt geen automatische e-mailbevestiging beloofd.
