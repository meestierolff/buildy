---
applyTo: "**"
---
# Buildy — GitHub Copilot Instructions

Buildy is een privacy-first sociaal verbouwingsdagboek. De production target is
React/Vite met een same-origin typed Vercel Web API, Better Auth, Neon
PostgreSQL/Drizzle, private Cloudflare R2, Stripe, Peecho REST v3 en Brevo.

- Voeg geen browserimport, environmentvariabele of runtimecall naar een oude
  prototype- of BaaS-provider toe. React praat alleen met de typed Buildy API.
- Leid actor, owner, storagekey, prijs en providerstatus server-side af. Een
  verborgen knop of clientveld is nooit autorisatie.
- Projectmedia, floorplans en print-PDF's blijven privé. Gebruik de
  autoriserende `/api/media/:assetId`-proxy; persist geen signed URL.
- Checkout gebruikt uitsluitend een immutable, goedgekeurde printproof en
  server-owned prijs/seller/terms. Stripe-refund annuleert Peecho nooit
  automatisch.
- Gebruik Peecho REST v3 via de provideradapter; voeg geen Print Button of
  publieke PDF-download toe.
- Schrijf transactionele mail eerst naar de durable outbox. Log geen recipient,
  adres, token, raw providerpayload of signed URL.
- Nieuwe SQL-wijzigingen zijn oplopende migrations in `db/migrations/`; wijzig
  een al toegepaste migration nooit.
- Alle UI-copy is Nederlands; code, identifiers en comments zijn Engels.
- Gebruik `toast.error()` voor gebruikersfouten en `console.error()` alleen voor
  ontwikkelaarsdiagnostiek zonder gevoelige waarden.
- Gebruik TanStack Query voor serverstate en shadcn/ui voor productcomponenten.
- Draai minstens typecheck, relevante Vitest/securitytests en build voordat een
  verticale slice als afgerond geldt.

Canonieke standaardfases: Aankoop → Voorbereiding/Design → Sloop → Ruwbouw →
Installatie → Afbouw → Afwerking → Inrichting → Oplevering. Projecteigenaren
kunnen daarnaast custom fases definiëren.
