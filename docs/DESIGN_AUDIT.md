# Buildy designaudit

> **Historische nulmeting — geen actuele release- of providerwaarheid.** Dit
> document blijft in-place bewaard omdat `DESIGN_SYSTEM.md` naar de onderbouwde
> ontwerpbevindingen verwijst. De audit beschrijft de interface van vóór de
> relaunch. Gebruik voor actuele scope, bewijs en blokkades
> [`MVP_RELEASE_REPORT.md`](MVP_RELEASE_REPORT.md) en
> [`PRODUCTION_RELEASE.md`](PRODUCTION_RELEASE.md).

**Datum:** 4 augustus 2026

**Status:** superseded historische nulmeting; niet gebruiken voor acceptatie

**Scope:** bestaande React/Vite-interface, lokale en bereikbare oude prototypeprovider-liveomgeving, mobiel/tablet/desktop, publieke en voor zover zonder testaccount bereikbare afgeschermde flows

## Samenvatting

Buildy heeft al een herkenbare warme basis, een bruikbaar huis/boek-merkidee en een brede set productflows. De huidige ervaring voelt echter nog als een verzorgde prototype-template: te veel cursieve serif, pillknoppen, kaarten en blueprintdecoratie; te weinig duidelijke app-hiërarchie; onvoldoende mobiele bediening; en geen aantoonbare WCAG 2.2 AA-dekking. De foto's en de voortgang van de gebruiker horen de visuele hoofdrol te krijgen, maar concurreren nu met decoratie, grote lege vlakken en wisselende componentpatronen.

Het redesign moet niet cosmetisch over de bestaande schermen worden gelegd. Eerst worden informatiearchitectuur, privacykeuzes, mobiele navigatie en gedeelde states opnieuw opgebouwd. Daarna worden tijdlijn, media, plattegrond, budget en Bouwboek als samenhangende productoppervlakken uitgewerkt.

## Baseline en bewijs

De 102 historische PNG's staan buiten de productbundel in
[`artifacts/baseline/`](../artifacts/baseline/). Er staat in deze snapshot geen
`manifest.json`; leid daarom geen actuele route-, HTTP- of browserstatus af uit
alleen deze afbeeldingen.

### Omgevingen en viewports

| Omgeving | Basis-URL | Viewports | Resultaat |
|---|---|---|---|
| Lokaal | `http://127.0.0.1:8090` | 390×844, 768×1024, 1440×1000 | 51 screenshots; 0 capture failures; 0 geregistreerde browserfouten |
| Huidige liveomgeving | `<voormalige-live-referentie>` | 390×844, 768×1024, 1440×1000 | 51 screenshots; 0 capture failures; 0 geregistreerde browserfouten |

De bestandsconventie is `{environment}-{viewport}-{scenario}.png`, bijvoorbeeld:

- [`live-mobile-landing-logged-out.png`](../artifacts/baseline/live-mobile-landing-logged-out.png)
- [`live-desktop-public-project.png`](../artifacts/baseline/live-desktop-public-project.png)
- [`live-desktop-photobook.png`](../artifacts/baseline/live-desktop-photobook.png)
- [`local-tablet-connections.png`](../artifacts/baseline/local-tablet-connections.png)

### Vastgelegde scenario's

| Scenario | Vastgelegd | Wat de baseline daadwerkelijk bewijst |
|---|---:|---|
| Landing uitgelogd | lokaal + live, 3 viewports | Volledige publieke landing en discovery-oppervlak |
| Login/registratie | lokaal + live, 3 viewports | Registratiemodus en publieke auth-shell |
| Nieuw project | lokaal + live, 3 viewports | Correcte redirect naar registratie met behouden `next`; niet de owner-form zelf |
| Eigen projecttijdlijn | lokaal + live, 3 viewports | Publiek/uitgelogd resultaat voor het bekende project; niet de ownercontrols |
| Publiek project | lokaal + live, 3 viewports | Projectheader, tijdlijn, tabs, media en publieke acties |
| Privéproject/toegang | lokaal + live, 3 viewports | Uitgelogde/toegangsstatus voor bekende URL; pending/accepted rollen niet bewezen |
| Updatecomposer | lokaal + live, 3 viewports | Dat de composer uitgelogd niet beschikbaar is; de echte composer is niet visueel gevalideerd |
| Voor/na-viewer | lokaal + live, 3 viewports | Publieke viewer waar brondata beschikbaar is |
| Connecties | lokaal + live, 3 viewports | Publieke zoek-/lege staat; ingelogde verzoekacties niet bewezen |
| Publiek profiel | lokaal + live, 3 viewports | Publieke profielweergave |
| Notificaties | lokaal + live, 3 viewports | Uitgelogde onbeschikbaarheid; popover en acties niet visueel bewezen |
| Budget | lokaal + live, 3 viewports | Publieke/afgeschermde resultaatstatus; owner-edit niet bewezen |
| Plattegrond | lokaal + live, 3 viewports | Publieke floorplan-tab waar data beschikbaar is |
| Bouwboekeditor | lokaal + live, 3 viewports | Publieke preview op mobiel, tablet en desktop; ownereditor niet bewezen |
| Checkoutdialog | lokaal + live, 3 viewports | Uitgelogde onbeschikbaarheid; echte quote/checkout niet bewezen |
| Orderstatus | lokaal + live, 3 viewports | Veilige redirect naar auth; echte orderstatus niet bewezen |
| Accountinstellingen | lokaal + live, 3 viewports | Veilige redirect naar auth; ingelogde instellingen niet bewezen |

### Beperking van de baseline

Er waren geen synthetische testcredentials of veilige Playwright `storageState`. Daarom zijn de homepage ingelogd, ownercontrols, updatecomposer, notificatieacties, checkout en echte orderstatus niet als ingelogde flow vastgelegd. De bestanden zijn wel bewust bewaard als bewijs van de huidige toegangsfallback; ze mogen niet als functionele acceptatie van de afgeschermde flow worden gebruikt.

De live screenshots bevatten op meerdere schermen een zwevende “Edit with oude prototypeprovider”-badge. Dat is een eigenschap van de huidige liveomgeving, geen Buildy-component. Nieuwe visuele regressie-artifacts moeten deze provider-overlay niet bevatten.

## Huidige ontwerpbevindingen

### Merk en visuele taal

**Behoudwaardig**

- De warme papierbasis, grafiettekst en het oxide-/baksteenaccent passen bij renovatie en tastbaar drukwerk.
- Inter Variable en Instrument Serif worden lokaal geladen en ondersteunen de gewenste sans/editorial-combinatie.
- Het compacte huis/open-boekidee in `BrandLogo` is een bruikbare basis voor een verfijnd merkteken.
- Subtiele lijnvoering, hoofdstuknummers en technische annotaties werken goed wanneer ze spaarzaam worden ingezet.
- `prefers-reduced-motion` is al aanwezig.

**Problemen**

- Alle `h1`- tot en met `h6`-elementen erven globaal de serif. Daardoor krijgen appkoppen, lege staten, navigatiecontext en formulieren dezelfde redactionele toon als marketing en het Bouwboek.
- Cursieve serif wordt zo vaak gebruikt dat hiërarchie en herkenbaarheid afnemen. Op mobiel vermindert dit de scanbaarheid van functionele schermen.
- Pills, afgeronde containers en losse kaarten vormen vaak de primaire compositie. Dat levert “card soup” op in plaats van een rustig veldboek.
- Blueprintpatronen keren terug op landing, project, placeholders en Bouwboek. Het technische motief is daardoor decoratie in plaats van betekenisvol detail.
- Het logo is op klein formaat herkenbaar, maar woordmerk, app-icoon en project-/Bouwboekgebruik zijn nog niet als één getest systeem gedocumenteerd.
- De toenmalige landing gebruikte de inmiddels vervangen copy “Van eerste
  sleutel tot laatste plint.” De actuele founder-belofte staat in de canonieke
  productdocumentatie.

### Landing en publieke ontdekking

- De desktophero toont de propositie helder, maar productbewijs bestaat vooral uit een gestileerde kaart. Echte gebruikersfoto's en een tastbare tijdlijn-naar-Bouwboektransformatie moeten eerder zichtbaar zijn.
- De pagina is lang en bevat veel grote verticale tussenruimtes. Op mobiel kost het veel scrollen voordat echte projecten verschijnen.
- Marketing, discovery en “mijn projecten” zitten in één route. Ingelogde gebruikers houden daardoor een marketingachtige home in plaats van een taakgericht dashboard.
- Projectkaarten geven titel, type, eigenaar, updateaantal en voortgang goed weer; lege/grijze mediavlakken nemen in de baseline echter veel visueel gewicht in.
- Filters en kleine uppercase labels zijn visueel subtiel, maar soms te klein en met te ruime letterspatiëring voor snelle mobiele herkenning.

### App-shell en navigatie

- Desktopnavigatie gebruikt Ontdekken, Volgend en Vrienden; mobiel verandert de set op basis van auth. De gewenste vaste taakstructuur ontbreekt.
- Mobiel ontbreken “Mijn projecten” en een centrale actie “Update”. De primaire vastlegtaak is daardoor niet altijd binnen één tap bereikbaar.
- “Vrienden”, “Volgend”, “Favorieten”, projectvolgen en toegang lopen terminologisch door elkaar.
- De globale header en footer blijven ook rond het Bouwboek staan, waardoor de editor minder als gefocuste werkruimte voelt.
- De fixed mobiele navigatie kan projectcontent, oude prototypeprovider-overlay en footer visueel kruisen. Alleen de onderzijde gebruikt een safe-area-inset.

### Projectheader en tijdlijn

- De donkere projectheader levert sterk contrast met projectfoto's en toont nuttige kerncijfers.
- Op mobiel stapelen cover, lange beschrijving, volgen/delen, vier statistieken en voortgang zich op tot een zware introductie vóór de tijdlijn.
- Op desktop vult de horizontale tijdlijn slechts een deel van de pagina en ontstaat veel ongebruikte ruimte. De carousel dwingt tevens een lineaire horizontale interactie af voor content die vaak verticaal gelezen wordt.
- “Dag N” en routekaartlogica zijn reis-template-erfenissen en passen niet bij renovatiefases.
- Tijdlijnkaarten combineren verschillende afbeeldingsverhoudingen en tekstlengtes zonder duidelijke compact/expanded-regels.
- Kleine ownerknoppen, draghandles en sociale acties halen de vereiste 44×44px vaak niet.
- Likes en emoji-reacties zijn twee parallelle reactiesystemen; dat maakt de onderkant van een update drukker zonder een duidelijk mentaal model.

### Composer, gallery en media

- De composer ondersteunt veel relevante invoer, maar presenteert die in één zware dialog. Foto's zijn nog niet overtuigend de snelste eerste stap.
- Uploadprogressie, drafts, retry en herstel na sluiten ontbreken in de visuele flow.
- Native drag-and-drop en hover-controls hebben geen volwaardig toetsenbord- of knopalternatief.
- De lightbox ondersteunt pijltjes en swipe, maar mist zoom, volledige focusbeheersing en een consistente terugkoppeling naar de tijdlijn.
- Voor/na is visueel sterk als concept, maar de slider is pointer-only en heeft geen toegankelijke slidersemantiek.
- PDF's, video's, foto's, covers en voor/na-rollen hebben niet overal dezelfde preview- en selectiepatronen.

### Connecties, profiel en notificaties

- De connectiespagina heeft een heldere zoekingang, maar de grote lege kaart en serifkop voelen marketingachtig in een functionele appcontext.
- Privéprofielen gebruiken niet consequent “Verzoek sturen”. “Vrienden” moet “Connecties” worden.
- Profielstatistieken en badges concurreren met de kern: projecten en voortgang. Emoji-/automatisch verdiende badges zijn niet volwassen of aantoonbaar betekenisvol.
- Avatarbewerking is hover-afhankelijk en op touch slecht vindbaar.
- Notificaties bestaan alleen als compacte popover; er is geen volwaardige geschiedenis, status of instellingenpagina.

### Plattegrond en budget

- Plattegronden en pins zijn onderscheidende Buildy-functionaliteit en moeten blijven.
- De huidige bediening is pointergericht, zonder mobiele pan/zoom en zonder toetsenbordalternatief voor pinnen.
- Verdiepingen missen rename, reorder en individuele delete. Updates op een andere verdieping kunnen ten onrechte als ongepind worden gepresenteerd.
- Budget is leesbaar als eenvoudige samenvatting, maar mist categorieën, gepland/werkelijk, export en een zelfstandig deelbeleid.
- De toggle “Budget openbaar maken” is een directe privacywijziging zonder preview of waarschuwing.
- Bedragen en gemengde werkverdeling worden niet overal financieel correct samengevat.

### Bouwboek, printproof en checkout

- De donkere editorstage laat het boek duidelijk loskomen van de app en de desktopspread voelt tastbaar.
- De baseline koppelt de cover visueel direct aan pagina 2 en geeft nauwelijks rug-/omslagcontext.
- De preview is relatief klein binnen een zeer groot donker vlak; op mobiel ontbreken swipe, zoom en robuuste paginanavigatie.
- De editor en PDF zijn twee visueel verschillende renderers. De preview kan daarom niet als echte printproof gelden.
- Cropcontrols wekken verwachtingen die niet duurzaam worden opgeslagen of in de PDF worden toegepast.
- Er zijn geen effectieve-DPI-, decode-, asset- of extreme-cropwaarschuwingen.
- Checkout volgt niet uit een expliciet goedgekeurde, gehashte revisie. De gebruiker ziet niet aantoonbaar exact de bytes die betaald en gedrukt worden.

### States en foutcommunicatie

- Routefallbacks, skeletons, lege states, Sonner-toasts en een ErrorBoundary bestaan al.
- States zijn niet systematisch: sommige fouten worden gelogd maar niet getoond, sommige mutations tonen succes ondanks een genegeerde deelmutatie en sommige schermen vallen bij elke fout terug op een toegangskaart.
- Skeletons en lege mediavlakken hebben niet overal dezelfde uiteindelijke geometrie, met risico op layout shift.
- Online/offline, uploadretry, stale data, gedeeltelijk geslaagde acties en privacywijzigingen hebben geen gedeeld patroon.

## Accessibility-audit

WCAG 2.2 AA is nog niet aangetoond. De belangrijkste concrete gaps zijn:

1. Effectieve touch targets zijn op veel plekken 28, 36 of 40px in plaats van minimaal 44×44px.
2. Voor/na heeft geen `role="slider"`, waarde-attributen, tabfocus of toetsenbediening.
3. Media- en paginareorder gebruikt drag zonder toetsenbord- of knopalternatief.
4. Floorplanpins zijn pointer-only en missen een lineaire, screenreaderbruikbare plaatsingsflow.
5. De custom lightbox mist volledige focustrap, inert achtergrond en focusrestore.
6. Hover-afhankelijke acties zijn op mobiel niet betrouwbaar vindbaar.
7. Emoji worden soms als primaire iconografie gebruikt zonder consistent labelsysteem.
8. Async mutations hebben niet overal `aria-live`, busy-state en foutherstel.
9. Kleine uppercase tekst met ruime tracking is op verschillende schermen moeilijk leesbaar.
10. Boeknavigatie mist een complete toetsenbord-, swipe- en screenreaderstrategie.
11. Tijdlijn, tabbladen en deep links hebben nog geen geteste focusbestemming na navigatie.
12. Er is geen geautomatiseerde axe-suite of handmatige screenreaderronde in de huidige baseline.

## Redesignprincipes

### 1. Eerst de taak, daarna het merkgebaar

De interface gebruikt een zeer leesbare variable sans. De editorial serif is beperkt tot landingmomenten, projectcovers, hoofdstukopeningen en het Bouwboek. Merkdecoratie mag nooit navigatie, privacy of invoer overschaduwen.

### 2. Foto's en voortgang zijn de compositie

Echte projectmedia, de chronologie en de transformatie naar een Bouwboek zijn het primaire productbewijs. Blueprintblauw en bouwkundige annotaties worden alleen gebruikt voor technische context, zoals plattegronden, maten of faseovergangen.

### 3. Eén taakgerichte app-shell

Mobiel gebruikt in beginsel vijf vaste bestemmingen: Mijn projecten, Volgend, centrale Update-actie, Ontdekken en Profiel. Connecties en Notificaties blijven binnen één tap via profiel/header bereikbaar. Desktop gebruikt dezelfde informatielogica zonder afwijkende terminologie.

### 4. Project als samenhangende werkruimte

Een project bevat Overzicht, Tijdlijn, Foto's, Plattegrond, Budget, Bouwboek en Instellingen/Toegang. Owner-, viewer- en pendingrollen wijzigen beschikbare acties, niet de betekenis of volgorde van de navigatie.

### 5. Privacy is zichtbaar en omkeerbaar

Privé is de standaard. Publiceren, budget delen en toegang verlenen tonen vooraf wat een bezoeker ziet, benoemen het bereik en bieden een directe intrekactie. Adres en private notities verschijnen nooit in publieke previewstates.

### 6. Progressieve invoer

Een update kan met foto's beginnen. Geavanceerde velden volgen pas wanneer nodig. Draft, uploadstatus, retry, offlinefout, before/after, volgorde en floorplanpin zijn onderdelen van één herstelbare flow.

### 7. Canonical Bouwboekmodel

Editor, preview, thumbnails en PDF gebruiken hetzelfde `PhotobookDocument`. Crop, focus, tekstomloop, assets, fonts en pagina's zijn deterministisch. Alleen een expliciet goedgekeurde revisie kan naar checkout en fulfilment.

### 8. Gedeelde productieprimitives

Documenteer tokens voor kleur, type, spacing, radius, shadow en motion in `docs/DESIGN_SYSTEM.md`. Bouw gedeelde primitives voor app-shell, page header, media, privacy states, loading, empty, warning, error, success, destructive confirm en async progress. Beperk radius en pills tot functioneel passende gevallen.

### 9. Mobile-first zonder desktop te verdunnen

Ontwerp eerst op 390×844, valideer daarna 768×1024 en 1440×1000. Touch targets zijn minimaal 44×44px, dialogs respecteren toetsenbord en safe areas, content heeft geen horizontale overflow en desktop gebruikt extra ruimte voor context in plaats van alleen grotere marges.

### 10. Performance hoort bij het ontwerp

Gebruik thumbnails/displayderivatives in feeds, originelen uitsluitend voor print, stabiele aspect-ratio's, progressive loading en virtualisatie waar nodig. Geen full-resolution decode of printgeneratie op de interactieve mobiele hoofdthread.

## Acceptatiecriteria voor de nieuwe UI

- Consistente Nederlandse termen: Mijn projecten, Volgend, Ontdekken, Connecties, Project volgen, Toegang vragen en Bouwboek.
- Geen oude prototypeprovider- of travel-template-elementen in routes, copy, kaartfuncties of visuele overlays.
- 44×44px touch targets; geen hover-only kernactie.
- Volledige toetsenbordflow met zichtbare focus en logisch focusrestore.
- Toegankelijke before/after, drag/reorder, lightbox, floorplan en boeknavigatie.
- Geen ernstige axe-fouten; WCAG 2.2 AA als handmatige en geautomatiseerde acceptatiedoelstelling.
- Geen horizontale overflow op de drie baselineviewports.
- Lange Nederlandse titels, beschrijvingen en namen blijven bruikbaar zonder overlap of afkappen van essentiële informatie.
- Loading, empty, offline, permission denied, gedeeltelijke fout, retry en success zijn per kernflow ontworpen.
- Publieke pagina's halen de opgegeven Lighthouse- en CLS-doelen voordat productie wordt vrijgegeven.
- Printproof toont exact de goedgekeurde canonical revisie; geen betaling bij stale of onvolledige proof.

## Geplande visuele kwaliteitsronde 1 — structuur en kernflows

**Moment:** nadat app-shell, design tokens en de eerste verticale slice op de nieuwe API werken.

1. Maak screenshots van landing, auth, dashboard, projectoverzicht, tijdlijn, updatecomposer, gallery/lightbox, before/after, connecties, profiel, notificaties, floorplan, budget, Bouwboekcover/tekst/fotolayouts, checkout, orderstatus, account en meldflow.
2. Leg iedere flow vast op 390×844, 768×1024 en 1440×1000, plus owner/viewer/pending/private waar relevant.
3. Inspecteer hiërarchie, grid, witruimte, tekstlengte, fotocrop, tap targets, safe areas, keyboard overlays, focusvolgorde en responsive overgang.
4. Schrijf een korte kritiek per schermgroep met prioriteit P0/P1/P2.
5. Herstel minimaal alle P0/P1-problemen en maak dezelfde screenshots opnieuw.
6. Bewaar voor/na-artifacts in `artifacts/quality-round-1/`; neem ze niet op in de productbundle.

Exitcriteria: primaire taken zijn zonder verborgen controls uitvoerbaar; geen blocker op mobiel; terminologie en states zijn consistent; axe heeft geen ernstige bevindingen.

## Geplande visuele kwaliteitsronde 2 — productiegegevens en robuustheid

**Moment:** na volledige featurepariteit, canonical printproof en staging-providerintegraties.

1. Herhaal alle screenshots met realistische korte, lange en lege datasets, meerdere verdiepingen, grote projecten en minimaal één echte test-proof.
2. Voeg visuele browserregressie toe voor Chromium, WebKit en mobiele emulatie; test ook 200% zoom, reduced motion, toetsenbord en relevante screenreaderflows.
3. Inspecteer fotocrops, effectieve DPI-waarschuwingen, PDF-thumbnails, ordertotalen, privacy-preview, loading/failure/retry en gestopte providerflows.
4. Voer axe en Lighthouse uit; behandel ernstige accessibility-, CLS- en overflowproblemen als releaseblocker.
5. Voer een tweede geschreven designkritiek uit, herstel P0/P1 en maak de definitieve screenshots opnieuw.
6. Bewaar artifacts in `artifacts/quality-round-2/` en koppel de definitieve set aan de launch-readinesscontrole.

Exitcriteria: alle kernflows voldoen aan de acceptatiecriteria, de proof-preview is visueel gelijk aan de canonical output, publieke pagina's halen de prestatiedoelen en openstaande P0/P1-designbevindingen blokkeren productie.
