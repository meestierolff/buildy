# Handmatige printfulfilment

Status: canonieke operatorhandleiding. De titel benoemt Peecho omdat een
operator die drukker mogelijk handmatig kiest; Buildy heeft geen Peecho-
integratie.

## Harde runtimegrens

Na een geverifieerde Stripe-betaling verschijnt een order in Buildy's
beheerqueue. Een bevoegde beheerder controleert de exact vastgezette print-PDF
en plaatst de opdracht handmatig in het portaal van de gekozen drukker. Buildy
slaat alleen de handmatig teruggevoerde status, referentie en trackinglink op.

Er is in de actieve MVP:

- geen Peecho-API of SDK;
- geen productcatalogus-, quote- of ordercall naar Peecho;
- geen Peecho-callback of webhook;
- geen Peecho-worker, poller of cronjob;
- geen Peecho-credential of andere Peecho-envvariabele;
- geen automatische retry of automatische drukopdracht.

Historische Peecho-tabellen en append-only migrations mogen blijven, maar zijn
geen actieve runtime-instructie. De retired automatische claimfunctie faalt
expliciet.

## Rollen en routes

Alleen een ingelogde gebruiker met de server-side database-rol `admin` kan deze
flow openen:

- `/beheer/bestellingen` — betaalde/manual-review orderqueue;
- `/beheer/bestellingen/:orderId` — orderdetails, proofdownload en acties;
- `GET /api/admin/orders`;
- `GET /api/admin/orders/:orderId`;
- `GET /api/admin/orders/:orderId/pdf`;
- `POST /api/admin/orders/:orderId/actions`.

De server controleert de rol op iedere request. Een verborgen link of
client-side routeguard is geen autorisatie. Klantmail, verzendadres en interne
notities worden pas na die controle ontsleuteld.

## Voor iedere betaalde order

1. Open de order vanuit `/beheer/bestellingen`; gebruik geen ordergegevens uit
   logs of URL-querystrings.
2. Controleer ordernummer, betaalstatus, bedrag/valuta, SKU, aantal,
   paginatal, bestemming, termsversie en vastgezette seller-/prijsgegevens.
3. Download de proof uitsluitend via de beschermde Buildy-route. De server leest
   het private object en controleert bytegrootte en SHA-256 tegen de locked
   order. Stop bij iedere mismatch.
4. Inspecteer alle pagina's visueel: cover, volgorde, dubbele/lege pagina's,
   crop, resolutie, tekst, bleed/safe area en herkenbare corruptie. Controleer
   ook of documenthash en PDF-hash overeenkomen met de betaalde selectie.
5. Kies `review`. Een afgekeurde of twijfelachtige order gaat naar
   `manual_review` of `refund_review`; bestel hem niet bij een drukker.
6. Log handmatig in op het afzonderlijke drukkerportaal. Upload exact de zojuist
   geverifieerde PDF en voer alleen de noodzakelijke verzendgegevens in.
7. Controleer formaat en product tegen SKU `a4-landscape-hardcover-v1`, aantal,
   paginatal, land, productievoorwaarden en de commercieel goedgekeurde kosten.
   Stop wanneer de drukkerquote afwijkt van de interne approval.
8. Plaats de opdracht pas na een tweede operatorcontrole. Kopieer daarna de
   externe orderreferentie naar Buildy en kies `ordered_manually`.
9. Werk de status bij zodra de drukker die aantoonbaar meldt:
   `mark_in_production`, daarna `mark_shipped`, daarna `mark_completed`.
10. Voeg bij verzending alleen een geldige HTTPS-trackinglink toe. Deel geen
    beheer- of providercredentials met de klant.

De handmatige drukkerorder is een externe mutatie met financiële en
privacygevolgen. Voer hem alleen uit voor een aantoonbaar betaalde order en met
een vooraf goedgekeurd provider-/verwerkersproces. Deze repositorywijziging en
documentatiesnapshot voeren zelf geen drukkerorder uit.

## Statusmachine

Normaal pad:

`awaiting_review → reviewed → ordered_manually → in_production → shipped → completed`

Afwijkingen:

- `manual_review` — menselijke beoordeling nodig; kan daarna opnieuw worden
  gereviewd;
- `refund_review` — betaling/levering vraagt een terugbetalingsbesluit;
- `cancelled` — order gestopt; een completed order kan niet worden geannuleerd.

De beheer-API accepteert alleen deze acties:

- `review`;
- `ordered_manually`;
- `mark_in_production`;
- `mark_shipped`;
- `mark_completed`;
- `manual_review`;
- `cancel`;
- `refund_review`;
- `update_details`.

`ordered_manually` vereist een externe referentie, nieuw ingevoerd of al
aanwezig. `update_details` vereist minimaal één wijziging. Externe referenties
zijn begrensd, trackinglinks moeten HTTPS zijn en interne notities worden
versleuteld opgeslagen.

Iedere mutatie bevat de verwachte recordversie en een idempotencykey. De server
weigert stale versies en een hergebruikte key met andere inhoud. Actor,
request-ID, tijdstip, vorige/nieuwe status en mutatie worden in de databaseaudit
vastgelegd; zet daar geen vrije PII in.

## Incidenten en refunds

- Hash-, omvang- of renderafwijking: niets uploaden; zet op `manual_review` en
  onderzoek de private proofketen.
- Betaling onduidelijk: vertrouw niet op de successredirect; controleer de
  geverifieerde Stripe-eventgeschiedenis en zet zo nodig op `refund_review`.
- Drukkerquote of product wijkt af: niets bestellen; laat prijs/provider opnieuw
  goedkeuren.
- Verkeerde PDF of persoonsgegevens extern gedeeld: stop de opdracht indien
  mogelijk en start het privacy-/incidentproces.
- Productiefout, verloren zending of klacht: leg alleen noodzakelijke details
  vast, beslis menselijk over herdruk/refund en verander de betaalstatus nooit
  op basis van alleen een e-mail of telefoongesprek.
- Refund: voer de betalingsterugbetaling in het juiste Stripe-account uit en
  laat de geverifieerde `charge.refunded` webhook de Buildy-betaalstatus
  synchroniseren; documenteer het operationele besluit zonder kaart- of
  adresgegevens.

Er is geen transactionele e-mailprovider. Status moet daarom begrijpelijk in
Buildy zichtbaar blijven; beloof geen automatische order-, productie- of
verzendmail.

## Bewijs vóór echte verkoop

De operator moet vóór live verkoop vastleggen:

- gekozen drukker, contract/verwerkersrol en privacy-/retentieafspraken;
- actuele productreferentie, printgrenzen, landen, levertijd en handmatige
  kostenquote;
- wie orders mag plaatsen, wie tweede controle doet en wie refunds beslist;
- een veilige provideraccountprocedure met MFA en least privilege;
- een succesvolle Preview testorder van betaling tot completed, inclusief
  refund- en incidentpad;
- mobiele en desktop role-journey-evidence via de verplichte Playwright MCP-
  browseraudit.

De verplichte Browser MCP-runtime was door de huidige Codex-gebruikslimiet
geblokkeerd en provider-/Previewbewijs is nog niet geleverd. Handmatige
fulfilment en live verkoop blijven daarom **NO-GO**.
