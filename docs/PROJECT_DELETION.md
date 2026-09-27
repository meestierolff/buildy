# Verbouwing verwijderen

Een eigenaar gebruikt `DELETE /api/projects/:projectId` met de actuele versie,
een idempotencykey en exact `VERWIJDER VERBOUWING`. De server bepaalt actor en
project; de database controleert eigenaarschap en optimistic concurrency.

## Directe intrekking

Een geaccepteerd verzoek zet de verbouwing atomair op `deletion_pending` en
`private`. Project-, Bouwmoment-, media-, social- en Bouwboekreads mogen vanaf
dat moment geen inhoud tonen. Dit is directe toegangsintrekking, nog geen
voltooide fysieke verwijdering.

## Historische retentie

Bestellen is uit de app verwijderd. Bestaande retentiecontroles blijven wel
intact voor historische data: een niet aantoonbaar terminale order kan de
verwijdering blokkeren. Omzeil dat conflict niet met een handmatige statusupdate.
Onderzoek uitsluitend de betrokken historische records en noodzakelijke
retentievoorwaarden.

Alleen noodzakelijke historische order-/payment-/auditrelaties en de daarbij
behorende locked revisie/PDF kunnen bewaard blijven. Het beleid bepaalt de
bewaartermijn; dit document introduceert geen universele wettelijke termijn.

## Private Blob-cleanup

De aanvraag bevriest verwijderbare renderjobs en schrijft een deterministisch
manifest. De accountworker claimt een begrensde lease en verwerkt per invocation
maximaal één geïnventariseerd object. Het object moet exact bij de private
Blob-provider/store horen. Na delete controleert de worker afwezigheid; pas dan
wordt het manifestitem verified.

Tijdelijke fouten krijgen begrensde retries; permanente of uitgeputte fouten
worden dead letter/manual review. Databaseredactie begint pas als de vereiste
assets verified zijn. Finalisatie trekt actieve relaties in en verwijdert of
redigeert inhoud, met noodzakelijke tombstones voor auditreferenties.
Historische revoked follow-/accessrecords geven nooit toegang.

De webrol kan alleen de owner-bound aanvraag uitvoeren. De accountworker heeft
execute op zijn lease/verify/retry/finalizefuncties, geen algemene table-DML.
Browserpayload kiest geen finalizer en een operator slaat geen jobstatus over.

Zie [ACCOUNT_LIFECYCLE](ACCOUNT_LIFECYCLE.md) voor de worker en
[STATE](architecture/STATE.md) voor werkelijk bewijs. Rapporteer een geaccepteerde
aanvraag als in behandeling totdat cleanup en finalisatie bevestigd zijn.
