# Backup and restore

Herstel beschermt Neon-data, migrationledger, RLS/grants, private Blob-assets,
Vercel-configuratie en de encryptiesleutels waarmee bewaarde PII leesbaar blijft.
Een databaseherstelpunt is geen Blob-backup. De huidige deployment en bekend
herstelbewijs staan in [STATE](architecture/STATE.md).

## Voor een risicovolle wijziging

Leg omgeving, release-SHA, change-ID en migrationledger vast. Gebruik binnen de
geautoriseerde wijziging een herstelpunt of geïsoleerde branch volgens het
beschikbare Neon-plan; noteer alleen provider-ID en UTC-tijd, geen connection
string. Leg vast welke writes tijdens een herstel verloren kunnen gaan en wie
het herstel uitvoert.

Bewaar een geminimaliseerde inventaris van benodigde private assets: interne
asset-ID, purpose, bytes en SHA-256. Provider-URL's, objectkeys en inhoud horen
niet in het wijzigingsverslag. Bewaar Vercel-configuratie, domeininstellingen en
de account-lifecyclecron afzonderlijk en houd secrets in beveiligde opslag.
Historische records en hun retentie blijven onderdeel van het herstel.

Kies hersteltermijnen op basis van het werkelijke plan en een gemeten herstel.
Dit document verzint geen RPO, RTO of wettelijke bewaartermijn.

## Geïsoleerd herstel

1. Herstel naar een nieuwe, geïsoleerde database. Overschrijf geen bestaande
   omgeving om een herstelprocedure uit te proberen.
2. Configureer de bestaande migrator-, web-, account-, media- en
   photobookrollen met de [rolscripts](../scripts/setup/configure-database-roles.sql).
   Houd broncredentials buiten logs en commandoregels.
3. Vergelijk ledger/schema met de bedoelde code. De beschikbare commando's zijn
   `bun run db:migrate:check`, `bun run db:migrate:dry`, `bun run db:migrate` en
   `bun run db:verify`. Pas alleen ontbrekende, bedoelde migrations toe;
   toegepaste migrations blijven onveranderd. Gebruik de
   [rolcontrole](../scripts/setup/verify-database-roles.sql) voor grants.
4. Reconcileer de private objecten met de databaserelaties. Herstel alleen
   toegestane assets naar de bedoelde private store; controleer bytes en SHA-256.
   Een correcte database met ontbrekende Blobbytes is geen volledig herstel.
5. Bevestig voor de getroffen flow dat een eigenaar kan lezen en een niet
   geautoriseerde actor wordt geweigerd. Gebruik eigen synthetische fixtures
   waar mogelijk; publiceer geen herstelde klantinhoud als bewijs.
6. Noteer werkelijk dataverliesvenster, herstelduur en resterende verschillen.
   Ruim tijdelijke toegang en fixtures op volgens het afgesproken beleid.

## Productie herstellen of code terugzetten

Kies bij een incident expliciet tussen een forward fix, code rollback,
point-in-time restore of selectief dataherstel. Beperk betrokken writes en
bewaar de beschadigde toestand voor onderzoek. Een code rollback gebruikt een
bekend deployment dat met het actuele schema werkt; een rollback van code draait
geen toegepaste migration terug.

Controleer na dataherstel ledger/RLS/rollen, encryptieversies en het private
assetmanifest. Bevestig de getroffen account-, toegang- of PDF-flow. Hervat de
account-lifecyclequeue via de bestaande leases. Media en PDF's worden alleen
via hun geautoriseerde request voor het exacte asset of de exacte revisie
hervat; voeg geen cron of generieke claimroute toe.

Trek tijdelijke credentials na gebruik in. Roteer bestaande encryptiesleutels
niet als bijwerking van herstel: bewaarde ciphertext heeft de oorspronkelijke
sleutelversies nodig. Bij een werkelijke credentialblootstelling geldt het
[incidentrunbook](INCIDENT_RUNBOOK.md).

Bewijs bestaat uit herstelpunt-ID, UTC-tijden, tellingen, ledgerresultaat,
checksumuitkomst, toegangscontrole en gemeten verlies/herstelduur. Claim alleen
wat daadwerkelijk is uitgevoerd; neem geen PII, private URL of secret op.
