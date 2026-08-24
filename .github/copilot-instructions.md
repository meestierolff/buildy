---
applyTo: "**"
---
# Buildy — GitHub Copilot Instructions

Buildy is een privacy-first, foto-first verbouwingsdagboek met een sociaal
meeleefmodel en een bewaar-/bestelpad. De production target is React/Vite met
een same-origin typed Vercel Web API, Google OpenID Connect, server-owned Neon-
sessies, Neon PostgreSQL/Drizzle/RLS, private Vercel Blob, Stripe-hosted Checkout
en een beheerqueue voor handmatige printfulfilment.

- De founder-authoritative kernbelofte is:
  `Maak van je verbouwing een verhaal om te bewaren.`
- Bouw één samenhangende flow: foto → Bouwmoment → Verhaal → profielvolgers/
  reacties → Bouwboek → locked proof → Stripe → handmatige fulfilment.
- Voeg geen browserimport, environmentvariabele of runtimecall naar Better Auth,
  Brevo/e-mail, Cloudflare R2, AWS S3, Peecho of oude prototypeproviders toe.
  React praat alleen met de typed Buildy API. Stripe blijft server-only.
- Gebruik precies één server-owned productprofiel:
  `PRODUCT_PROFILE=feedback_beta`. Verwijder simple-mode waarheid zoals
  `VITE_SIMPLE_APP_MODE` en `SIMPLE_APP_MODE` uit actieve runtimepaden.
- Gebruik Google OIDC als enige MVP-authmethode. Ondersteun geen wachtwoorden,
  magic links, e-maillogin of e-mailverificatie in de actieve applicatie.
- Leid actor, owner, capability truth, storage key en providerstatus altijd
  server-side af. Een verborgen knop of clientveld is nooit autorisatie.
- Verbouwingmedia, exports en Bouwboekproofs blijven privé. Gebruik private Vercel
  Blob achter de autoriserende `/api/media/:assetId`-paden; persist geen
  publieke of permanente signed URL.
- Er is één canoniek profiel-followmodel: openbaar profiel volgt direct, privé
  profiel gebruikt een verzoek. Block trekt relaties/access in; unblock herstelt
  niets. Direct project-follow/project-access is geen actief zichtbaar model.
- Verbouwingen hebben exact `private`, `followers`, `unlisted` en `public`.
- Stripe Checkout is vereist. Preview/automated gebruikt `CHECKOUT_MODE=test`;
  production commerce gebruikt pas na alle gates `live`; `off|test|live` falen
  gesloten bij incomplete/mismatched config. Alleen de geverifieerde webhook
  mag paymentstatus wijzigen.
- Betaalde orders worden door een admin in `/beheer/bestellingen` gecontroleerd
  en handmatig bij een goedgekeurde drukker geplaatst. Voeg geen Peecho API,
  callback, worker, polling, cron of env toe.
- Media-completion en Bouwboekproofrequests verwerken uitsluitend het gerichte
  asset/de revisie onder de geïsoleerde workerrol; owner-polling mag die
  idempotente verwerking begrensd opnieuw activeren. Alleen account lifecycle
  heeft een dagelijkse cron en gebruikt `CRON_SECRET`.
- Nieuwe SQL-wijzigingen zijn oplopende migrations in `db/migrations/`; wijzig
  een al toegepaste migration nooit.
- Alle zichtbare UI-copy is Nederlands; code, identifiers en comments zijn
  Engels.
- Gebruik `toast.error()` voor gebruikersfouten en `console.error()` alleen
  voor ontwikkelaarsdiagnostiek zonder gevoelige waarden.
- Gebruik TanStack Query voor serverstate en shadcn/ui voor productcomponenten.
- Voordat een slice als afgerond geldt, draai minstens typecheck, relevante
  Vitest/securitytests en build. Houd privacy, RLS en capability truth streng.
- Gebruik zichtbaar `Verbouwing`, `Bouwmoment`, `Verhaal`, `Bouwboek`,
  `Connecties` en `Volgend`; historische `trip`/`step`/project-socialnamen mogen
  alleen in append-only data/migrations blijven.
- Discovery, follow, Connecties, comments/reactions, notificaties, Bouwboek,
  orderstatus en handmatige fulfilment zijn actieve MVP-scope. Budget en
  plattegronden zijn secundair, niet de kernbelofte.
- Claim geen Preview-, provider-, interactieve-browser- of productionresultaat
  zonder echt bewijs aan dezelfde SHA. Production is NO-GO zolang Vercel
  commercial/Hobby, legal, pricing/seller, provider, Preview, role journeys,
  cross-browser en MCP niet groen zijn. De huidige Browser MCP-enumeratie is
  exact `[]`.
