# Operations runbook

Buildy gebruikt gebruikersnaam/wachtwoord, Vercel, Neon PostgreSQL en private
Vercel Blob. De actieve keten staat in [GRAPH](architecture/GRAPH.md), gedrag in
[FLOWS](architecture/FLOWS.md) en deploymentbewijs in [STATE](architecture/STATE.md).
Historische tabellen zijn geen reden om verwijderde runtimes te activeren.

## Rollen en gegevens

| Rol | Operationele toegang |
| --- | --- |
| on-call | veilige Vercel-logs, health/readiness en providerstatus |
| moderator | moderatiequeue en toegestane acties |
| admin | moderatiebeheer en expliciet feedback-/supportdetail |
| technisch operator | tijdelijk, gecontroleerd read-only databaseonderzoek |
| releaseoperator | geautoriseerde deployment en migratorhandelingen |
| privacyverantwoordelijke | impact, retentie en afhandeling van privacyverzoeken |

Gebruik request-ID, interne job-/asset-ID, SHA, tijdvak en aantallen. Plaats geen
wachtwoord, sessiecookie, plaintext feedback, objectkey of private URL in tickets
of logs. Open PII alleen voor de betreffende afhandeling. Zie
[MODERATION_ADMIN_RBAC](MODERATION_ADMIN_RBAC.md) voor rolbeheer.

De actieve database-identiteiten zijn migrator, web, accountworker, mediaworker
en photobookworker. De workerrollen hebben geen algemene table-DML, alleen
execute op eigen begrensde functies. Gebruik runtime- of migratorcredentials niet
voor gewoon ad-hoc onderzoek. Historische rollen/grants blijven bewaard waar
schema en bestaande data dat vereisen.

## Runtime controleren

- `GET /api/health` geeft omgeving, release en capabilities. Vergelijk de SHA met
  het bedoelde deployment; health alleen bewijst geen gebruikersreis.
- `GET /api/readiness` controleert configuratie, database en account-, media- en
  photobookworkers. Een mislukte grens wordt niet opgelost door authenticatie of
  autorisatie uit te schakelen.
- De ene Vercel-cron draait volgens [vercel.json](../vercel.json) om 02:17 UTC:
  `GET /api/internal/cron/account-lifecycle` met Bearer `CRON_SECRET`. Deze
  verwerkt een begrensde accountbatch en hervatbaar orphan-mediaonderhoud.
- Media-completion verwerkt alleen het exacte geautoriseerde asset;
  Bouwboekrequests alleen de exacte revisie. Owner-polling kan geleasede,
  idempotente verwerking hervatten. Deze flows hebben eigen workerrollen en
  Blobconfiguratie, maar geen cron of afhankelijkheid van `CRON_SECRET`.
- Volg oude retries/dead letters en veilige foutcodes voor exports, verwijdering,
  media en PDF's. Controleer urgente moderatie-/supportmeldingen en actuele
  providerstoringen of kostenalerts zonder inhoud naar logs te kopiëren.

| Signaal | Eerste gerichte actie |
| --- | --- |
| readiness faalt | controleer het benoemde configuratie- of databaseonderdeel |
| accountcron ontbreekt/faalt | controleer schedule, autorisatie en veilige batchsummary |
| cleanup dead letter | inspecteer de betrokken job en manifestcontrole |
| asset/PDF blijft verwerken | controleer exact asset/revisie, lease en workerrol |
| ongeautoriseerde read slaagt | beperk de getroffen deliveryflow en behandel als privacyincident |
| PDF-hash/bytes wijken af | blokkeer die download en inspecteer bron/revisie |
| opvallend veel loginfouten | onderzoek rate limiting en sessie/authfoutcodes |

Een begrensde cronuitkomst `partial` is geen bewijs van volledige cleanup. Een
verwijderverzoek dat toegang intrekt is evenmin bewijs van fysieke verwijdering.
Zie [ACCOUNT_LIFECYCLE](ACCOUNT_LIFECYCLE.md) en
[PROJECT_DELETION](PROJECT_DELETION.md).

## Wijzigingen en herstel

Gebruik de huidige [packagecommando's](../package.json) en de bestaande
[rolconfiguratie](../scripts/setup/configure-database-roles.sql). Vercel bouwt de
app met `bun run build`; er is geen CI- of slow-testmatrix als releasevoorwaarde.
Beperk eventuele handmatige verificatie tot het gewijzigde gedrag en noteer
alleen daadwerkelijk waargenomen resultaten.

Een rollback gebruikt een bekend schema-compatibel deployment. Dataherstel is
een afzonderlijke beslissing volgens [BACKUP_AND_RESTORE](BACKUP_AND_RESTORE.md).
Bij een lek of uitval geldt het [INCIDENT_RUNBOOK](INCIDENT_RUNBOOK.md). Bewaar de
bestaande encryptiesleutels; roteer ze niet als ongevraagde bijwerking van een
operationele wijziging.
