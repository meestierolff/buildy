# Projectdetail-readflow

> **SUPERSEDED.** Bouwmoment bewerken/verwijderen/reorderen is niet meer het
> beschreven verborgen migratiegat. Gebruik de actuele product- en QA-matrix.

`TripDetail` leest projectmetadata en de cursor-gepagineerde timeline uitsluitend via de typed `/api/projects/:projectId`-readmodels. Media wordt alleen met de autoriserende `proxyPath` uit het servercontract weergegeven. Engagement loopt via de centrale reaction- en comment-API's; planning via `FloorplanBoard`.

## Bewust fail-closed migratiegat

Update bewerken, verwijderen en media herschikken zijn op de projectdetailpagina verborgen. De oude implementatie wijzigde database- en storage-objecten rechtstreeks vanuit de browser. Deze acties mogen pas terugkeren nadat er servercontracten zijn die:

- ownership en projecttoegang server-side afdwingen;
- `expectedVersion` en idempotency ondersteunen;
- attachment-unlink, cover-/floorplanreferenties en updatedata atomair wijzigen;
- objectverwijdering pas na een geslaagde databasecommit uitvoeren, bijvoorbeeld met een outbox;
- een veilige retry- en conflictrespons leveren.

Tot die contracten bestaan, is er geen `EditStepDialog`, deleteknop of reorder-control in deze readflow.
