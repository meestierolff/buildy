# Buildy Launch Team

Doel: Buildy live brengen als "Polarsteps voor verbouwingen": projecten documenteren, delen, volgen en aan het einde een gedrukt Bouwboek bestellen.

Deze map is de werkstructuur voor launch-readiness. Elk bestand kijkt door een andere bril naar hetzelfde product, zodat beslissingen niet alleen technisch maar ook commercieel, operationeel en veilig landen.

## Disciplines

- `engineering.md` — productkwaliteit, architectuur, tests, performance.
- `cybersecurity.md` — auth, RLS, secrets, betaling en abuse-risico.
- `design.md` — UX, visuele consistentie, mobile, fotoboekervaring.
- `seo.md` — indexeerbaarheid, metadata, contentlandschap.
- `marketing.md` — positionering, messaging, proof, campagnes.
- `sales.md` — conversie, pricing, support, B2B/B2C kansen.
- `gtm.md` — launchvolgorde en meetbare leercycli.
- `distribution.md` — kanalen, partnerships, loops.
- `launch-backlog.md` — samengevoegde prioriteiten voor livegang.

## Current Launch Hypothesis

Homeowners already document renovations in WhatsApp, Instagram, notes and camera rolls. Buildy wins by making that documentation structured enough to share during the project and valuable enough to print afterwards.

## This Sweep

Completed in this pass:

- Added Buildy-owned Stripe checkout foundation for Bouwboeken.
- Added payment and fulfillment state to `photobook_orders`.
- Added server-side webhook path that can trigger Peecho fulfillment when credentials are configured.
- Tightened order RLS by removing owner-side update/delete privileges on order rows.
- Preserved direct PDF-to-Peecho fulfillment data: public PDF URL, page count, format, order reference.

Open operational dependency:

- Peecho production API credentials, offering ID and credit/payment setup are required before automatic production fulfillment can be considered live.
