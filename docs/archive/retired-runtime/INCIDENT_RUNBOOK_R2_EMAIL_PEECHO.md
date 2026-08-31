# Incident runbook

> **ARCHIEF — NIET UITVOEREN.** Deze versie bevat R2, e-mailworker en
> geautomatiseerde Peecho-herstelacties. Gebruik het actuele
> [`INCIDENT_RUNBOOK.md`](../../INCIDENT_RUNBOOK.md).

**Status:** procedure gereed; contactpersonen, communicatiesjablonen en formele
meldplichtbesluiten zijn externe launchinputs.

## Classificatie

| Niveau | Voorbeeld | Reactie |
|---|---|---|
| SEV-1 | private media openbaar, actieve credentialexfiltratie, verkeerde ontvanger of dubbele betaalde printorder | Direct containment; incident commander + security/privacy |
| SEV-2 | checkout/fulfilment/auth breed uitgevallen, datacorruptie zonder bewezen lek | Stop betrokken capability; technische en providerescalatie |
| SEV-3 | beperkte jobachterstand, individuele order of niet-kritische UI-fout | Ticket, begrensde workaround, volgen tot bewijs van herstel |

Een classificatie zegt niets over een wettelijke meldplicht. Privacy/security en
de bevoegde eigenaar beoordelen die op werkelijk bewijs en toepasselijke regels.

## Eerste vijftien minuten

1. Open één incidentrecord met UTC-starttijd, omgeving, release en incident-ID.
2. Wijs incident commander, technisch onderzoeker en notulist aan.
3. Beperk de schade: zet alleen de betrokken capability fail-closed uit. Stop
   bijvoorbeeld checkout zonder projectreads of login onnodig uit te zetten.
4. Roteer een vermoedelijk gelekt secret via de provider en Vercel; commit of
   chat het nooit. Trek oude credentials aantoonbaar in.
5. Bewaar immutable provider-/deploy-/auditlogs binnen goedgekeurd beleid.
   Exporteer geen volledige databases of PII voor gemak.
6. Noteer hypotheses als hypothese; bevestig scope met request-ID, interne IDs,
   hashes en tellingen.
7. Communiceer alleen bevestigde impact en een volgend updatemoment.

## Scenario's

### Private media of signed URL zichtbaar

- Zet media grants en zo nodig publieke projectsharing uit.
- Controleer bucket-public-access, CORS, object ACL/policy en grant-TTL.
- Bepaal welke objectkeys en welke tijdspanne geraakt zijn; log geen URLs.
- Revocation betekent: policy corrigeren, bestaande grants laten verlopen of
  providermechanisme intrekken, en anoniem GET/HEAD opnieuw testen.
- Controleer of een eerder publieke OG-afbeelding nog via cache bereikbaar is;
  purge doelgericht en bewijs dat private projecten `noindex` en geen vaste
  signed URL leveren.

### Credential of webhooksecret gelekt

- Disable/rotate bij de bronprovider, daarna Vercel environment secret bijwerken
  en gecontroleerd redeployen.
- Controleer provideraccount, environment en webhookendpoint vóór heractivatie.
- Zoek naar invalid signatures, onbekende event-IDs en accountmismatches; replay
  alleen door de idempotente inboxboundary.

### Stripe/Peecho orderincident

- Zet checkout uit bij prijs-, account- of signaturetwijfel; zet fulfilment uit
  bij Peecho-onzekerheid.
- Vergelijk interne order, Stripe session/payment intent en Peecho order op de
  server-owned reference. Geen PII in het incidentrecord.
- Bij onzekere Peecho-create: eerst canoniek providerrecord ophalen; nooit
  opnieuw creëren voordat afwezigheid is bewezen.
- Volg voor klantafhandeling `ORDER_SUPPORT_RUNBOOK.md`.

### Databasecorruptie of foutieve migration

- Stop writes of betrokken capability en maak de huidige toestand immutable
  beschikbaar voor onderzoek.
- Bewerk een reeds toegepaste migration nooit. Maak een forward fix op een
  aparte branch en test apply/verify/no-op.
- Restore uitsluitend volgens `BACKUP_AND_RESTORE.md` en na expliciet besluit;
  een volledige restore kan geldige nieuwe writes verliezen.

### E-mail naar verkeerde ontvanger

- Pauzeer de e-mailworker en template/capability die het event produceert.
- Gebruik `outbox_event_id`, templatekey en ontvanger-hash om scope te bepalen.
- Controleer lease-bound PII-loader, eventaggregate, AAD en blind-indexcheck.
- Verwijder of wijzig deliverybewijs niet; beperk verdere verspreiding.

### Accountdelete of cleanup gedeeltelijk mislukt

- Laat de accountstatus fail-closed en herstel via de bestaande lease/job.
- Vergelijk deletion manifest met R2 readback; markeer niets voltooid zonder
  aantoonbare afwezigheid.
- Als actieve fysieke orders bestaan, blijft verwijderen geblokkeerd volgens het
  goedgekeurde retentiebeleid.

## Communicatie

Extern bericht bevat alleen: bevestigde dienstimpact, getroffen periode, wat de
gebruiker nu moet doen, wat Buildy doet en het volgende updatemoment. Noem geen
oorzaak, datacategorie, aantallen of hersteltijd als die nog niet bewezen zijn.
Gebruik de nog goed te keuren support-, privacy- of securitycontacten uit
`EXTERNAL_INPUTS_REQUIRED.md`.

## Herstel en afsluiting

Heropen pas wanneer de oorzaak is begrensd, secrets/flags correct staan,
readiness groen is, relevante synthetische smoke tests slagen en queues normaal
inlopen. Sluit pas met tijdlijn, impactbewijs, oorzaak, herstelbewijs, gemiste
detectie, eigenaar en concrete opvolgactie. Verwijder tijdelijke verhoogde
toegang en controleer dat geen gevoelige artifacts zijn achtergebleven.
