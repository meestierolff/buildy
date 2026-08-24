# Feedback operations

Status: actieve, privacybewuste productfeedback-intake; handmatige opvolging.

## Actieve gebruikersflow

- Alleen een ingelogde Google OIDC-gebruiker kan via `/feedback` versturen.
- De typed same-origin route is `POST /api/feedback`.
- De enige categorieën zijn:
  - `bug` — **Iets werkt niet**;
  - `usability` — **Iets is onduidelijk**;
  - `idea` — **Ik heb een idee**;
  - `other` — **Andere feedback**.
- Het bericht bevat na trimmen 3–5.000 tekens.
- De client stuurt een veilige route, de actuele privacyverklaringversie, een
  actor-gebonden idempotencykey en een lege honeypot mee.
- De gebruiker bevestigt in de UI dat het bericht geen adres, e-mailadres,
  namen, fotolinks of andere gevoelige informatie bevat.
- Een geslaagde intake toont alleen een `HELP-XXXXXXXX`-ontvangstcode. Er wordt
  geen e-mail, responstijd of uitkomst beloofd.

Er is geen rating, screenshotupload, contactadres of vrije categorie in het
actieve feedbackcontract. Support en privacyverzoeken lopen afzonderlijk via
`/support`; contentmeldingen via `/melden`.

## Server- en datagrens

De server leidt de actor af uit de server-owned sessie en weigert anonieme of
inactieve feedbackactors. Schema-validatie, origin/CSRF, bodylimiet,
idempotencyconflict en rate limiting falen gesloten. Exacte replay van dezelfde
opdracht levert hetzelfde ontvangstbewijs op.

Het bericht wordt contextgebonden versleuteld opgeslagen. De actieve record
bevat daarnaast alleen wat de server voor intake en abusecontrole nodig heeft,
waaronder actor-ID, categorie, veilige route, privacyversie, ontvangstcode,
status, timestamps en gehashte request/sourcekenmerken. Berichttekst, IP,
e-mail, naam, media-URL en andere PII horen nooit in logs, URLs,
idempotencykeys, productevents of vrije auditmetadata.

Historische tabellen/migrations kunnen verwijderde e-mail-outboxvelden of oude
kolommen bevatten. Zij activeren geen e-mailprovider en zijn geen bewijs van
delivery.

## Operatorwerk

1. Wijs vóór de bèta een eigenaar en escalatiepad voor feedback toe.
2. Alleen een server-side geverifieerde `admin` opent
   `/beheer/feedback` of `/beheer/feedback/:submissionId`; een moderatorgrant
   geeft geen toegang tot support-, privacy- of bezwaar-PII.
3. De gepagineerde wachtrij toont alleen ontvangstcode, gecontroleerd type en
   categorie, status/versie, contact-/authenticatiebooleans en timestamps.
   Bericht en contactadres worden pas op de geautoriseerde detailroute met de
   bestaande PII-keyring ontsleuteld.
4. Gebruik de ontvangstcode voor interne correlatie, nooit als
   authenticatiemiddel.
5. Werk `new` eerst bij naar `triaged` (**In behandeling**) en daarna waar
   passend naar `planned`, `resolved` of `closed`. Elke overgang vereist de
   verwachte versie en een actor-gebonden idempotencykey en krijgt een
   append-only, PII-vrij auditrecord.
6. Exporteer uitsluitend de minimale velden die voor triage nodig zijn, gebruik
   alleen synthetische data bij tests en publiceer feedback nooit.
7. Reageer zo nodig handmatig via een expliciet afgesproken supportkanaal. Voeg
   geen Brevo, transactionele mail, callback, worker of cron toe.
8. Volg voor dataverzoeken en verwijdering de account-/privacyrunbooks; wijzig
   geen historische migrations of records ad hoc.

## Releasebewijs

De huidige component/client/server/migrationtests voor feedbackintake en admin-
review zijn groen. De 205-test browsermatrix is alleen geïnventariseerd en niet
uitgevoerd; ook de actuele PostgreSQL-integratie, echte Previewdatabase,
operationele triage en interactieve productieflow zijn niet bewezen. De
verplichte Browser MCP-runtime was door de huidige Codex-gebruikslimiet
geblokkeerd; Preview en productie blijven voor deze flow **BLOCKED/NO-GO** totdat de releasegates uit
[`PRODUCTION_RELEASE.md`](PRODUCTION_RELEASE.md) aantoonbaar groen zijn.
