# Verbouwing verwijderen

Status: actieve Neon + private Vercel Blob lifecycle.

## Aanvraag

Een eigenaar vraagt verwijdering aan via `DELETE /api/projects/:projectId` met
actuele projectversie, client-idempotencykey en exact `VERWIJDER PROJECT`.
Historische route/databasenaam `project` blijft intern; zichtbare copy gebruikt
Verbouwing.

De server leidt actor/project/key zelf af. De database lockt, controleert owner
en optimistic concurrency en zet de Verbouwing atomair op `deletion_pending` en
`private`. Vanaf dat moment lekken project-, Bouwmoment-, media-, social- en
Bouwboekreadmodels geen inhoud.

## Order- en retentiegate

Een checkout, betaling of fysieke order die niet aantoonbaar terminaal is
blokkeert fail-closed met conflict. De check gebeurt bij aanvraag en vóór finale
redactie. Support/admin moet de echte order eerst veilig afronden; een klant-
of providerbericht volstaat niet.

Voor veilig terminale, bestelde orders blijven alleen de technisch/juridisch
noodzakelijke order/payment/fulfilmentledger, gebruikte locked proofketen en
private PDF behouden volgens het goedgekeurde retentiebeleid. De code claimt
geen universele wettelijke termijn.

## Private Blob-cleanup

De aanvraag bevriest niet-bestelde proofjobs en schrijft een deterministisch
manifest voor verwijderbare private Vercel Blob-objecten. De accountworker:

1. claimt één job met begrensde lease;
2. verwijdert maximaal één geïnventariseerd object per invocation;
3. accepteert alleen de exacte geconfigureerde private Blob provider/store;
4. controleert na delete dat het object afwezig is;
5. markeert het manifestitem pas daarna verified;
6. plant transient fouten begrensd opnieuw en zet uitgeput/permanent falen in
   dead letter/manual review;
7. start databaseredactie pas wanneer alle vereiste assets verified zijn.

Finalisatie trekt actieve visibility/social/mediarelaties in, verwijdert of
redigeert niet-bewaarde inhoud en houdt noodzakelijke interne tombstones zodat
audit/orderreferenties niet breken. Historische project-follow/accessrecords
mogen als revoked historie blijven; zij geven nooit toegang.

## Privilege- en releasegrens

De webrol kan alleen de owner-bound requestfunctie uitvoeren. De accountworker
heeft geen table-DML en alleen execute op lease/verify/retry/finalizefuncties.
Browser- of workerpayload kiest nooit de finalizer.

Vóór productie moeten IDOR, confirmation, idempotency, version conflict,
active-order block, visibilityrevocation, Blob delete-readback, retry/dead-letter
en finale redactie op clean room én Preview worden bewezen. Een echte Preview-
Blob fault/recovery en interactieve journey zijn nog niet bewezen; Browser MCP
was door de huidige Codex-gebruikslimiet geblokkeerd. Production blijft
**NO-GO**.
