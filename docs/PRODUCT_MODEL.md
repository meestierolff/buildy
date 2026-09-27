# Productmodel

Status: canonieke productwaarheid voor de Buildy production-MVP.

## Fundament

| Vraag | Antwoord |
|---|---|
| Voor wie? | Mensen die hun eigen huis verbouwen, plus vrienden en familie die willen meeleven. |
| Probleem | Voortgangsfoto's, keuzes en updates raken verspreid; herhaald delen kost energie en het uiteindelijke verhaal verdwijnt. |
| Belofte | “Maak van je verbouwing een verhaal om te bewaren.” |
| Aha-moment | Eén foto wordt direct een Bouwmoment, onderdeel van het Verhaal en een nieuwe Bouwboek-spread. |
| Deelbaar artefact | Een Voor & Na Spread op basis van twee echte Bouwmomenten. |

Buildy is eerst een foto-first dagboek en een vertrouwde kring rond een
verbouwing. Social en commerce ondersteunen het Verhaal; ze zijn geen op
zichzelf staande feed of marktplaats.

## Zichtbare domeintaal

| Zichtbaar | Betekenis | Historische interne naam die mag blijven |
|---|---|---|
| Verbouwing | het dagboek en de privacygrens van één verbouwing | `project`, eerder `trip` |
| Bouwmoment | een gedateerde foto-first bijdrage | `update`, eerder `step` |
| Verhaal | de chronologische reeks gepubliceerde Bouwmomenten | `timeline` |
| Bouwboek | het afgeleide digitale en drukbare boek | `photobook` |
| Connecties | profielrelaties en verzoeken | `friends` |
| Volgend | zichtbare activiteit van gevolgde profielen | `favorites` / feed |

Nieuwe UI en klantcopy gebruiken uitsluitend de zichtbare termen. Interne
typen, routes en append-only tabellen hoeven niet destructief te worden
hernoemd zolang ze geen tweede productconcept introduceren.

## Actoren en eigendom

- De eigenaar beheert het profiel, de Verbouwing, Bouwmomenten, bronmedia,
  Bouwboekrevisies en eigen orders.
- Een volger kan uitsluitend lezen en interacteren binnen de actuele
  zichtbaarheid. Volgen geeft nooit editrechten.
- Een anonieme bezoeker ziet alleen openbare inhoud of `unlisted` inhoud na
  geldige redemption van een owner-issued, niet verlopen/ingetrokken share-
  capability. De gewone project-URL is geen capability.
- Een beheerder krijgt bevoegdheid uit een server-side role grant, nooit uit
  clientinput of alleen een e-mailadres.
- Stripe levert alleen betaalfeiten via een geverifieerde webhook. De browser
  is geen bron voor betaalstatus.
- De founder plaatst een printorder handmatig buiten Buildy en legt de voortgang
  vervolgens via de beveiligde beheerflow vast.

## Kernobjecten

### Profiel en relatie

Een profiel is openbaar of privé. Profile following is de enige zichtbare
people-to-people relatie. Bij een openbaar profiel wordt volgen direct actief;
bij een privéprofiel ontstaat eerst een verzoek. Blocking heeft voorrang op
ieder follow- of toegangsresultaat. Zie
[SOCIAL_STATE_MACHINE.md](./SOCIAL_STATE_MACHINE.md).

### Verbouwing en Bouwmoment

Een Verbouwing start standaard privé en kent vier server-side
zichtbaarheidsmodi: Alleen ik, Mijn volgers, Iedereen met een geldige tijdelijke
deellink en Openbaar.
Een Bouwmoment hoort bij exact één Verbouwing. De eigenaar kan concepten zien;
anderen alleen gepubliceerde Bouwmomenten die onder de actuele toegang vallen.

De eerste geldige composeractie is één foto plus een datum. Titel, Verhaaltekst,
fase en mijlpaal zijn aanvullend. Foto's hebben de meeste visuele en
informatieve waarde.

Na upload-completion verwerkt dezelfde geauthenticeerde flow uitsluitend het
exacte asset onder de mediaworkerrol. Een begrensde owner-poll kan dezelfde
leased/idempotente claim veilig hervatten; verwerking wacht niet op een cron.

### Verhaal, interactie en Volgend

Het Verhaal is chronologisch, photo-led en gepagineerd. Reacties, comments,
mentions, notificaties en Volgend worden op iedere read opnieuw begrensd door
publicatiestatus, ownership, zichtbaarheid, moderatie, verwijdering en blocking.
De feed gebruikt chronologie, geen engagementranking.

### Bouwboek en printproof

Het Bouwboek wordt uit echte Bouwmomenten afgeleid. Een printproof is een
private, immutable revisie met documenthash, mediaset en PDF-hash. Alleen een
actueel, expliciet goedgekeurd proof mag naar checkout. Een relevante
bronwijziging maakt een ouder proof ongeschikt voor een nieuwe bestelling.
Het proofrequest verwerkt direct uitsluitend de exacte revisie onder de
photobookworkerrol; zolang die `rendering` is, mag de owner-editorpoll diezelfde
verwerking begrensd hervatten. Er is geen photobookcron.

### Quote, bestelling en fulfilment

Een quote komt uit een actuele, goedgekeurde server-owned prijsmatrix. De klant
bevestigt verzendadres, actuele voorwaarden en het maatwerkkarakter. De server
reserveert de order idempotent en maakt Stripe Checkout aan. Alleen een geldig
Stripe-event kan de order betaald maken. Een betaalde order komt in de
handmatige beheerqueue; er bestaat geen actieve printprovider-automatisering.

## Productlussen

```text
Eigenaar:  Verbouwing → Bouwmoment → reactie → volgend Bouwmoment → groeiend Bouwboek
Volger:    zoeken/delen → volgen/verzoek → Bouwmoment → interactie → notificatie → terugkeer
Commerce:  Bouwboek → proof genereren → goedkeuren → proof locken → quote → Stripe → handmatige fulfilment
```

## Server-owned productwaarheid

`PRODUCT_PROFILE=feedback_beta` is het enige profiel. De browser leest
`/api/product-profile` en leidt mogelijkheden af uit servercapabilities. De
server publiceert onder meer gebruikersnaam/wachtwoord-login, media, Bouwboek-preview,
accountverwijdering en checkout alleen als de vereiste runtimeconfiguratie
compleet is.

Checkout heeft drie expliciete modi:

- `off`: uit en fail-closed;
- `test`: Stripe testconfiguratie en goedgekeurde testmatrix;
- `live`: alleen bij een volledig overeenkomende liveconfiguratie en alle
  externe releasegates.

E-mailauth en e-maildelivery zijn altijd uit; geautomatiseerde printfulfilment
is altijd uit. Dat verhindert Stripe Checkout of handmatige fulfilment niet.

## Niet-onderhandelbare invarianten

- Browsercode gebruikt alleen typed same-origin API-clients.
- Identiteit, autorisatie, prijzen, sellergegevens en statusovergangen zijn
  server-owned.
- Customer-media en print-PDF's staan privé in Vercel Blob en worden alleen via
  geautoriseerde Buildy-routes gelezen.
- Media en Bouwboek gebruiken request-driven exact-target processing met hun
  eigen worker-DB-URL en private Blob, niet `CRON_SECRET`.
- Een link, follow of request kan nooit schrijfrechten geven.
- Een privacywijziging of block geldt op de eerstvolgende read en invalideert
  niet langer toegestane clientdata.
- Een Stripe-successpagina verandert geen betaalstatus.
- Iedere order bindt aan één exacte goedgekeurde Bouwboekrevisie.
- PII staat niet in URL's, logs, eventmetadata of idempotencykeys.
- Migrations zijn append-only; historische data wordt veilig behouden.
- Geen zichtbare actie mag “waarschijnlijk werken”: ze is bewezen, verwijderd
  of een expliciete releaseblokkade.

## Productgrens

Budget en plattegronden zijn secundair. Buildy is geen projectmanagementsuite,
algoritmische socialfeed, printproviderplatform of geavanceerde DTP-editor.
Nieuwe prominente functionaliteit hoort aantoonbaar bij vastleggen, samen
beleven, terugkijken, bewaren of bestellen.
