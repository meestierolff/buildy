# Buildy MVP-scope

Status: canoniek voor de Buildy production-MVP.

## Belofte

> Maak van je verbouwing een verhaal om te bewaren.

Buildy brengt voortgangsfoto's en korte verhalen samen in één rustig,
chronologisch verbouwingsdagboek. Hetzelfde bronmateriaal groeit automatisch
uit tot een digitaal en drukbaar Bouwboek.

## Kernreizen

### Bezoeker

- begrijpt het product via de landing en lokale fotodemo;
- bekijkt een gedeelde verbouwing via een tijdelijke deellink;
- heeft zonder account uitsluitend leesrechten;
- logt met Google in om zelf te bouwen of te reageren.

### Eigenaar

- logt in met Google, zonder invite-, wachtwoord- of e-mailflow;
- kiest een naam en optioneel een type verbouwing;
- begint met een privéverbouwing;
- voegt een foto en korte tekst toe als Bouwmoment;
- ziet Bouwmomenten terug in het chronologische Verhaal;
- maakt, roteert of trekt een veilige deellink in;
- bekijkt en verfijnt het Bouwboek en keurt één exacte printproofrevisie goed;
- accepteert de actuele voorwaarden en het maatwerkkarakter, ontvangt een
  server-owned quote en rekent af via Stripe-hosted Checkout;
- volgt de server-owned orderstatus en deelt algemene feedback.

### Ingelogde kijker

- bekijkt toegankelijke Bouwmomenten;
- kan reageren binnen de server-side toegangsregels;
- krijgt door een deellink nooit eigenaar- of schrijfrechten.

## In scope

- publieke landing, voorbeeld en lokale fotodemo;
- Google OIDC en server-owned sessies;
- profiel en eenvoudige onboarding;
- privé als standaard voor nieuwe verbouwingen;
- private foto-upload en request-driven mediaverwerking;
- maken, bewerken en verwijderen van Bouwmomenten;
- chronologisch Verhaal met reacties;
- intrekbare, high-entropy deellinks met alleen-lezen gasttoegang;
- digitaal Bouwboek met cover, indeling, volgorde en inhoudsselectie;
- immutable printproofs, server-owned prijzen/seller/voorwaarden en Stripe-
  hosted Checkout;
- geverifieerde, idempotente Stripe-webhooks als enige bevestiging van betaling;
- een beveiligde adminorderqueue voor handmatige externe printfulfilment;
- feedback- en supportformulieren;
- accountinzage, export en verwijdering;
- privacy-, voorwaarden- en supportpagina's.

De primaire navigatie is:

- desktop: `Mijn verbouwing`, `Bouwmoment toevoegen`, `Bouwboek`, `Profiel`;
- mobiel: `Verhaal`, `Toevoegen`, `Bouwboek`, `Profiel`.

## Bewust niet in scope

- automatische printfulfilment, drukker-API, callback, poller of cron;
- Peecho of een andere actieve printproviderintegratie;
- transactionele e-mail of een AI-provider;
- wachtwoorden, magic links of een tweede loginmethode;
- een openbare discoveryfeed, projectmanagementsuite of marktplaats;
- een tweede zichtbaar follow- of projecttoegangsmodel;
- geautomatiseerde media- of Bouwboekcrons.

Historische routes en databasevelden mogen voor compatibiliteit blijven. Ze
introduceren geen tweede zichtbaar productmodel of alternatieve providerflow.

## Operationeel contract

- `PRODUCT_PROFILE=feedback_beta`;
- `BETA_MODE=false`;
- Preview en staging gebruiken `CHECKOUT_MODE=test` met
  `STRIPE_ENVIRONMENT=test`;
- Production gebruikt pas na alle releasegates `CHECKOUT_MODE=live` met
  `STRIPE_ENVIRONMENT=live` en afzonderlijke live approvals/secrets;
- `public_demo` en `CHECKOUT_MODE=off` zijn alleen een veilige statische,
  fail-closed fallback en kunnen nooit releasebewijs of een releaseprofiel zijn;
- Neon is de database en private Vercel Blob bewaart customer-media;
- browsercode gebruikt uitsluitend de typed same-origin API;
- autorisatie en capabilities komen van de server;
- alleen een signature-, account-, environment- en inhoudsgeverifieerde Stripe-
  webhook kan een order betaald maken;
- betaalde orders worden in `/beheer/bestellingen` handmatig beoordeeld en
  extern geplaatst;
- alleen account lifecycle heeft één dagelijkse cron.

De MVP is pas vrij te geven nadat één vastgezette Preview-build de owner-,
deel-, kijker-, Bouwboek-, Stripe-test-, adminorder- en feedbackreizen op
desktop en mobiel aantoonbaar doorloopt en alle overige releasegates groen zijn.
