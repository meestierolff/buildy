# Incident runbook

Status: actuele procedure; namen, contactkanalen en formele meldplichtbesluiten
zijn nog externe launchinputs.

## Classificatie

| Niveau | Voorbeeld | Reactie |
| --- | --- | --- |
| SEV-1 | private media/proof openbaar, credentialexfiltratie, verkeerde ontvanger/drukorder, dubbele betaling | directe containment; commander + security/privacy |
| SEV-2 | Google auth, database, Stripe of kernflow breed uit; datacorruptie zonder bewezen lek | betrokken capability fail-closed; technische/providerescalatie |
| SEV-3 | individuele order, begrensde jobachterstand of niet-kritieke UI-fout | ticket, veilige workaround, volgen tot herstelbewijs |

Severity bepaalt geen wettelijke meldplicht. Privacy/security en bevoegde
eigenaar beslissen op basis van werkelijke impact en toepasselijke regels.

## Eerste vijftien minuten

1. Open één incidentrecord met UTC-start, environment, release-SHA, request-ID en
   intern incident-ID.
2. Wijs commander, onderzoeker en notulist aan.
3. Stop alleen de getroffen capability fail-closed. Bij paymenttwijfel:
   `CHECKOUT_MODE=off`; maak geen nieuwe Checkout of drukkerorder.
4. Roteer vermoedelijk gelekte secrets bij bronprovider en Vercel; commit of
   deel ze nooit. Trek oude credentials aantoonbaar in.
5. Bewaar begrensde immutable provider/deploy/auditlogs conform retentie. Geen
   volledige database, PII, object-URL of providerpayload in tickets.
6. Scheid hypothese van bewijs; scope met interne IDs, hashes en tellingen.
7. Communiceer alleen bevestigde impact en het volgende updatemoment.

## Scenario's

### Private Blob-media of proof zichtbaar

- Stop de betrokken delivery/upload/proofflow; Blob-store blijft private.
- Controleer serverautorisatie, objecthost/path, cacheheaders, checksum en
  visibility/blockstatus; er hoort geen permanente signed URL te bestaan.
- Bepaal betrokken interne asset-ID's/tijdspanne zonder URLs te loggen.
- Roteer Blob-token bij credentialtwijfel en test anonymous, outsider, follower,
  blocked en owner opnieuw.

### Google/sessionincident

- Controleer exacte origin/callback, Google issuer/client en releaseconfig.
- Trek verdachte server-owned sessies in; alleen hashes staan in Neon.
- Bewijs PKCE/state/nonce, veilige `next` en identity mapping vóór heropenen.
- Schakel geen wachtwoord/e-mailfallback in; die bestaat niet.

### Stripe paymentincident

- Zet checkout `off` bij key/account/environment/signature/prijs/bedragtwijfel.
- Vergelijk interne order, environment/account, Checkout Session/Payment Intent,
  event-ID, metadata, bedrag en valuta. Geen PII in incidentrecord.
- Replay uitsluitend via de idempotente webhook/databaseboundary.
- Een successredirect is geen betaalbewijs; maak geen tweede session zolang de
  eerste status onzeker is.

### Handmatige drukkerorder

- Zet order `manual_review`/`refund_review`; plaats geen tweede externe order.
- Controleer exact-PDF SHA/bytes, interne order en externe referentie handmatig.
- Een Stripe-refund annuleert geen drukkerorder en drukkerstatus wijzigt geen
  paymentledger. Beslis/reconcileer beide kanten afzonderlijk.

### Database/migration

- Freeze betrokken writes en maak de toestand beschikbaar voor onderzoek.
- Wijzig een toegepaste migration nooit; maak een forward fix op een aparte
  branch en test apply/verify/replay.
- Restore alleen volgens [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md) na
  expliciet besluit.

### Account/projectdelete of cleanup

- Laat target fail-closed onzichtbaar en herstel via bestaande lease/job.
- Vergelijk deletion manifest met private Blob delete-readback.
- Markeer niets voltooid zonder aantoonbare afwezigheid; actieve orders blijven
  een blokkade volgens het goedgekeurde retentiebeleid.

### Request-driven media of Bouwboekproof

- Stop alleen de getroffen completion-/proofflow; er is geen media- of
  photobookcron om te pauzeren.
- Controleer actor/owner, exact asset-/revisie-ID, lease, workerrol, Blobbytes/
  checksum en veilige failurecode zonder objectkey of PII te loggen.
- Hervat alleen via dezelfde owner-geautoriseerde completion/editorpoll. Start
  geen generieke queueclaim en wijzig geen jobstatus of lease handmatig.

### Social/privacylek

- Blokkeer affected reads en bewijs profiel-follow, vier visibilities, moderation
  overrides en block-revocation in database én API.
- Unblock of visibilityreset herstelt geen eerder ingetrokken relatie op aanname.

Er is geen e-mailworker of Peecho API om te pauzeren/replayen.

## Heropenen en afsluiten

Heropen pas wanneer oorzaak begrensd, secrets/config correct, readiness groen,
relevante regressies plus synthetische provider/rolsmokes geslaagd en queues
normaal zijn. Sluit met tijdlijn, impact, oorzaak, containment/herstelbewijs,
detectiegat, eigenaar en concrete opvolging. Verwijder tijdelijke toegang en
gevoelige artifacts.

Een production smoke of mutatie vereist aparte release-authorisatie. Gebruik de
status/contacts uit [OPERATOR_ACTIONS_REQUIRED.md](OPERATOR_ACTIONS_REQUIRED.md);
dit runbook claimt niet dat ze al zijn ingericht.
