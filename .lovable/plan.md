## Buildy verbeterplan — feedbackronde

Op basis van je aantekeningen splitsen we het werk in **5 thema's**: voortgang, foto-overzicht, fotoboek-editor, bug-fixes rond fases & updates, en een nieuw plattegrond-scroll design. Branding (naam, ondertitel) parkeren we tot je de Google Drive-opties hebt gedeeld.

---

### 1. Voortgangspercentage — automatisch of handmatig

Logica per project:

- **Geen einddatum ingevuld** → handmatig instelbaar via een slider (0–100%) op de projectpagina, zichtbaar voor de eigenaar.
- **Einddatum ingevuld** → automatisch berekend op basis van tijd:
  `((vandaag − startdatum) / (einddatum − startdatum)) × 100`, geclampt op 0–100.
- Eigenaar kan altijd schakelen tussen "automatisch op tijd" en "handmatig" via een toggle naast de progressbar.

Technisch: kolom `progress_mode text default 'manual'` op `trips` (`'manual' | 'auto'`). `progress_percentage` blijft de bron-of-truth voor `manual`; bij `auto` rekent de frontend live uit op basis van datums.

---

### 2. Foto-overzicht per project

Nieuwe **"Alle foto's"-tab** naast Tijdlijn / Plattegrond op de projectpagina:

- Grid van álle uploads van het project (uit `step_media`, gesorteerd op datum desc).
- Klik opent lightbox met swipe + caption (titel van de stap + datum).
- "Spring naar update"-knop in lightbox.
- Filter-chip per fase bovenaan.

Daarnaast: huidige foto-thumbnails in stap-cards worden klikbaar → opent dezelfde lightbox.

---

### 3. Fotoboek los kunnen bewerken (Polarsteps-stijl)

Nu spiegelt het fotoboek 1-op-1 de tijdlijn. We voegen een **fotoboek-editlaag** toe zonder de tijdlijn te raken:

- Nieuwe tabel `photobook_settings` (per trip): `cover_title`, `cover_subtitle`, `chapter_overrides jsonb`.
- Nieuwe tabel `photobook_excluded_media` (trip_id, media_id) → foto's verbergen alleen uit het boek.
- Nieuwe tabel `photobook_excluded_steps` (trip_id, step_id) → updates uit boek laten.
- In `Photobook.tsx` een **"Bewerk fotoboek"-modus**:
  - Per foto een oog-icoontje (verberg in boek).
  - Per hoofdstuk: titel overschrijven.
  - Per update: hele update uit boek halen.
  - Cover apart bewerkbaar (titel + ondertitel + cover-foto kiezen uit alle uploads).
- Tijdlijn in de app blijft volledig intact.

---

### 4. Bugs & UX rond fases en updates

**4a. Dropdown-menu fase werkt niet bij "nieuwe update" (alleen via typen)**
- Oorzaak: Select binnen Dialog met z-index/portal-conflict. Fix: `SelectContent` expliciet met `position="popper"` en hogere `z-index` dan dialog (`z-[1100]`).

**4b. Fase-opties uitbreiden + custom toevoegen**
- Nieuwe defaultlijst: `Aankoop, Voorbereiding/Design, Sloop, Ruwbouw, Afbouw, Inrichting`.
- Onderaan het dropdown een "+ Eigen fase toevoegen" optie → inline tekstveld.
- Custom fases per project opslaan in `trips.custom_phases text[]`.
- In overzicht: elke fase krijgt een kleur-token (lichte tint van primary/accent) → zichtbaar als linker-balk op stap-cards en als chip-achtergrond.

**4c. Update bewerken — foto's toevoegen/verwijderen werkt niet**
- `EditStepDialog` uitbreiden met dezelfde upload-component als `AddStepDialog` + lijst van bestaande media met verwijder-knop (delete uit `step_media` + storage).

**4d. Fotoboek crasht/breekt bij veel foto's**
- Lazy loading per pagina + `react-window`-style virtualisatie of pagina-lazy-render (alleen huidige + buur-pagina renderen).
- Image-resize naar maxWidth 1600px in render (CSS), originelen blijven intact.

---

### 5. Nieuw design: plattegrond-bovenin met gekoppelde scroll

Geïnspireerd op de Polarsteps wereldkaart-interactie:

```text
┌─────────────────────────────────┐
│  [ PLATTEGROND – sticky top ]   │ ← 40% schermhoogte
│   • pin update 3 (highlight)    │
└─────────────────────────────────┘
│  Update 3 — Sloop keuken        │ ← in viewport
│  [foto's] [verhaal]             │
├─────────────────────────────────┤
│  Update 4 — Ruwbouw badkamer    │
└─────────────────────────────────┘
```

- Plattegrond plakt bovenaan tijdens scrollen (sticky / 40vh).
- IntersectionObserver op elke update-card → bijbehorende pin op de plattegrond licht op + plattegrond pant naar die pin.
- Andersom: klik op een pin scrollt naar de update.
- Werkt voor projecten **mét** plattegrond. Zonder plattegrond → fallback naar huidige BlueprintTimeline.
- Geen kaart-view nodig (één locatie), dus dit vervangt de map-tab.

---

### Technische samenvatting

**Nieuwe migraties:**
- `ALTER TABLE trips ADD COLUMN progress_mode text DEFAULT 'manual'`
- `ALTER TABLE trips ADD COLUMN custom_phases text[] DEFAULT '{}'`
- `CREATE TABLE photobook_settings (trip_id uuid PK, cover_title text, cover_subtitle text, cover_media_id uuid, chapter_overrides jsonb)` + RLS (eigenaar-only schrijven, leesbaar als trip leesbaar is)
- `CREATE TABLE photobook_excluded_media (trip_id uuid, media_id uuid, PK(trip_id, media_id))` + RLS
- `CREATE TABLE photobook_excluded_steps (trip_id uuid, step_id uuid, PK(trip_id, step_id))` + RLS

**Nieuwe componenten:**
- `ProgressControl.tsx` (auto/manual toggle + slider)
- `AllPhotosTab.tsx` + `MediaLightbox.tsx`
- `PhotobookEditorBar.tsx` + `PhotobookCoverEditor.tsx`
- `FloorplanScrollView.tsx` (sticky plattegrond + observer-koppeling)
- `PhaseSelect.tsx` (gedeelde component met custom-add + z-index fix)

**Te wijzigen:**
- `AddStepDialog.tsx`, `EditStepDialog.tsx` — nieuwe `PhaseSelect`, media-beheer in edit
- `TripDetail.tsx` — nieuwe tab "Alle foto's", FloorplanScrollView, ProgressControl
- `Photobook.tsx` — editor-modus, virtualisatie
- `index.css` / `tailwind.config.ts` — kleur-tokens per fase

**Geparkeerd tot je input:**
- Naam, ondertitel/slogan en blauwdruk-achtergrond design (wachten op je Google Drive-opties).
