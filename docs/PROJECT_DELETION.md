# Projectverwijdering

## Gedrag

Een eigenaar vraagt verwijdering aan via `DELETE /api/projects/:projectId` met de actuele projectversie, een client-idempotency-key en de exacte bevestiging `VERWIJDER PROJECT`. De server leidt daarvan een actor- en projectgebonden key af. Een client kan na een onzekere netwerkresponse exact dezelfde aanvraag veilig herhalen.

De databasefunctie `app_request_project_deletion` neemt een advisory transaction lock, controleert ownership en optimistic concurrency en zet het project in één transactie op `deletion_pending` en `private`. Vanaf dat moment geven project-, timeline-, media-, social- en Bouwboek-readmodels geen projectinhoud meer terug.

## Ordergate en archief

`app_account_order_is_active` wordt zowel bij de aanvraag als vlak voor de finale redactie gebruikt. Een checkout, betaling of fysiek order dat nog niet aantoonbaar terminaal is blokkeert fail-closed met HTTP 409. Het project blijft dan actief en kan opnieuw worden aangevraagd nadat support of fulfilment het order terminaal heeft gemaakt.

Bij een afgeleverd of anders veilig terminaal order blijven uitsluitend de bestelde order, orderevents, de exact gebruikte locked proof, de benodigde draftketen en het PDF-object behouden. Dit is een technisch archiefmechanisme; de definitieve juridische bewaartermijn blijft een launchinput en staat niet hardcoded als wettelijke claim in de productcopy.

## Durable cleanup

De aanvraag bevriest lopende niet-bestelde proofjobs en schrijft voor alle verwijderbare R2-objecten een deterministisch manifest naar `deletion_assets`, inclusief objectlocatie en bekende checksum. De account-lifecycleworker:

1. claimt één job met `SKIP LOCKED` en een begrensde lease;
2. verwijdert maximaal één object per invocation;
3. voert een `HEAD`-readback uit en accepteert alleen afwezigheid;
4. markeert het manifestitem pas daarna als `verified`;
5. plant transient storagefalen met begrensde backoff opnieuw;
6. zet permanent of herhaald falen in `dead_letter` voor handmatige beoordeling;
7. start databaseredactie pas als ieder manifestitem `verified` is.

De finalizer verwijdert toegang, followers, budget- en floorplandata, mediakoppelingen, niet-bestelde Bouwboekrevisies en private projectdetails. Updates en reacties worden inhoudelijk geredigeerd; project en media-assets blijven als niet-zichtbare tombstones bestaan zodat audit- en orderreferenties niet worden verbroken. Aanvraag, blokkade en voltooiing krijgen afzonderlijke audit-events.

## Privilegegrens

De webrol kan alleen de owner-bound aanvraagfunctie uitvoeren. De accountworker heeft geen tabel-DML en kan alleen de lease-, verify-, retry- en dispatchfuncties uitvoeren. De dispatcher bepaalt het jobtype vanuit `deletion_jobs`; een client of workerpayload kan niet kiezen welke account- of projectfinalizer wordt aangeroepen.

## Verificatie

- Unit- en HTTP-tests dekken exacte bevestiging, actorbinding, idempotency, versieconflicten en de actieve-orderfout.
- Worker-tests dekken delete/readback, retries, dead-letter en hervatten na een crash.
- Migratietests bewaken locking, manifestvorming, ordered-proof-retentie, redactie en privilegevorm.
- `tests/db/project-deletion.integration.test.ts` draait in CI op een lokale wegwerp-PostgreSQL-database en controleert IDOR, actieve versus afgeleverde orders, een R2-manifestitem en finale tombstones.

Een echte R2-fault-injectionrun op staging en bewijs van de goedgekeurde bewaartermijn blijven externe launchchecks.
