# Buildy design system

**Versie:** foundation 0.1

**Datum:** 4 augustus 2026

**Status:** nieuwe primitives beschikbaar; bestaande pagina's zijn nog niet gemigreerd

## 1. Richting

Buildy combineert drie werelden:

1. een praktisch architectenveldboek waarin je snel iets vastlegt;
2. een persoonlijk renovatiedagboek waarin foto's en voortgang centraal staan;
3. een tactiel fotoalbum dat geloofwaardig doorloopt naar een fysiek Bouwboek.

Het systeem is rustig, volwassen en foto-gedreven. Merkdetails ondersteunen de inhoud; ze concurreren er niet mee. De publieke kernbelofte is **“Van eerste sleutel tot laatste plint.”** De ondersteunende propositie is: **“Leg je verbouwing stap voor stap vast, laat vrienden en familie meekijken en maak er later een Bouwboek van.”**

### Wel doen

- warme krijt-/papieroppervlakken;
- grafiet en diep houtskool voor tekst;
- één oxide-/baksteenaccent voor primaire voortgang en acties;
- blueprintblauw uitsluitend voor technische informatie;
- heldere randen, paginamarges en bouwkundige annotaties;
- scherpe editorial composities met echte gebruikersfoto's;
- functionele witruimte en compacte, leesbare appstates.

### Niet doen

- geen generieke shadcn-card-grid als hoofdcompositie;
- geen grote verzameling pillknoppen;
- geen cursieve serif op functionele appkoppen;
- geen blueprint-grid als permanente achtergrond;
- geen hover-only kernacties;
- geen emoji als primaire iconografie;
- geen decoratieve gradients, glassmorphism of AI-illustraties;
- geen reis-/Polarsteps-copy in het publieke product.

## 2. Merk

### Teken

Het Buildy-teken combineert:

- het dak en de wanden van een huis;
- de twee pagina's van een open boek;
- een stijgende oxidekleurige voortgangslijn.

Het teken blijft herkenbaar zonder woordmerk en is ontworpen voor 16, 24, 40 en 48px. Gebruik het niet kleiner dan 16px. Rond het teken moet minimaal een kwart van de tekenbreedte vrije ruimte blijven.

### Assets

| Asset | Gebruik |
|---|---|
| `public/brand-mark.svg` | Compact merkteken voor web, documentatie en kleine plaatsingen |
| `public/logo-wordmark.svg` | Horizontaal merkteken met woordmerk |
| `public/app-icon.svg` | Bron voor PWA-/platformiconen; altijd met ondoorzichtige papierbasis |
| `public/social-preview.svg` | Generieke veilige social fallback, zonder usercontent |
| `BrandLogo` | Thema-bewuste Reactvariant voor de app-shell |

`BrandLogo` behoudt de bestaande props `className`, `imageClassName`, `textClassName` en `href`. Nieuwe varianten:

```tsx
<BrandLogo />
<BrandLogo variant="compact" ariaLabel="Naar Buildy" />
<BrandLogo href={null} />
```

De compacte link houdt een toegankelijke naam, ook wanneer het zichtbare woordmerk ontbreekt. Het woordmerk gebruikt een stevige sans; de editorial serif blijft gereserveerd voor contentmomenten.

### Bouwboekgebruik

Gebruik het logo terughoudend: klein op titel-/achterpagina en niet als watermerk over foto's. Een bestelling moet als persoonlijk boek voelen, niet als Buildy-brochure.

## 3. Kleur

De bestaande semantische CSS-variabelen blijven de bron. Componenten gebruiken Tailwindnamen en geen losse hexwaarden.

| Rol | Tailwindtoken | Betekenis |
|---|---|---|
| Papier | `background` | Hoofdcanvas |
| Grafiet | `foreground` | Primaire tekst en hoofdacties |
| Blad/kaart | `card` | Verhoogd of afgebakend oppervlak |
| Kalksteen | `secondary` | Rustige secundaire actie of vlak |
| Stil oppervlak | `muted` | Skeleton, placeholder, subtiele groepering |
| Secundaire tekst | `muted-foreground` | Ondersteunende informatie; contrast blijven testen |
| Oxide/baksteen | `accent` | Primaire voortgang, focus op merkactie, geselecteerd technisch detail |
| Fout | `destructive` | Destructieve actie en foutstatus |
| Lijn | `border` | Structuur, geen decoratieve doos om ieder element |
| Focus | `ring` | Zichtbare toetsenbordfocus |
| Blueprint | bestaande blueprintvariabelen | Alleen plattegrond/maten/technische context |

Regels:

- Status is nooit alleen kleur: combineer tekst, icoon en waar nodig vorm.
- Oxide is schaars; gebruik het niet voor alle links, badges en decoratie tegelijk.
- Private/public gebruikt betekenisvolle iconen en labels via `PrivacyBadge`.
- Controleer tekstcontrast op de werkelijke samengestelde achtergrond, ook in dark mode.

## 4. Typografie

### Families

- **Inter Variable:** alle navigatie, formulieren, knoppen, tabellen, metadata, appkoppen en statuscopy.
- **Instrument Serif:** marketingmomenten, projectcovers, Bouwboekcovers en hoofdstukopeningen.

Beide fonts worden lokaal geladen. Er zijn geen externe fontrequests.

### Hiërarchie

| Rol | Richtlijn |
|---|---|
| Display marketing | Serif, 48–72px desktop / 40–48px mobiel, korte regels |
| Apppaginatitel | Sans semibold, 30–40px, compacte tracking |
| Projectcover | Serif, afhankelijk van fotografie en contrast |
| Sectiekop | Sans semibold, 20–24px |
| Componentkop | Sans semibold, 16–18px |
| Body | Sans, 16px, regelhoogte 1.5–1.65 |
| Secundair | Sans, 14px, regelhoogte minimaal 1.5 |
| Eyebrow | Sans semibold, minimaal 12px; tracking terughoudend |

De bestaande globale serif-headingregel is legacy. Nieuwe primitives, waaronder `PageHeader` en `AsyncState`, zetten daarom expliciet `font-sans`. Wijzig `index.css` pas wanneer de legacy-pagina's gecontroleerd zijn gemigreerd.

Nederlandse diacritische tekens, lange samengestelde woorden en namen met spaties worden altijd in visuele tests meegenomen. Essentiële tekst mag niet uitsluitend door truncation beschikbaar zijn.

## 5. Ruimte, grid en vorm

### Basiseenheid

Gebruik een 4px-basiseenheid. Voorkeursstappen: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 en 80px. Kies ruimte op basis van relatie:

- 4–8px: icoon bij label of zeer hechte metadata;
- 12–16px: elementen binnen een control/component;
- 20–32px: componentgroepen;
- 40–64px: secties en paginaovergangen.

### Pagina

- Mobiel: minimaal 16px horizontale paginamarge.
- Tablet: 24px.
- Desktop: 32px, met een inhoudsmaximum van `max-w-7xl`.
- Leestekst: beperk tot circa 65–75 tekens per regel.
- Foto's mogen full-bleed zijn wanneer de interactie en safe area dat ondersteunen.

### Radius

Gebruik de bestaande semantische radius:

- `rounded-sm`: kleine technische vlakken;
- `rounded-md`: controls en gewone oppervlakken;
- `rounded-lg`: grote staat/paneel wanneer afbakening nodig is;
- `rounded-full`: avatar, statusbadge of centrale mobiele actie — niet als standaardknopvorm.

### Schaduw

Schaduw communiceert laag of bediening, niet versiering. Eén subtiele schaduw voor sticky navigatie en een iets duidelijkere schaduw voor dialogs/overlays volstaat. Combineer geen zware shadow, border en achtergrondcontrast zonder functionele reden.

## 6. Motion

- Functionele transitions duren normaal 120–200ms.
- Gebruik opacity/transform alleen wanneer het ruimtelijke verandering verduidelijkt.
- Upload- en progressmotion mag nooit de enige statusindicator zijn.
- Onder `prefers-reduced-motion: reduce` verdwijnen niet-essentiële animaties en verkorten transitions praktisch tot nul.
- Geen page curl of andere gimmick in het Bouwboek wanneer dit bladeren vertraagt.

Nieuwe componenten gebruiken `motion-reduce:*`; de bestaande globale reduced-motionregel blijft de veiligheidslaag.

## 7. Responsieve app-shell

### Informatiearchitectuur

De ingelogde primaire mobiele navigatie bestaat uit precies vijf taken:

1. Mijn projecten;
2. Volgend;
3. Update — centrale primaire actie;
4. Ontdekken;
5. Profiel.

Connecties, Notificaties, Account/privacy en Feedback blijven binnen één extra tap bereikbaar. Desktop behoudt dezelfde terminologie en prioriteit.

`src/lib/productNavigation.ts` is de centrale route-/labelbron. Pagina's definiëren geen alternatieve labels zoals Vrienden, Favorieten of Fotoboek.

### `AppShell`

`AppShell` levert:

- skiplink naar de hoofdinhoud;
- optionele sticky header met top-safe-area;
- focusbare mainbestemming;
- ruimte voor fixed mobiele navigatie en bottom-safe-area;
- optionele footer zonder overlap met de mobile nav.

```tsx
<AppShell
  header={<TopBar />}
  mobileNavigation={<MobileNav profileHref={`/profiel/${userId}`} />}
  footer={<AppFooter />}
>
  <Page />
</AppShell>
```

De shell neemt geen authbesluit. De route-/authlaag bepaalt welke navigatie en acties zichtbaar zijn.

### `MobileNav`

- targets zijn minimaal 44×44px; de standaardrij is 68px hoog;
- de centrale Update-actie heeft zowel icoon als zichtbaar label;
- actieve status gebruikt positie/indicator én kleur;
- bottom safe area wordt altijd meegenomen;
- alleen mobiel zichtbaar; desktop krijgt een passende navigatie met dezelfde brondata;
- `profileHref` en `updateHref` kunnen per sessie/context worden overschreven.

## 8. Gedeelde primitives

Alle foundationcomponenten staan in `src/components/app/` en zijn ook via `src/components/app/index.ts` beschikbaar.

### `PageHeader`

Gebruik voor paginatitel, uitleg, metadata, visibility en acties. Standaard is de titel sans. Alleen een expliciet redactioneel moment gebruikt `editorial`.

```tsx
<PageHeader
  eyebrow="Mijn projecten"
  title="Keizersgracht 42"
  description="Bekijk de laatste voortgang en voeg een update toe."
  badge={<PrivacyBadge level="private" />}
  actions={<Button>Update toevoegen</Button>}
/>
```

Acties krijgen in de header minimaal 44px hoogte. Een backlink heeft een concreet label, bijvoorbeeld “Terug naar mijn projecten”, niet alleen “Terug”.

### `AsyncState`

Ondersteunt `loading`, `empty`, `error` en `success`:

- loading gebruikt geometrisch stabiele skeletonregels en een screenreaderlabel;
- empty benoemt wat ontbreekt en biedt hoogstens één primaire vervolgstap;
- error gebruikt `role="alert"`, concrete herstelcopy en waar mogelijk retry;
- success rendert de aangeleverde children of een bevestigingsstate.

```tsx
<AsyncState
  status="error"
  title="Projecten konden niet worden geladen"
  description="Controleer je verbinding en probeer het opnieuw."
  action={<Button onClick={retry}>Opnieuw proberen</Button>}
/>
```

Gebruik geen technische foutcodes als primaire gebruikerscopy. Log een correlatie-ID apart wanneer support die nodig heeft.

### `PrivacyBadge`

Beschikbare niveaus:

| Niveau | Nederlands label | Gebruik |
|---|---|---|
| `private` | Privé | Alleen eigenaar en expliciet toegelaten personen |
| `public` | Openbaar | Publiek deelbaar/indexeerbaar volgens beleid |
| `shared` | Gedeeld | Beperkte expliciete toegang |
| `pending` | Verzoek in behandeling | Nog geen toegang |

De compacte variant toont visueel alleen het icoon, maar behoudt de volledige screenreadertekst. Gebruik nooit alleen een los slot- of wereldbolicoon voor een privacywijziging.

### `SkipLink`

Standaardtekst: “Ga naar de hoofdinhoud”. De link wordt zichtbaar bij toetsenbordfocus en staat vóór de sticky header in de focusvolgorde.

## 9. Controls en interactie

- Iedere interactieve target heeft effectief minimaal 44×44px.
- Focus is zichtbaar met `ring`, ook boven foto's en donkere oppervlakken.
- Kernacties bestaan niet uitsluitend op hover.
- Destructieve acties gebruiken een expliciete bevestiging, concrete objectnaam en gevolgen.
- Optimistische updates vereisen rollback en toegankelijke foutfeedback.
- Disabled controls leggen waar nodig uit waarom een actie niet beschikbaar is.
- Gebruik native semantiek vóór ARIA; voeg ARIA toe om status of relatie te verduidelijken.

### Drag/reorder

Iedere dragflow heeft tevens knoppen “Naar voren”, “Naar achteren”, “Omhoog” of “Omlaag”. Kondig het nieuwe positienummer aan via `aria-live`. Touch scrolling mag niet onnodig met `touch-none` worden geblokkeerd.

### Voor/na

De divider is een echte slider met naam, `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, pijltjestoetsen, Home/End en een minimaal 44px bedieningsgebied.

### Dialogs en composers

- focus start op de eerste logische control en keert terug naar de trigger;
- achtergrond wordt inert;
- Escape vraagt bevestiging wanneer een draft dirty is;
- viewport en footer respecteren softwaretoetsenbord en safe areas;
- uploadstatus en retry blijven zichtbaar zonder de invoer te wissen.

## 10. Privacycopy en terminologie

Gebruik consequent:

| Concept | Copy |
|---|---|
| Openbare gebruiker volgen | Volgen |
| Privéprofiel benaderen | Verzoek sturen |
| Activiteitenfeed | Volgend |
| Mensen en verzoeken | Connecties |
| Eén project volgen | Project volgen |
| Privéproject openen | Toegang vragen |
| Fysiek fotoboek | Bouwboek |
| Tijdlijnitem | Update |
| Verbouwing | Project |

Privacyverandering benoemt bereik en gevolg vóór bevestiging. Voorbeeld: “Dit project wordt zichtbaar voor iedereen met de link en kan door zoekmachines worden opgenomen.” Toon daarnaast een visitor preview. Adres, budget en uitvoerdersnotities worden nooit impliciet meegedeeld door een project openbaar te maken.

## 11. Media en Bouwboek

- Feed: thumbnail/displayderivative met stabiele verhouding en dimensions.
- Lightbox: display/original volgens behoefte; zoom, swipe, toetsen en focusmanagement.
- Print: uitsluitend high-resolution origineel via de canonical Bouwboekrenderer.
- Video: poster, controls waar relevant en geen automatische grote download in een projectkaart.
- PDF: expliciet documenticoon, bestandsnaam en download/openhandeling; nooit als afbeelding behandelen.
- Altstrategie: functionele beelden krijgen contextuele Nederlandse alttekst; decoratieve duplicaten krijgen lege alttekst.

Crop en focus zijn domeindata, geen lokale UI-state. Preview, PDF en fulfilment gebruiken exact dezelfde canonical revisie.

## 12. States en content

Iedere kernflow ontwerpt minimaal:

- loading;
- empty;
- success;
- validation error;
- server error met retry;
- offline;
- permission denied/not found zonder privacyenumeratie;
- gedeeltelijke providerstoring;
- stale/conflict;
- destructive pending/completed/manual review.

Copy is kort, specifiek en handelbaar. Zeg wat niet lukte, wat bewaard bleef en wat de gebruiker kan doen. Voorbeeld: “De foto's zijn bewaard, maar de update kon nog niet worden gepubliceerd. Probeer opnieuw.”

## 13. Accessibility- en kwaliteitsgate

WCAG 2.2 AA is het doel. Voor een component of flow “done” is:

- volledig toetsenbordgebruik mogelijk;
- screenreadernaam, rol en state kloppen;
- focusvolgorde en focusrestore zijn getest;
- status is niet alleen kleur of motion;
- tekst en non-textcontrast zijn gecontroleerd;
- 200% zoom en lange Nederlandse copy veroorzaken geen verlies;
- 390×844, 768×1024 en 1440×1000 hebben geen horizontale overflow;
- `prefers-reduced-motion` werkt;
- axe heeft geen ernstige bevindingen;
- relevante visuele regressies zijn beoordeeld.

De twee verplichte visuele kwaliteitsrondes en artifacts staan uitgewerkt in `docs/DESIGN_AUDIT.md`.

## 14. Migratieregel

Nieuwe pagina's gebruiken deze primitives en navigatiebron. Legacy-pagina's worden per verticale flow gemigreerd; maak geen tweede tijdelijke set tokens of routebenamingen. Verwijder oude varianten pas nadat visuele, functionele en accessibilitytests voor de vervangende flow groen zijn.
