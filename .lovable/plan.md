## Doel
Alle binnenpagina's krijgen dezelfde visuele taal als de landing page: Instrument Serif italic koppen, Inter body, near-black/cream achtergrond, terracotta accent, eyebrow-labels (`text-[11px] font-bold uppercase tracking-[0.2em]`), dunne 1px borders, ronde pill-buttons, `aspect-[4/5]` cards met 0.5px accent voortgangsstreepje.

## Design-systeem (al aanwezig in `index.css`)
- Tokens: `background`, `foreground`, `accent` (terracotta), `muted`, `border` — geen hardcoded kleuren toevoegen.
- Koppen: `font-serif italic` met grote schaal (5xl–8xl voor hero, 2xl–3xl voor sectie-titels).
- Eyebrows: bestaande `.eyebrow` utility of `text-[11px] font-bold uppercase tracking-[0.2em]`.
- Buttons: `rounded-full px-5/8 text-[11px] font-bold uppercase tracking-widest`.
- Sectie-headers: eyebrow + flex-1 h-px bg-border lijn.

## Pagina-voor-pagina

### 1. `src/pages/TripDetail.tsx`
- Hero: groot serif-italic project-titel, eyebrow met fase + datum, dunne metadata-rij (locatie · stappen · volgers).
- Tabs (Tijdlijn / Plattegrond / Foto's / Budget): eyebrow-style met onderstreepte actieve tab (zoals Index "Ontdekken/Mijn projecten").
- Knoppen-rij in pill-style.

### 2. `src/pages/Photobook.tsx`
- Sticky header in landing-stijl (witte achtergrond, dunne border-b, serif titel + eyebrow "Fotoboek").
- Format-dialogen: serif h2, body in Inter, pill-buttons.
- Behoud bestaande paginering/layout-overrides functionaliteit.

### 3. `src/pages/Profile.tsx`
- Profiel-hero: cirkel-avatar groot, serif italic naam, eyebrow met locatie, dunne stats-rij (projecten · volgers · volgend).
- Project-grid identiek aan Index-cards.

### 4. `src/pages/Friends.tsx`
- Tabs (Volgers / Volgend / Ontdekken) in eyebrow-style.
- Lijst-rijen met dunne border-b, avatar, naam in serif, FollowButton pill rechts.

### 5. `src/pages/Budget.tsx`
- Eyebrow "Budget" + serif totaal-bedrag, dunne uitsplitsing per fase, geen kleurrijke kaarten.

### 6. `src/pages/Auth.tsx`
- Gecentreerd, serif italic "Welkom bij Buildy", Inter body-tekst, pill submit-knop.

### 7. `src/pages/Favorites.tsx` & `src/pages/NewTrip.tsx`
- Eyebrow + serif page-titel, identieke card-grid / form-styling.

### 8. Gedeelde componenten
- `EmptyState`: serif kop, eyebrow sub.
- `ProjectStats`, `ProgressBar`, `NotificationBell`, `OnboardingDialog`: alleen kleuren/typografie afstemmen, geen functionele wijzigingen.
- Dialogen (AddStep/EditStep/CoverPicker/ProjectSettingsSheet): serif titels, pill-actions.

## Wat NIET wijzigt
- Backend, RLS, routes, props/contracts.
- Functionaliteit van Photobook layout-engine, Floorplan-view, Map, Before/After slider.
- Geen nieuwe libraries.

## Aanpak
Eén ronde gerichte edits per pagina, semantic tokens overal, geen hardcoded `text-white`/`bg-black` etc. Visueel valideren in preview na elke 2–3 pagina's.
