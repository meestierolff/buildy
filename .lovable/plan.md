## Doel
Buildy klaarmaken om publiek live te gaan met een werkende, betaalde Bouwboek-bestelflow. Lijst is geprioriteerd: eerst alles dat geld of vertrouwen kan breken, daarna kwaliteit & polish.

---

## P0 — Blockers voor live met betaling

### 1. Stripe & Peecho productie-configuratie
- Edge-functions `create-photobook-checkout` en `stripe-webhook` zijn af, maar runtime-secrets ontbreken: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SHIPPING_COUNTRIES`, `SITE_URL`, `PHOTOBOOK_BASE_PRICE_CENTS`, `PHOTOBOOK_PRICE_PER_PAGE_CENTS`, plus `PEECHO_ORDER_API_URL`, `PEECHO_MERCHANT_API_KEY`, `PEECHO_OFFERING_ID`, `PEECHO_CONTENT_WIDTH_MM`/`_HEIGHT_MM`.
- Beslissen: doorgaan met BYOK-Stripe (huidige code) óf overstappen op Lovable's seamless Stripe payments (betere UX, ingebouwde tax, geen eigen webhook nodig). Aanbeveling: **seamless** voor MVP, behoud Peecho-fulfillment in `stripe-webhook`.
- Webhook publiek bereikbaar maken en Stripe-endpoint registreren (success/cancel test).
- End-to-end testbestelling in Stripe testmode + Peecho sandbox.

### 2. Order-bevestiging & status-UI
- Nu komt user na betaling terug op `/photobook?checkout=success` met enkel een toast. Maak een echte bevestigingsweergave (bedrag, levertijd, e-mail-melding, link naar order-historie).
- Realtime/poll op `photobook_orders.payment_status` + `fulfillment_status`; toon "fulfillment_status = needs_configuration / failed" duidelijk aan eigenaar.
- E-mailbevestigingen (besteld / verzonden) — minimaal via Stripe receipt; ideaal eigen template via edge-function.

### 3. Juridische & commerciële pagina's
- `/algemene-voorwaarden`, `/privacy`, `/cookies`, `/herroeping`, `/verzending-en-retour` (gedrukt-op-maat = wettelijk geen herroepingsrecht — duidelijk vermelden vóór checkout).
- Checkbox "Ik ga akkoord met voorwaarden en geen-herroeping" in besteldialoog.
- Cookie-melding indien analytics komt; nu nog niets, dus eventueel pas nodig als analytics wordt toegevoegd.

### 4. Auth-basics afmaken
- `/reset-password` route ontbreekt — `resetPasswordForEmail` flow afmaken (forgot + reset page).
- Google login toevoegen (één-klik signup verlaagt drempel sterk).
- E-mailbevestiging op signup aanzetten (nu mogelijk auto-confirm).
- Account verwijderen-knop (GDPR).

### 5. RLS & data-controle laatste check
- `supabase--linter` draaien en eventuele warnings oplossen.
- Controleer dat `photobook_orders`, `photobook_order_events`, `trip_private_info` correct alleen voor eigenaar leesbaar zijn.
- `profiles.is_pro` mag alleen via service_role wijzigen (trigger aanwezig — testen).

---

## P1 — Stabiliteit & vertrouwen

### 6. PDF-robustheid
- `buildPeechoPdf` draait client-side met jsPDF; grote boeken (>60 foto's) lopen vast op mobiel. Tonen "Beste op desktop"-waarschuwing of PDF naar edge-function verplaatsen.
- Catch CORS-fail in `loadImageAsJpeg` (foto die niet laadt = lege pagina) — laat melding zien en blokkeer bestellen.
- Validatie: minimaal aantal foto's per geprinte pagina (nu kunnen blanco pagina's tussenzitten als alle media zijn uitgevinkt).

### 7. Image-upload pipeline
- Stappenfoto's worden ongecomprimeerd geüpload — voeg client-side resize/compress (max 2400px, ~85%) toe voor lagere storage-kosten en snellere boek-PDF.
- Video-uploads begrenzen of expliciet weigeren in fotoboek.
- Privacy: `trip-private` bucket policies bestaan, maar `step_media.storage_path` migratie is recent — check dat oude rows nog werken.

### 8. Notificaties surfacen
- Tabel `notifications` + triggers bestaan, maar de UI heeft (vermoedelijk) nog geen badge/dropdown. Header-bell met ongelezen-teller toevoegen, anders zijn volgverzoeken onzichtbaar.

### 9. Onboarding
- `profiles.onboarded` veld bestaat, geen flow gezien. Eerste-login modal: naam, avatar, privacy-keuze, "nieuw project of voorbeeld bekijken".

### 10. Error- & loading-states
- Lege staten op `/vrienden`, `/favorieten`, `/profile/:id` controleren.
- 404 voor private/verwijderde trips: nu fallback "Project niet gevonden" — OK, maar voeg "Vraag toegang" knop toe als trip bestaat maar privé is.

---

## P2 — Fotoboek-polish (uit eerder plan, nog open)

- Linker zijbalk paginaoverzicht (thumbnails + paginanummer).
- Inline cover-editor (open via klik op cover, niet apart paneel).
- Per-pagina actiebalk (layout, hoofdstuk hernoemen, stap verbergen).
- Cover-stijlen "Polaroid" en "Tape-binding" als alternatieven naast full-bleed.
- Visuele dropzone-indicator bij drag & drop + "reset volgorde"-knop.
- Overzichtsmodus 4-koloms grid met multi-select.
- Pre-order samenvatting met thumbnail van cover + 4 binnenpagina's (nu alleen format-keuze).
- Crop-controls voor cover (vierkant/liggend/staand) — nu in checkout, ook in editor.

---

## P3 — Groei & vertrouwen, na launch

- SEO: per-project Open Graph (cover + auteur), sitemap (script draait al in build), schema.org `Article`.
- Analytics + foutmonitoring (PostHog/Sentry) inschakelen.
- Stripe Tax of Paddle voor btw bij internationale verkoop.
- Refund/cancel-flow voor eigenaar zichtbaar.
- Performance: leaflet en jspdf zitten al in lazy chunks — meten met Lighthouse.
- Account-delete edge-function (cascadet alles incl. storage).

---

## Voorgestelde volgorde van uitvoering

1. P0.1 + P0.2 + P0.4 (auth/reset/Google) — basis voor live met geld.
2. P0.3 — juridisch + bestel-disclaimer.
3. P0.5 + supabase linter.
4. P1.6–P1.8 — PDF/uploads/notificaties.
5. P2 — fotoboek-editor polish.
6. P3 — na de eerste echte verkoop.

Laat weten welk blok je eerst wilt aanpakken, dan begin ik daar.