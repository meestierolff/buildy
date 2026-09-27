# Incident runbook

Gebruik de [architectuur](architecture/GRAPH.md) voor de grenzen en
[STATE](architecture/STATE.md) voor de actuele deployment. Dit document beschrijft
handelingen bij een incident en voegt geen releasevoorwaarden toe.

| Niveau | Voorbeeld | Reactie |
| --- | --- | --- |
| SEV-1 | private media/PDF openbaar, credentiallek, ongeautoriseerde toegang | directe beperking van het lek; verantwoordelijke voor techniek en privacy inschakelen |
| SEV-2 | login, database of kernflow breed uit; datacorruptie | betrokken writes/flow begrenzen en oorzaak herstellen |
| SEV-3 | individuele jobachterstand of beperkte UI-fout | ticket, gerichte oplossing en uitkomst volgen |

De bevoegde eigenaar beoordeelt privacy-impact en eventuele meldplicht op basis
van het werkelijke incident.

## Eerste acties

Leg UTC-start, omgeving, release-SHA, request-ID en incident-ID vast. Wijs een
verantwoordelijke aan en beperk alleen de getroffen toegang of verwerking.
Bewaar relevante logs en auditmetadata zonder inhoud, persoonsgegevens,
cookies, objectkeys of private URL's. Scheid vermoedens van vastgestelde impact.
Roteer en trek daadwerkelijk verdachte credentials in via de bronprovider en
de betreffende omgeving; maak geen algemene keyrotatie van een gewone storing.

## Gerichte scenario's

### Private media of PDF zichtbaar

Beperk de getroffen delivery/uploadflow en houd de Blob-store private.
Controleer autorisatie, exact objecthost/path, cacheheaders, bytes/SHA-256 en
actuele visibility/blockstatus. Bepaal betrokken interne asset-ID's en tijdvak
zonder URL's te loggen. Controleer na herstel de betrokken eigenaar en een actor
zonder toegang. Al gedownloade bytes kunnen niet worden teruggeroepen.

### Wachtwoord of sessie

Controleer origin/CSRF, cookiebeleid, rate limiting en de server-owned
identiteitskoppeling. Trek verdachte sessies in; alleen tokenhashes horen in de
database. Controleer de scrypt-verificatie bij een loginprobleem. Schakel geen
authenticatie uit en maak geen gedeeld account als workaround. Er is geen
wachtwoordherstel om een gebruiker naar te verwijzen.

### Database of migration

Beperk betrokken writes en bewaar de toestand. Wijzig een toegepaste migration
nooit; herstel schema met een append-only wijziging. Gebruik voor rollback of
restore [BACKUP_AND_RESTORE](BACKUP_AND_RESTORE.md) en bepaal vooraf welke geldige
writes een herstelpunt zou verliezen.

### Account/projectverwijdering

Laat de target onzichtbaar en herstel via de bestaande job/lease. Vergelijk het
manifest met Blob delete-readback. Markeer niets voltooid zonder bevestigde
afwezigheid. Historische retentievoorwaarden blijven gelden; activeer geen
verwijderde bestelruntime om een blokkade te omzeilen.

### Request-driven media of Bouwboek

Er is geen media- of photobookcron om te pauzeren. Controleer eigenaar, exact
asset-/revisie-ID, lease, beperkte workerrol, Blobbytes/checksum en veilige
foutcode. Hervat via dezelfde geautoriseerde completion/editorpoll; wijzig geen
jobstatus of lease handmatig en start geen algemene queueclaim.

### Delen, volgen of blokkeren

Controleer de exacte zichtbaarheid, deellink en blockstatus in API en database.
Een project volgen verleent geen leesrecht. Intrekken van deellinks, verwijderen
van profielconnecties en blokkeren moeten bij de volgende read doorwerken naar
project, Bouwmoment, reacties en private media. Deblokkeren herstelt geen
verwijderde relatie. Zie [SOCIAL_STATE_MACHINE](SOCIAL_STATE_MACHINE.md).

## Herstel vastleggen

Bevestig de getroffen flow en de relevante toegang na herstel. Noteer oorzaak,
impact, tijdlijn, uitvoerder en resterende actie; een groene healthresponse alleen
bewijst geen herstelde gegevens of private toegang. Verwijder tijdelijke toegang
en gevoelige artifacts. Werk [STATE](architecture/STATE.md) bij als deployment of
bekend runtimebewijs verandert.
