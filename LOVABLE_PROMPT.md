# Lovable Prompt

Maak Buildy launch-ready. Buildy is de Polarsteps voor verbouwingen: gebruikers documenteren hun project stap voor stap en kunnen daar een fysiek Bouwboek van bestellen via Peecho.

Belangrijk: er is lokaal al veel gerepareerd. Behoud de huidige code en verfijn alleen waar nodig. Niet opnieuw herontwerpen vanaf nul.

Doel van deze Lovable-run:

1. Deploy de Supabase backend die nog ontbreekt.
2. Controleer de echte ingelogde owner-flow.
3. Maak de Peecho Bouwboek checkout end-to-end werkend.
4. Los alleen concrete regressies op die je tijdens het testen vindt.

Backend taken:

- Push de migration `supabase/migrations/20260601090000_photobook_orders.sql`.
- Deploy de Edge Function `supabase/functions/peecho-pingback`.
- Zet de Supabase secret `PEECHO_SECRET_KEY` server-side. Deze mag nooit client-side terechtkomen.
- Controleer dat `photobook_orders` live bestaat en dat RLS werkt voor project-eigenaren.
- Configureer in Peecho de status/pingback URL:
  `https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/peecho-pingback`
- Laat `PEECHO_MERCHANT_API_KEY` server-side. Die is niet nodig voor de Print Button checkout tenzij je later directe REST order creation toevoegt.

Client/env taken:

- `VITE_PEECHO_BUTTON_KEY` staat in `.env`. De app leidt daar de Peecho script-URL uit af.
- `VITE_PEECHO_SCRIPT_URL` is optioneel en mag leeg blijven als de button key werkt.
- Geen PDF downloadknop toevoegen. De gebruiker moet direct via Peecho bestellen.

Belangrijke bestaande fixes die behouden moeten blijven:

- Fotoboek is vast A4 liggend.
- Fotoboekfoto's worden in de inhoud met behoud van verhouding getoond (`contain`), zodat portretfoto's niet overlappen of lelijk gecropt worden.
- Peecho checkout mag niet blokkeren als ordertracking tijdelijk niet beschikbaar is; de PDF + Print Button moeten dan nog steeds werken.
- Desktop lightbox sluit door op het zwarte gebied rond de foto te klikken.
- Before/after slider: klikken op foto opent de viewer; schuiven kan via de slider-handle.
- Projectpagina: Fotoboek-knop staat prominent bovenin; dubbele Budget/Fotoboek knoppen boven de tijdlijn zijn weg.
- Publieke projecten tonen geen Delen-button voor bezoekers.
- Mijlpalen-filter blijft zichtbaar en bruikbaar.
- Edit-step media grid heeft geen overlap tussen prullenbak en Voor/Na controls.

Te testen in Lovable:

- Login met een eigenaar-account.
- Open een eigen project.
- Voeg een update toe met meerdere foto's, inclusief portretfoto's.
- Markeer 1 foto als Voor en 1 als Na.
- Controleer mobiel en desktop dat de Voor/Na controls niet overlappen.
- Klik op de before/after foto: de lightbox opent.
- Sleep alleen via de slider-handle: de vergelijking schuift.
- Open het fotoboek.
- Blader door meerdere spreads op desktop en mobiel.
- Controleer dat 4 foto's op een pagina niet overlappen.
- Controleer dat tekst niet over de progressiebalk valt.
- Klik `Bestel als boek`.
- Genereer de PDF.
- Controleer dat de PDF publiek bereikbaar is voor Peecho.
- Controleer dat de Peecho Print Button verschijnt.
- Open de Peecho checkout.
- Controleer dat er een rij in `photobook_orders` komt zodra de live migration staat.
- Test de Peecho pingback/status update met een echte of test order.

Checks die groen moeten blijven:

- `bunx tsc --noEmit`
- `bun run lint -- --max-warnings=0`
- `bun test`
- `bun run build`
- `bunx playwright test`

Als iets faalt, fix gericht en klein. Geen grote visuele herbouw tenzij een test of echte user-flow dat noodzakelijk maakt.
