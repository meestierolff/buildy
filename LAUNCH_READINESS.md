# Buildy launch-readiness — consumenten, privacy en operatie

Status op 15 juli 2026: **NO-GO voor publieke registratie, AI-blauwdrukken en echte Bouwboek-betalingen.**

De code bevat een serieuze basis voor een checkout, maar juridische identiteit, contractuele leveranciersgegevens en operationele processen kunnen niet uit de repository worden afgeleid. De legal-pagina's bevatten daarom bewust een zichtbare launchwaarschuwing. Verwijder die waarschuwing pas nadat alle P0-punten aantoonbaar zijn afgerond.

Dit document is een technische/compliance-audit en geen vervanging voor advies van een Nederlandse consumenten- en privacyjurist.

## P0 — blokkades vóór Instagram- of publiekslaunch

| Blokkade | Wat aantoonbaar gereed moet zijn | Eigenaar / bewijs |
|---|---|---|
| Identiteit verkoper | Publiceer juridische/statutaire naam, gebruikte handelsnaam, rechtsvorm, vestigings- en klachtenadres, KvK-nummer, btw-id, telefoon, bereikbaarheid en geverifieerde e-mail. Gebruik exact dezelfde verkoper op site, Stripe, factuur/orderbevestiging en support. | Sol + boekhouder/jurist; KvK-uittreksel, btw-registratie en test van telefoon/e-mail |
| Verkoopmodel | Bevestig schriftelijk dat de Buildy-exploitant de verkoper/merchant of record is en Peecho fulfilmentpartner. Controleer Peecho Seller Agreement, DPA, productiepartners, retour/klachtproces en wie fabrikant/marktdeelnemer is. | Sol; ondertekend Peecho-contract en verantwoordelijkhedenmatrix |
| Prijs, btw en levering | Leg per formaat, pagina-aantal en land de verkoopprijs incl. btw, verzendkosten, valuta, toegestane landen en concrete levertermijn vast. Verifieer marge tegen actuele Peecho-kosten en refunds/herdrukken. Een vrijblijvende of onbegrensde “schatting” is onvoldoende. | Sol + boekhouder + Peecho; goedgekeurde prijsmatrix en testquotes |
| Checkoutconfiguratie | Productieconfiguratie moet doelbewust zijn ingevuld: Stripe live keys/webhook, SITE_URL, toegestane verzendlanden, btw-instelling, basis-/paginaprijs, verzending, levertermijn, Peecho API-/payment-URL, merchant key, secret, offering-id per formaat en pingback. Geen test- of localhost-URL. | Tech; vier-ogen-export zonder geheimwaarden en succesvolle smoke test |
| Informatie en duurzaam bewijs | Direct vóór betalen: exacte boekkenmerken, totaal incl. btw en verzending, levertermijn, leverbeperkingen en maatwerkuitzondering. Na betaling: e-mail/PDF die de order, verkopergegevens, prijs, levering en toepasselijke voorwaarden bevat. De checkoutcode en nieuwe migratie bewaren inmiddels een voorwaardenversie en ordersnapshot; pas de migratie toe en test vooral dat de klant na betaling werkelijk duurzaam bewijs ontvangt. Een bevestigingspagina alleen is daarvoor onvoldoende. | Tech + Sol; ontvangen testmail/PDF en orderrecord met versie |
| Klachten en wettelijke garantie | Richt één Buildy-route in voor schade, verkeerde druk, non-conformiteit, vertraging en refunds. Buildy blijft aanspreekpunt; dwing de klant niet naar Peecho/vervoerder. Leg ontvangstbevestiging, reactietijd, gratis herdruk/vervanging, prijsvermindering/ontbinding en escalatie vast. Geen vervaltermijn van 14 dagen. | Sol/support; runbook, sjablonen en testticket |
| Accountverwijdering versus administratie | Een nieuwe migratie archiveert minimale fiscale basisgegevens vóór de cascade en blokkeert verwijdering bij actieve fulfilment. De flow schrijft vóór de onomkeerbare auth/database-delete een duurzame cleanupqueue, serialiseert orders en uploads met dezelfde advisory lock, verwijdert storage pas nadat de auth-user weg is en laat fouten idempotent door de cleanupjob hervatten. Die job verifieert opnieuw dat de auth-user echt ontbreekt voordat bestanden worden verwijderd. Nog vereist: migratie en functies deployen, cleanupjob plannen, retry/alerting bewaken en storingsinjectie uitvoeren. Laat daarnaast boekhouder/privacy de archiefvelden en zevenjaarstermijn bevestigen en test rollback, actieve/terminale orders, toegangsverlies en archiefverwijdering. | Tech + boekhouder/privacy; toegepaste migratie, cronbewijs, storingsinjectietest, alert en datamodel |
| Print-PDF- en accountretentie | Verlaten checkouts krijgen nu een korte PDF-termijn, betaalde orders een harde maximale fallback en `SHIPPED` start de klachttermijn. Accountverwijdering doet een tweede storage-sweep en queue't een zeldzame restfout voor de cleanupjob. Nog open: functie deployen/plannen, alerts en retries bewaken en alle termijnen inhoudelijk goedkeuren. | Tech + Sol; retentiebesluit, cronbewijs, alarmtest en storage-test |
| Project- en updateverwijdering | De client probeert media bij een update mee op te ruimen, maar database en objectstorage delen geen transactie; een late storage- of databasefout kan nog een orphan of gebroken verwijzing geven. Een volledig project heeft bovendien geen server-side verwijderflow: een kale database-delete kan storage-objecten/PDF's verwezen, terwijl een actieve betaalde fulfilment juist moet blokkeren. Bouw en test één geauthenticeerde, hervatbare flow met `deletion_pending`-status, assetmanifest, orderstatuscontrole, fiscale archivering en idempotente cleanup vóór definitieve verwijdering. | Tech; storingsinjectie en E2E voor losse update, leeg project, legacy/private media, terminale order en actieve order |
| AVG-leveranciersdossier | Sluit en archiveer passende afspraken/DPA's met Supabase, Stripe, Peecho en — indien ingeschakeld — Lovable. Leg frontend-host, Supabase-regio, subprocessors, landen, transfermechanismen, supporttoegang, incidentmeldingen, verwijdering en back-ups vast. Vul privacytekst met werkelijke situatie. | Sol/privacy; leveranciersregister, contracten en transferanalyse |
| AI-blauwdruk | De functie stuurt een woningplattegrond via Lovable AI Gateway naar een Google Gemini-model. Frontend en server staan nu standaard uit; bij bewuste activatie geldt een atomaire daglimiet. Houd beide flags uit totdat plan/DPA, subprocessor, regio, retentie, training, verwijdering, kostenalarm en gebruikersinformatie zijn bevestigd. | Sol + privacy + tech; contractbewijs, quota-/alarmtest en end-to-end delete-test |
| Externe frontendverzoeken | Inter, Instrument Serif en Leaflet-iconen worden nu lokaal meegeleverd. De routekaart vraagt CARTO-tegels pas nadat de bezoeker de kaart bewust opent. Documenteer CARTO's leveranciersrol/grondslag en werk de productie-CSP bij. | Tech/privacy; netwerktrace en bijgewerkte leverancierslijst |
| DSA / sociale inhoud | Buildy host publieke gebruikersfoto's, teksten en reacties. Maak een makkelijk vindbaar elektronisch meldmechanisme voor specifieke illegale inhoud, bevestig ontvangst, behandel tijdig en niet-willekeurig, motiveer beslissingen en bied een contact-/bezwaarroute. Leg moderatieregels en spoedescalatie (bedreiging/kindermisbruik) vast. | Sol/moderatie + tech; anonieme meldtest, runbook en beslissjabloon |
| Leeftijd en derden op foto's | Kies minimale leeftijd en procedure voor minderjarigen. Voeg een operationele route toe voor portret/privacyverzoeken van mensen zonder account die in content voorkomen. Richt marketing niet op minderjarigen voordat dit is besloten en geïmplementeerd. | Sol/privacy; vastgesteld beleid en testcases |
| GPSR/productveiligheid | Bepaal met Peecho wie fabrikant, fulfilmentdienstverlener en/of distributeur van het Buildy-boek is. Zorg voor risicoanalyse/technische documentatie, product- of batchidentificatie, naam/post- en e-mailadres van fabrikant/EU-verantwoordelijke op aanbod en product/verpakking, klachtenregister en recallprocedure. | Sol + Peecho; rollenmatrix, productsample en dossier |

## P1 — direct na de launchblokkades

- **Dynamische deelvoorbeelden:** project- en profielmetadata worden nu pas in de
  browser gezet. Instagram, WhatsApp en Facebook zien daardoor de generieke
  Buildy-kaart. Bouw een server-/Edge-route `/s/:tripId` die uitsluitend voor
  aantoonbaar openbare projecten veilig ge-escapete OG-HTML levert. Serveer de
  cover via een autoriserende image proxy; gebruik nooit een tijdelijke private
  signed URL als duurzaam `og:image`.
- **Printproof-fideliteit:** de React-editor en jsPDF-export zijn twee renderers
  en tonen nog niet gegarandeerd elk detail identiek. De UI noemt dit daarom nu
  eerlijk een opmaakvoorbeeld. Maak vóór schaalvergroting thumbnails van de
  werkelijk gegenereerde PDF of laat beide renderers één gedeeld paginamodel
  gebruiken en voeg visuele regressietests per paginatype toe.
- **Verwijder-saga's:** update-, project- en accountverwijdering moeten
  idempotent blijven bij een storage- of databasefout. Gebruik duurzame jobs,
  assetmanifesten, retries en alarms in plaats van losse client-side
  deletevolgordes; test iedere tussenstap en herstelroute.

## Uitvoerbare privacy- en database-gates

Voer deze read-only audits uit tegen de productieomgeving met een service-role key
in een afgeschermde terminal. De scripts tonen de key niet en wijzigen geen data:

```sh
SUPABASE_URL="https://PROJECT.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="..." \
bun run audit:private-assets

SUPABASE_URL="https://PROJECT.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="..." \
bun run audit:social
```

Beide scripts moeten `PASS` en exitcode 0 geven. De media-audit loopt de
publieke `trip-media`- en `avatars`-buckets recursief door en vergelijkt alle
objecten met project-, update- en avatarverwijzingen. Een publieke URL bij een privéproject,
een publieke projectmedia-URL bij een nu nog openbaar project, een publiek
orphan object, een ontbrekend object of een orphan social row is een
launchblokkade. Ook media van openbare projecten moet vóór launch naar
`trip-private`, omdat de eigenaar het project later privé kan zetten terwijl
een eerder gedeelde publieke object-URL anders leesbaar blijft. Alleen bewust
publieke profielavatars mogen als databaseverwijzing in `trip-media` blijven. Kopieer
legacy media eerst naar het juiste `trip-private`-pad, verifieer de kopie,
schrijf daarna het stabiele `storage_path` en verwijder pas dan het publieke
bronobject. De audit is bewust read-only; herstel of verwijder elk gevonden
object afzonderlijk en voer hem opnieuw uit totdat hij schoon is.

`trip-media` is voor clients legacy read-only. Nieuwe profielfoto's gaan naar
de afzonderlijke publieke `avatars`-bucket, beperkt tot twee wisselende
`<user>/avatar-[ab].<ext>`-slots, vier afbeeldings-MIME-types en 10 MB. Plan
desondanks quota/rate-limits, orphan-monitoring en abuse-alerts.

Pas na een schone `audit:social` mogen de aanvankelijk `NOT VALID` gemaakte
constraints worden gevalideerd:

```sql
ALTER TABLE public.follows VALIDATE CONSTRAINT follows_project_id_fkey;
ALTER TABLE public.follows VALIDATE CONSTRAINT follows_user_id_fkey;
ALTER TABLE public.user_follows VALIDATE CONSTRAINT user_follows_follower_id_fkey;
ALTER TABLE public.user_follows VALIDATE CONSTRAINT user_follows_following_id_fkey;
ALTER TABLE public.reactions VALIDATE CONSTRAINT reactions_step_id_fkey;
ALTER TABLE public.reactions VALIDATE CONSTRAINT reactions_user_id_fkey;
ALTER TABLE public.comments VALIDATE CONSTRAINT comments_parent_id_fkey;
ALTER TABLE public.notifications VALIDATE CONSTRAINT notifications_user_id_fkey;
ALTER TABLE public.notifications VALIDATE CONSTRAINT notifications_actor_id_fkey;
ALTER TABLE public.notifications VALIDATE CONSTRAINT notifications_project_id_fkey;
ALTER TABLE public.notifications VALIDATE CONSTRAINT notifications_step_id_fkey;
```

Controleer daarna dat `pg_constraint.convalidated = true` is voor alle elf namen.
Verwijder nooit blind legacy relaties of media: maak per gevonden rij/object een
herstel- of verwijderbesluit en bewaar het operationele bewijs.

## Gegevens die Sol nog moet aanleveren

### Onderneming en contact

- Juridische/statutaire naam, rechtsvorm en exacte Buildy-handelsnaam.
- Vestigingsadres en, indien anders, adres voor klachten.
- KvK-nummer en btw-identificatienummer.
- Telefoonnummer, normale bereikbare dagen/tijden en basistariefbevestiging.
- Werkende adressen voor support/klachten, privacy, security/datalekken en DSA-contentmeldingen.
- Definitief productiedomein en de entiteit die dat domein en de Stripe-account beheert.
- Eventuele aansluiting bij brancheorganisatie, geschillencommissie of commerciële garantie. Niet noemen als die er niet is.

### Commerciële beslissingen

- Landen waarin bij launch wordt verkocht, valuta en btw-/OSS-behandeling per land.
- Definitieve verkoopprijzen per formaat/pagina, verzendtarief per land en bevestiging “incl. btw”.
- Realistische levertermijn per land en formaat, cut-off/feestdagen en wat gebeurt bij overschrijding.
- Vrijwillig annuleringsbeleid vóór productie; dit niet verwarren met herroepingsrecht.
- Support-SLA, bewijs dat support bemand is en bevoegdheid/budget voor refund of herdruk.
- Factuur-/orderbevestigingsproces en afzenderdomein.

### Leveranciers, data en retentie

- Frontend host/CDN en daadwerkelijke data-/loglocatie.
- Supabase productieregio, plan, back-upretentie, auth-/edge-/database-/storagelogretentie en DPA.
- Google-login en Lovable OAuth-broker: geactiveerde OAuth-scopes, contract-/controllerrollen, doorgiften en procedure om de koppeling bij accountverwijdering te beëindigen.
- Stripe contractentiteit, geactiveerde betaalmethoden, Radar/automatische belasting, DPA/controllerinformatie, receipt-instellingen en refundproces.
- Peecho contract, DPA, subverwerkers/druklocaties, API-status/pingbackdocumentatie, bezorgpartners, productie-SLA en GPSR-rol.
- Lovable-plan dat een DPA dekt, AI Gateway-subprocessors, model-/input-/output-/logretentie, training en doorgiften; anders AI-functie uitschakelen.
- Maximale termijnen voor accountdata, verwijderde content/back-ups, securitylogs, support/klachten, verlaten checkout, betaalde print-PDF en operationele orderdetails.
- Vastgelegd verwerkingsregister, gerechtvaardigd-belangafwegingen, DPIA-screening, datalekregister en incident-/rechtenprocedure.

### Product- en platformbeleid

- Minimumleeftijd en behandeling van minderjarigen.
- Gedragsregels, moderatiebeslissers, illegale-inhoudmeldpunt, bezwaar en spoedcontact.
- Welke projectvelden publiek kunnen worden en welke nooit; controleer ook legacy media/coördinaten en herkenbare plattegronden.
- Of nieuwsbrieven, analytics, pixels, advertenties of reviewfunctionaliteit bij launch aanstaan. Zo ja: afzonderlijke juridische en cookietoets.
- Bevestiging of de onderneming als micro-onderneming onder een toepasselijke toegankelijkheidsuitzondering valt; leg werknemers, omzet en balanstotaal vast. Anders volledige EAA/WCAG-conformiteit organiseren.

## Gerichte acceptatietest vóór GO

1. Open voorwaarden, privacy en herroeping uitgelogd en op mobiel. Er staat geen launchwaarschuwing, placeholder of niet-werkend contact meer.
2. Maak een nieuw privéproject, daarna bewust een openbaar project. Controleer met een uitgelogde browser welke profiel-, adres-, budget-, aannemers-, media-, plattegrond- en legacy locatievelden zichtbaar zijn.
3. Vraag voor elk boekformaat en elk verkoopland een quote op. Vergelijk serverquote, Buildy-samenvatting, Stripe-regelitems, btw, verzending en afschrijving exact op centniveau.
4. Rond één Stripe-testbetaling en één gecontroleerde live bestelling af. Verifieer gesigneerde webhook, idempotentie, orderversie, volledige duurzame bevestiging, Peecho-order, tracking en statussen.
5. Simuleer betaling mislukt, checkout verlopen, dubbele webhook, Peecho tijdelijk niet bereikbaar, productie afgekeurd, vertraging, transportschade, herdruk en refund. Geen betaalde order mag stil blijven hangen.
6. Verwijder een account zonder order, met open checkout, met betaalde lopende order en na levering. Controleer database, alle storage-buckets, providerdata, toegangsverlies, wettelijk archief en auditlogs.
7. Dien als uitgelogde bezoeker een DSA-melding in op een concrete foto/reactie. Controleer ontvangstbevestiging, dossier, besluit, motivering, privacy van melder en bezwaarroute.
8. Maak een AVG-inzage-, correctie-, dataportabiliteits- en verwijderverzoek voor een gebruiker én voor een derde op een foto. Meet of het proces binnen de wettelijke termijn kan worden uitgevoerd.
9. Neem een browser-netwerktrace op van homepage, login, openbaar project, kaart, AI en checkout. Iedere derde partij moet in het leveranciersregister en de privacytekst staan of worden verwijderd/self-hosted.
10. Laat een Nederlandse consumenten-/privacyjurist de definitieve teksten, checkout en orderbevestiging beoordelen op de concrete onderneming en landen waarin werkelijk wordt verkocht.

## Relevante primaire en autoritatieve bronnen

- Burgerlijk Wetboek 6, informatie bij koop op afstand en totaalprijs: https://wetten.overheid.nl/BWBR0005289/Boek6/Titeldeel5/Afdeling2b/Paragraaf2/Artikel230m/
- Burgerlijk Wetboek 6, betaalverplichting/bestelproces: https://wetten.overheid.nl/BWBR0005289/Boek6/Titeldeel5/Afdeling2b/Paragraaf5/Artikel230v/
- Burgerlijk Wetboek 6, maatwerkuitzondering: https://wetten.overheid.nl/BWBR0005289/Boek6/Titeldeel5/Afdeling2b/Paragraaf3/Artikel230p/
- Burgerlijk Wetboek 7, levering binnen dertig dagen tenzij anders afgesproken: https://wetten.overheid.nl/BWBR0005290/Boek7/Titeldeel1/Afdeling2/Artikel9/
- Burgerlijk Wetboek 7, conformiteit en remedies: https://wetten.overheid.nl/BWBR0005290/Boek7/Titeldeel1/Afdeling3/
- Burgerlijk Wetboek 7, klacht binnen twee maanden na ontdekking in ieder geval tijdig: https://wetten.overheid.nl/BWBR0005290/Boek7/Titeldeel1/Afdeling3/Artikel23/
- ACM, verplichte informatie vóór en na de koop: https://www.acm.nl/nl/verkoop-aan-consumenten/consumenten-informeren/verplichte-informatie-voor-en-na-de-koop
- ACM, prijs inclusief btw en bijkomende kosten: https://www.acm.nl/nl/verkoop-aan-consumenten/consumenten-informeren/prijzen-vermelden
- ACM, wettelijke garantie: https://www.acm.nl/nl/verkoop-aan-consumenten/klantenservice/garantie
- ACM, redelijke algemene voorwaarden: https://www.acm.nl/nl/verkoop-aan-consumenten/de-koop-sluiten/algemene-voorwaarden-aanbieden
- KVK, verplichte bedrijfsgegevens bij online verkoop: https://www.kvk.nl/wetten-en-regels/online-verkopen-deze-regels-moet-je-kennen/
- Belastingdienst, facturen normaal zeven jaar bewaren: https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/zakelijk/btw/administratie_bijhouden/facturen_maken/uw_facturen_bewaren
- AVG, met name artikelen 5, 6, 13, 15-22, 28 en 44-49: https://eur-lex.europa.eu/eli/reg/2016/679/oj
- Autoriteit Persoonsgegevens, privacyrechten in de praktijk: https://autoriteitpersoonsgegevens.nl/themas/basis-avg/privacyrechten-avg/voor-organisaties-privacyrechten-in-de-praktijk
- DSA, met name artikelen 14, 16 en 17: https://eur-lex.europa.eu/eli/reg/2022/2065/oj
- ACM, illegale inhoud melden en behandelen: https://www.acm.nl/nl/digitale-economie/rechten-van-ondernemers-bij-online-diensten/illegale-opzettelijk-onjuiste-content
- NVWA, GPSR en verkoop op afstand: https://www.nvwa.nl/onderwerpen/productveiligheid/gpsr-productveiligheidsverordening/wat-betekent-de-gpsr-voor-mij
- ACM ConsuWijzer, toegankelijkheid webwinkels en micro-ondernemingen: https://www.consuwijzer.nl/toegankelijkheid/toegankelijkheid-van-webwinkels-en-communicatiediensten
- Supabase DPA en regio's: https://supabase.com/legal/dpa en https://supabase.com/docs/guides/platform/regions
- Stripe Privacy Center: https://stripe.com/nl/legal/privacy-center
- Peecho Seller Terms (inclusief verwijzing naar DPA): https://www.peecho.com/seller-terms-conditions
- Lovable DPA: https://lovable.dev/data-processing-agreement

Let op voor toekomstige niet-gepersonaliseerde producten of andere overeenkomsten met bedenktijd: sinds juni 2026 geldt ook een online herroepingsfunctie. Zie https://ondernemersplein.overheid.nl/wetswijzigingen/webshops-moeten-een-herroepingsknop-hebben/. Voor het uitsluitend volgens klantspecificatie gemaakte Bouwboek bestaat het herroepingsrecht zelf niet; toon daarom geen misleidende algemene “14 dagen retour”-belofte.
