# Backup and restore

Status: actuele procedure; een echte restore rehearsal en goedgekeurde RPO/RTO
zijn nog launchblokkades.

## Scope

Herstel omvat:

- Neon data, migrationledger, RLS en role grants;
- private Vercel Blob-objecten die door het databaseassetmanifest worden
  gerefereerd;
- Vercel environment-/domainconfiguratie en de ene account-lifecyclecron als
  afzonderlijke inventory;
- server-owned order-, payment-, proof- en fulfilmentledgers;
- reconciliatie met Stripe als bron van provider-events en met het handmatig
  gecontroleerde drukkerrecord.

Een Neonbackup is geen Blobbackup en vervangt geen Stripe- of handmatige
drukkerreconciliatie. De eigenaar moet vóór productie RPO, RTO, Neon-plan/
retentie, Blob-herstelstrategie en wettelijke/contractuele bewaartermijnen
goedkeuren; code verzint die waarden niet.

Er is geen R2-, Brevo- of Peecho-API-backupstap.

## Voor een risicovolle wijziging

1. Leg environment, release-SHA, migrationledgerhashes en change-ID vast.
2. Maak volgens het werkelijke Neon-plan een branch/herstelpunt; noteer alleen
   provider-ID en UTC-tijd, geen connection string.
3. Maak een geminimaliseerde inventory van private Blob-assets: interne asset-ID,
   purpose, gehashte objectkey, bytes en SHA-256. Exporteer geen provider-URL.
4. Leg Stripe order-/paymenttellingen en totalen per valuta/status vast; geen
   customer- of providerpayload.
5. Leg locked proof-/orderaantallen en handmatige fulfilmentstatus/externe
   referentie-aanwezigheid vast, zonder adres/tracking/notes.
6. Bevestig write freeze, rollback/forward-fixkeuze, eigenaar en stopcriteria.

## Niet-productie restore rehearsal

1. Herstel naar een nieuwe, geïsoleerde Neon-branch. Schrijf nooit over
   Production heen.
2. Maak tijdelijke least-privilegerollen voor migrator, web, account, media,
   payment en photobook; gebruik uitsluitend synthetische data/providerconfig.
3. Voer check, plan, apply, role configure/verify, `db/verify`, no-op replay en
   opnieuw `db/verify` uit.
4. Vergelijk ledger, tellingen, constraints, ownership, canonical social,
   projectvisibility, orders/bedragen en auditrelaties met de broninventory.
5. Herstel of kopieer een representatieve, toegestane private Blob-steekproef
   naar een afzonderlijke rehearsalstore/prefix. Verifieer bytes/SHA-256,
   geautoriseerde read en anonieme/blocked denial.
6. Reconcileer Stripe testevents met interne orders en controleer dat geen
   browserredirect betaling bevestigt. Maak geen live payment/refund.
7. Controleer de handmatige orderqueue en exact-PDF-hash; plaats geen externe
   drukkerorder.
8. Start de productiebuild tegen rehearsal en voer health/readiness, Google-
   testidentity, private media, owner/follower/block, proof/orderread en deletion
   smokes uit.
9. Meet werkelijk dataverliesvenster en herstelduur. Claim RPO/RTO alleen met
   timestamps en bewijs.
10. Verwijder tijdelijke branch, store-assets en credentials pas na review en
    volgens het goedgekeurde retentiebeleid.

## Production restore

Een production restore vereist incidentbesluit, write freeze, snapshot van de
beschadigde toestand en expliciete keuze tussen forward repair, point-in-time
restore of selectief herstel. Bepaal vooraf welke geldige writes na het
herstelpunt verloren kunnen gaan.

Na restore:

- roteer tijdelijke credentials;
- verifieer ledger/schema/RLS/rollen en no-op replay;
- reconcileer Stripe-events idempotent vanaf het herstelpunt;
- reconcileer private Blob-assets tegen het databaseassetmanifest;
- reconcileer handmatige drukkerreferenties zonder tweede order te plaatsen;
- test Google sessions, privacy/access, proof/order en cleanup;
- hervat de ene account-lifecyclequeue gecontroleerd; laat media/proofs alleen
  via een owner-geautoriseerde request voor exact het asset/de revisie opnieuw
  verwerken en activeer geen verwijderde cronroute;
- leg werkelijk RPO/RTO en alle restverschillen vast.

## Gatebewijs

Bewaar providerbranch/herstelpunt-ID, UTC-tijden, bron/doeltellingen,
migrationresultaten, checksumsteekproef, privacyprobes, gemeten RPO/RTO,
uitvoerders en opruimbewijs. Geen secret, PII, object-/Checkout-URL of volledige
providerresponse.

Deze rehearsal is voor de huidige release niet bewezen. Production blijft
**NO-GO**; de verplichte Browser MCP-runtime was door de huidige Codex-
gebruikslimiet geblokkeerd.
