

## Buildy — Van TripLog naar Verbouwingslogboek

We pivoteren TripLog naar **Buildy**: een logboek waarin mensen hun verbouwing stap-voor-stap vastleggen met foto's, verhalen en een visuele tijdlijn op een blauwdruk-stijl achtergrond. Aan het einde drukken ze een fotoboek af als herinnering.

---

### 1. Rebrand: TripLog → Buildy

- Nieuwe naam, logo en tagline ("Verbeter je huis, stap voor stap") in `Header.tsx`, `Auth.tsx`, `index.html`
- Nieuw kleurenpalet geïnspireerd op de blauwdruk-screenshot:
  - **Primary**: Diep blauwdruk-blauw (`hsl(215 65% 20%)`)
  - **Accent**: Warm oranje voor voortgang/CTA's (`hsl(22 90% 55%)`)
  - **Background**: Lichte blauwdruk-tint met subtiel grid-patroon (SVG)
- Typografie behouden: DM Sans + Playfair Display

### 2. Datamodel-aanpassingen (terminologie + nieuwe features)

We hergebruiken de bestaande tabellen maar geven ze een verbouwings-context. Geen breuk met bestaande data — alleen kolommen toevoegen en termen herlabelen in de UI.

**Migraties:**
- `trips` → in UI "Projecten" (verbouwingen). Nieuwe kolommen:
  - `project_type` (text, bv. "Volledige renovatie", "Keuken", "Badkamer")
  - `progress_percentage` (int, 0-100)
  - `address` (text, optioneel)
- `steps` → in UI "Stappen" / "Mijlpalen". Nieuwe kolommen:
  - `phase` (text, bv. "Sloop", "Ruwbouw", "Afwerking")
  - `is_milestone` (boolean) — voor de grote nodes op de blauwdruk
- Nieuwe tabel: **`favorites`** (user_id, project_id, created_at) — voor het volgen/favorieten markeren van projecten van anderen, met RLS

### 3. Blauwdruk-tijdlijn (kernscherm)

Nieuwe component `BlueprintTimeline.tsx` ter vervanging van de huidige `StepTimeline` op de projectpagina:

```text
   ┌─ START VERBOUWING ──┐
   │  [icoon] Apr 5      │
   └──────────┬──────────┘
              │ (oranje connector-lijn)
   ┌──────────┴──────────┐
   │ [foto] [foto] [foto]│  ← stap-cards met foto-grid
   │ SLOPEN BEGANE GROND │
   └──────────┬──────────┘
              ●  ← mijlpaal-bolletje
              │
   ┌──────────┴──────────┐
   │ Stop 4: BADKAMER... │
   └─────────────────────┘
```

- Achtergrond: SVG blauwdruk-grid (lijnen + maatvoering-tekst als decoratie)
- Connectoren tussen stappen in oranje
- Mijlpalen krijgen ronde icoon-badges (huis, hamer, kraan, verf-roller via lucide-react)
- Voortgangsbalk bovenaan project ("45% Complete")

### 4. Bestaande features herlabelen

- "Trip" → "Project" / "Verbouwing"
- "Step" → "Stap" / "Update"
- "Travel hours" → vervangen door "Fase" (sloop/ruwbouw/afwerking) en datum
- Kaart-pagina (`TripMap`) wordt **optioneel verborgen**: voor één locatie (één huis) niet nuttig. We tonen alleen het adres + kleine statische map op de project-header. Kunnen we later eventueel weer aanzetten.

### 5. Nieuwe feature: Volgen & Favorieten

- "Volg dit project" knop op publieke project-pagina's (hartje-icoon)
- Nieuwe pagina `/favorieten` — overzicht van projecten die je volgt
- Tab op de homepage: "Ontdekken" (publieke projecten) vs "Mijn projecten" vs "Gevolgd"
- Notificatie-badge op header bij nieuwe stappen in gevolgde projecten (telling, geen realtime push voor nu)

### 6. Fotoboek aanpassen aan verbouwings-context

- Cover: projectnaam + adres + start/eind-datum + "Voor → Na" framing
- Hoofdstukken per **fase** (Sloop, Ruwbouw, Afwerking) i.p.v. losse dagen
- "Voor & Na"-spread als laatste pagina (als gebruiker beide foto's heeft)
- Stijl: cleane, magazine-achtige layout — past al goed bij huidige `Photobook.tsx`, alleen koppen en hoofdstuk-indeling herschrijven

### 7. UX-verbeteringen meegenomen

- Snelkoppeling "Foto toevoegen" knop direct op project-detail (bulk-upload met later splitsen in stappen)
- Project-card op homepage toont: cover, voortgangsbalk, aantal stappen, aantal volgers
- Lege staat bij nieuw project: "Voeg je eerste 'voor'-foto toe"

---

### Technische details

**Bestanden om te maken:**
- `src/components/BlueprintTimeline.tsx` — nieuwe tijdlijn met blauwdruk-achtergrond
- `src/components/BlueprintBackground.tsx` — herbruikbare SVG grid (memoized)
- `src/components/ProgressBar.tsx` — oranje voortgangsbalk
- `src/components/FollowButton.tsx` — favoriet/volg-toggle
- `src/pages/Discover.tsx` — publieke projecten ontdekken
- `src/pages/Favorites.tsx` — gevolgde projecten

**Bestanden om te wijzigen:**
- `index.html` — title naar "Buildy"
- `src/index.css` — nieuw blauw/oranje palet
- `tailwind.config.ts` — kleuren-tokens
- `src/components/Header.tsx` — Buildy-branding + nav (Ontdekken, Mijn projecten, Gevolgd)
- `src/pages/Index.tsx` — drie tabs, projectkaarten met voortgang
- `src/pages/TripDetail.tsx` → hernoemen mentaal naar "ProjectDetail", BlueprintTimeline gebruiken
- `src/pages/NewTrip.tsx` — formulier-velden (projecttype, adres)
- `src/components/AddStepDialog.tsx` / `EditStepDialog.tsx` — fase-selector i.p.v. travel hours
- `src/pages/Photobook.tsx` — hoofdstuk-indeling per fase
- `src/App.tsx` — nieuwe routes

**Database-migratie:**
- `ALTER TABLE trips ADD COLUMN project_type text, progress_percentage int DEFAULT 0, address text`
- `ALTER TABLE steps ADD COLUMN phase text, is_milestone boolean DEFAULT false`
- `CREATE TABLE favorites` met RLS (eigen favorieten lezen/schrijven, andermans niet zichtbaar)

**Behouden zoals het is:**
- Auth-flow, profiles, step_media, likes, comments — allemaal intact
- Storage bucket `trip-media` (interne naam mag, in UI tonen we niets)
- Bestaande projecten van gebruikers blijven werken (nieuwe kolommen krijgen defaults)

