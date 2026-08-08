# Backup and restore

**Status:** procedure gereed; er is nog geen echte restore rehearsal op een
niet-productie Neon-branch uitgevoerd. Dit blijft een launchblokkade.

## Scope en beslissingen

Het herstelplan omvat Neon-data, private R2-objecten, Vercelconfiguratie en
providerreferenties. Stripe, Brevo en Peecho blijven bronsystemen voor hun eigen
providerfeiten; een databasebackup vervangt geen providerreconciliatie.

De eigenaar moet vóór productie RPO, RTO, Neon-plan/retentie, R2-versioning of
backupstrategie en wettelijke/contractuele retentie goedkeuren. Deze waarden
worden niet in code verzonnen.

## Voor iedere risicovolle wijziging

1. Registreer environment, release-SHA en migration-ledgerhashes.
2. Maak met Neon een geïsoleerde branch/restorepoint volgens het daadwerkelijk
   geactiveerde plan en noteer het provider-ID zonder connection string.
3. Maak een R2-inventory met objectkeyhash, versie, bytes en SHA-256; exporteer
   geen signed URLs.
4. Leg Stripe/Peecho ordertellingen en totalen per valuta vast, niet de volledige
   klant- of providerpayloads.
5. Verifieer dat rollback eigenaar, window en stopcriterium bekend zijn.

## Niet-productie restore rehearsal

1. Maak een nieuwe geïsoleerde Neon-branch vanaf het gekozen herstelpunt. Herstel
   nooit over productie heen.
2. Maak tijdelijke rehearsalcredentials met dezelfde least-privilegerollen en
   alleen niet-productie-providerconfig.
3. Voer uit:

   ```sh
   DATABASE_MIGRATION_URL='<rehearsal-migration-role-url>' bun run db:migrate
   DATABASE_MIGRATION_URL='<rehearsal-migration-role-url>' bun run db:verify
   DATABASE_MIGRATION_URL='<rehearsal-migration-role-url>' bun run db:migrate
   ```

   De tweede migrate moet nul pending migrations tonen. Gebruik
   `DATABASE_DIRECT_URL` uitsluitend daarna voor de expliciete rolbootstrap,
   restore/import of andere beheerhandeling; de schemarunner leest die variabele
   bewust niet.
4. Vergelijk row counts, foreign keys, unique violations, ownership, sociale
   relaties, orderaantallen/totalen en migration ledger met de broninventory.
5. Gebruik een aparte niet-productie-R2-prefix/bucket. Herstel een representatieve
   steekproef inclusief origineel, displayderivative en print-PDF; verifieer
   bytes/SHA-256 en anonieme ontoegankelijkheid.
6. Start de gebouwde applicatie tegen de rehearsalbranch en voer health,
   readiness, auth, private-media, projectread en orderread-smokes uit. Verstuur
   geen echte mail en maak geen live betaling/printorder.
7. Meet herstelduur en dataverliesvenster. Vergelijk ze met de later goedgekeurde
   RTO/RPO; claim geen resultaat zonder timestamps en exitstatus.
8. Verwijder tijdelijke branch, bucketprefix en credentials pas na vastgelegd
   bewijs en conform het goedgekeurde retentiebeleid.

## Productieherstel

Een productieherstel vereist een SEV-1/SEV-2-besluit, write freeze en expliciete
keuze tussen forward repair, point-in-time restore of selectief herstel. Bepaal
eerst welke geldige writes na het herstelpunt verloren zouden gaan. Maak vóór
restore een snapshot van de beschadigde toestand voor onderzoek. Na restore:

- roteer tijdelijke credentials;
- draai migration verify/no-op;
- reconcileer Stripe- en Peecho-events vanaf het herstelpunt;
- reconcileer R2-objecten met het databaseassetmanifest;
- test private access en betrokken kernflows;
- laat queues gecontroleerd inlopen;
- documenteer werkelijk RPO/RTO en resterende verschillen.

## Vereist bewijs

`docs/LAUNCH_READINESS.md` mag de restoregate pas groen maken met providerbranch-
of backup-ID, UTC-tijden, bron- en doeltellingen, migrationresultaat, R2-
checksumsteekproef, privacyprobes, gemeten RPO/RTO, uitvoerders en opruimbewijs.
Op 4 augustus 2026 is dit bewijs niet aanwezig.
