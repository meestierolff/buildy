

## TripLog — Jouw Polarsteps Clone

Een reisjournal-app waar gebruikers hun reizen vastleggen met foto's, tekst en locaties, en hun route op een interactieve kaart zien.

---

### 1. Authenticatie & Profielen
- Account aanmaken, inloggen en uitloggen via e-mail
- Gebruikersprofiel met naam en profielfoto
- Publiek profiel met overzicht van alle trips

### 2. Trip Aanmaken & Beheren
- Nieuwe trip starten met titel, landen/vlaggen en datumbereik
- Trip overzicht: aantal dagen, stappen en afgelegde afstand
- Trip bewerken en verwijderen

### 3. Stappen (Steps) per Dag
- Per dag een "stap" toevoegen met:
  - **Locatie** (stad/land, met coördinaten)
  - **Foto's en video's** (meerdere per stap)
  - **Geschreven tekst/verhaal**
  - **Datum en weersinfo**
- Tijdlijn-weergave aan de linkerkant, exact zoals Polarsteps (verticale lijn met stops)
- "Traveled for X hours" indicator tussen stappen

### 4. Interactieve Kaart (Leaflet/OpenStreetMap)
- Route weergave aan de rechterkant van het scherm
- Markers voor elke stap/locatie
- Verbindingslijnen tussen stappen die de route tonen
- Trip statistieken overlay (dagen, stappen, kilometers)
- Klikbaar: klik op een marker → scroll naar die stap

### 5. Publiek Delen & Sociaal
- Elke trip krijgt een unieke deelbare link
- Bezoekers kunnen trips bekijken zonder account
- Like-functie op stappen
- Comments op stappen
- "X and Y others like this step" weergave

### 6. Fotoboek Preview
- "Gift a Travel Book" knop bij elke trip
- Automatische layout van alle foto's en teksten in fotoboek-stijl
- Bladerbare preview in de browser
- Voorlopig alleen preview, drukservice kan later worden toegevoegd

### 7. Design & Layout
- **Header**: logo, navigatie, login/profiel
- **Trip pagina**: split-view met tijdlijn links en kaart rechts (zoals de screenshot)
- Donkere kaart-achtergrond met lichte content-cards
- Vlaggen van bezochte landen bij trip-titel
- Responsive design voor mobiel

### 8. Backend (Lovable Cloud / Supabase)
- Database voor gebruikers, trips, stappen, foto's, likes en comments
- Opslag voor foto's en video's via Supabase Storage
- RLS policies zodat gebruikers alleen hun eigen trips kunnen bewerken maar publieke trips zichtbaar zijn voor iedereen

