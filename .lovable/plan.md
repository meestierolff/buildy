## Doel
De Bouwboek-feature naar een hoger niveau tillen op drie assen: visueel ontwerp van het boek zelf, gebruiksgemak van de editor, en de bestel-/exportflow via Peecho.

## Scope

### 1. Visueel ontwerp van het boek
- **Cover-redesign**: Naast de bestaande full-bleed variant twee extra cover-stijlen toevoegen (Polaroid-frame met crèmewitte rand en serif label; Tape-binding met dubbele kolom titel + datum als architecten-labelstrook). Keuze via dropdown in cover-editor.
- **Hoofdstuk-tussenpagina's**: Krijgen een rustige fase-pagina met groot fase-nummer (01, 02, ...), fase-naam in Playfair Display, korte periode-aanduiding en een dun "blueprint" lijnornament. Vervangt de huidige tekstkop-pagina.
- **Foto-paginas**: 
  - Witte marges harmoniseren (zelfde inset rondom alle layouts, nu inconsistent tussen 1-full en grid).
  - Caption/locatie subtieler: kleine letterspacing-label onderaan in plaats van blokje bovenaan.
  - "3-mixed" en "grid"-layouts krijgen een lichte cream-kaderlijn voor het bouwtekening-gevoel.
- **Achterkant-pagina**: Nieuwe automatische slot-pagina met projectsamenvatting (totaal aantal updates, looptijd, mijlpalen) en kleine Buildy-credit.

### 2. Editor UX
- **Linker zijbalk met pagina-overzicht** (collapsible): verticale lijst met thumbnail + paginanummer + stap-naam, klikken = springen. Vervangt het kale prev/next-gevoel. Highlight de actieve pagina.
- **Inline cover-editor**: Klik op de cover-pagina in edit-mode opent een floating panel rechts met title / subtitle / cover-foto picker / tekstpositie / cover-stijl. Geen aparte modal nodig.
- **Per-pagina actiebalk**: Bovenaan de huidige pagina (alleen in edit-mode) een compacte balk met: layout-keuze (huidige knoppen), "hoofdstuk hernoemen", "stap verbergen", drag-handle uitleg. Nu liggen die controls verspreid.
- **Drag & drop verbeteren**: Visuele dropzone-indicator (gestreepte rand) tijdens het slepen, en een "reset volgorde" knop per stap.
- **Overzichtsmodus (grid)**: De bestaande overview tonen als 4-koloms grid met paginanummers en stap-labels onder elke thumbnail; klik = direct naar die pagina + edit-mode. Multi-select voor "stap verbergen".
- **Auto-save indicator**: Klein "Opgeslagen ✓" / "Opslaan..." labeltje rechtsboven zodat de gebruiker weet dat wijzigingen bewaard zijn (upsertSettings is al async, maar geeft nu geen feedback bij succes).

### 3. Bestel- & exportflow
- **Pre-order samenvatting modal**: Vóór het Peecho-checkout-redirect een duidelijk overzicht: aantal paginas, formaat, geschatte prijs (uit Peecho config), thumbnail van cover + 4 random binnenpagina's. Bevestigingsknop "Naar betaling →".
- **Formaat-keuze terugbrengen**: Naast A4 landscape ook A4 portrait en vierkant 21x21 aanbieden (Peecho ondersteunt dit al via `PEECHO_FORMATS`). Visuele kaartjes met preview van het formaat.
- **Voortgangsstappen tijdens generatie**: Vervang de losse spinner door 3 stappen ("PDF opbouwen → Uploaden → Checkout openen") met statusvinkjes. Voorkomt het gevoel dat er niets gebeurt bij grote boeken.
- **Order-historie verbeteren**: De huidige lijst krijgt status-badges (kleur per status), klikbare tracking-link prominent, en een "PDF opnieuw bekijken"-link per order.
- **Min-paginas waarschuwing**: Als `pages.length < PEECHO_MIN_PAGES` toon dan een duidelijk geel infoblok met "Voeg minstens X updates toe om te kunnen bestellen" in plaats van een onhandige error bij klikken.

## Buiten scope
- Geen wijzigingen aan database-schema of Peecho edge-functions.
- Geen verandering aan de PDF-generatie-engine zelf (jsPDF), alleen aan wat er op de paginas terechtkomt.
- Geen nieuwe paginatypen (bv. video-pagina) — dat is een aparte feature.

## Technische details
- Pagina-state blijft `pageIdx` (flat index) — paginaoverzicht-zijbalk leest uit `pages` array.
- Cover-stijlen via nieuw veld `settings.chapter_overrides["__cover_style__"]` om geen migratie nodig te hebben.
- Auto-save indicator via lokale state `saveState: 'idle' | 'saving' | 'saved'` in `upsertSettings`.
- Pre-order modal hergebruikt bestaande `Dialog` component.
- Formaat-keuze: state `printFormat` wordt setter-bare i.p.v. const.

## Volgorde
1. Editor UX (sidebar, inline cover-editor, auto-save) — grootste dagelijkse impact.
2. Bestel-/exportflow (pre-order modal, formaat-keuze, voortgang).
3. Visueel ontwerp (covers, hoofdstuk-tussenpagina's, achterkant).
