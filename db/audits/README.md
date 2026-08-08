# Database-audits

Deze map is bestemd voor read-only, herhaalbare auditqueries en reconciliatierapporten. Audits mogen geen data repareren of verwijderen.

Minimale cutoveraudits:

- row counts per bron- en doeltabel;
- ontbrekende en dubbele legacy-ID mappings;
- orphan foreign keys en ongeldige cross-projectbindings;
- duplicate slugs, idempotency keys en provider-event-ID's;
- project-/update-/mediaownership;
- private-profiel-, projectaccess-, block- en follower-matrices per actorclass;
- `NOT VALID`/ongevalideerde constraints en indexdekking;
- objectcounts, total bytes, missing objects en SHA-256 per storageprefix;
- immutable proof: document-, assetset- en PDF-checksums plus locked orderbinding;
- ordercounts en bedragen per currency/payment/fulfilmentstatus;
- pending/retry/dead-letter outbox-, inbox-, export- en deletionjobs;
- RLS-tests met een gezette en ontbrekende `app.actor_id`;
- controle dat audit-, orderevent- en provider-inboxrecords append-only blijven.

Rapporten gebruiken alleen IDs, counts en hashes. Ze loggen geen e-mailadressen, adressen, captions, comments, object- of signed URLs, authdata, providerpayloads of secrets.
