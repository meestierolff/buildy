---
applyTo: "**"
---
# Buildy — GitHub Copilot Instructions

Buildy is een privacy-first foto-first verbouwingsdagboek voor een publieke
feedbackbèta. De production target is React/Vite met een same-origin typed
Vercel Web API, Google OpenID Connect, secure Neon sessions,
Neon PostgreSQL/Drizzle en private Vercel Blob.

- De kernbelofte is: `Maak van je verbouwing een verhaal om te bewaren.`
- Bouw alleen de kleinste mooie MVP rond deze flow: landing → lokale fotodemo →
  Google sign-in → eerste bouwmoment opslaan → Verhaal → Bouwboek-preview →
  deel-link → feedback → accountverwijdering.
- Voeg geen browserimport, environmentvariabele of runtimecall naar Better
  Auth, Brevo, Cloudflare R2, AWS S3, Stripe, Peecho, oude prototypeproviders
  of een oude BaaS-provider toe. React praat alleen met de typed Buildy API.
- Gebruik precies één server-owned productprofiel:
  `PRODUCT_PROFILE=feedback_beta`. Verwijder simple-mode waarheid zoals
  `VITE_SIMPLE_APP_MODE` en `SIMPLE_APP_MODE` uit actieve runtimepaden.
- Gebruik Google OIDC als enige MVP-authmethode. Ondersteun geen wachtwoorden,
  magic links, e-maillogin of e-mailverificatie in de actieve applicatie.
- Leid actor, owner, capability truth, storage key en providerstatus altijd
  server-side af. Een verborgen knop of clientveld is nooit autorisatie.
- Projectmedia en Bouwboek-previewdata blijven privé. Gebruik private Vercel
  Blob achter de autoriserende `/api/media/:assetId`-paden; persist geen
  publieke of permanente signed URL.
- Checkout blijft publiek uit met `CHECKOUT_MODE=off`. Implementeer of activeer
  geen runtimepad dat Stripe, Peecho, fulfilment of echte printorders vereist.
- Kernacties van gebruikers mogen niet afhangen van frequente cronjobs,
  langlopende workers of e-mailqueues. Gebruik request-driven verwerking.
- Nieuwe SQL-wijzigingen zijn oplopende migrations in `db/migrations/`; wijzig
  een al toegepaste migration nooit.
- Alle zichtbare UI-copy is Nederlands; code, identifiers en comments zijn
  Engels.
- Gebruik `toast.error()` voor gebruikersfouten en `console.error()` alleen
  voor ontwikkelaarsdiagnostiek zonder gevoelige waarden.
- Gebruik TanStack Query voor serverstate en shadcn/ui voor productcomponenten.
- Voordat een slice als afgerond geldt, draai minstens typecheck, relevante
  Vitest/securitytests en build. Houd privacy, RLS en capability truth streng.

Verborgen of latere features zoals ontdekken, volgen, connecties, comments,
reactions, budget, floorplans, orderhistorie, checkout en fulfilment horen niet
in de primaire navigatie, landing, onboarding of kritieke productbundels van de
feedbackbèta.
