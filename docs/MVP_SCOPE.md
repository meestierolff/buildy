# Buildy MVP-scope

Scope van de gratis Buildy-MVP. [GRAPH](architecture/GRAPH.md),
[FLOWS](architecture/FLOWS.md) en [STATE](architecture/STATE.md) zijn leidend
voor grenzen, acceptatie en actueel bewijs.

## Belofte

> Maak van je verbouwing een verhaal om te bewaren.

Buildy brengt voortgangsfoto's en korte verhalen samen in één rustig,
chronologisch verbouwingsdagboek. Hetzelfde bronmateriaal groeit automatisch
uit tot een digitaal Bouwboek. Een fysiek exemplaar is voor later.

## Kernreizen

### Bezoeker

- begrijpt het product via de landing en lokale fotodemo;
- bekijkt een gedeelde verbouwing via een tijdelijke deellink;
- heeft zonder account uitsluitend leesrechten;
- maakt een account met gebruikersnaam en wachtwoord om zelf te bouwen of te reageren.

### Eigenaar

- registreert en logt in met gebruikersnaam en wachtwoord, zonder invite of e-mailvraag;
- kiest een naam en optioneel een type verbouwing;
- begint met een privéverbouwing;
- voegt een foto en korte tekst toe als Bouwmoment;
- ziet Bouwmomenten terug in het chronologische Verhaal;
- maakt, roteert of trekt een veilige deellink in;
- bekijkt en verfijnt het digitale Bouwboek;
- deelt algemene feedback.

### Ingelogde kijker

- bekijkt toegankelijke Bouwmomenten;
- kan liken en reageren binnen de server-side toegangsregels;
- krijgt door een deellink nooit eigenaar- of schrijfrechten.

## In scope

- publieke landing, voorbeeld en lokale fotodemo;
- gebruikersnaam/wachtwoord, scrypt-hashes en server-owned sessies;
- profiel en eenvoudige onboarding;
- privé als standaard voor nieuwe verbouwingen;
- private foto-upload en request-driven mediaverwerking;
- maken, bewerken en verwijderen van Bouwmomenten;
- chronologisch Verhaal met reacties;
- intrekbare, high-entropy deellinks met alleen-lezen gasttoegang;
- digitaal Bouwboek met cover, indeling, volgorde en inhoudsselectie;
- feedback- en supportformulieren;
- accountinzage, export en verwijdering;
- privacy-, voorwaarden- en supportpagina's.

De primaire navigatie is:

- desktop: `Mijn verbouwing`, `Bouwmoment toevoegen`, `Bouwboek`, `Profiel`;
- mobiel: `Verhaal`, `Toevoegen`, `Bouwboek`, `Profiel`.

## Bewust niet in scope

- Stripe, betalingen, checkout, prijzen, bestellingen en refunds;
- printproofs, fysieke Bouwboeken, handmatige of automatische printfulfilment;
- Peecho of een andere actieve printproviderintegratie;
- transactionele e-mail of een AI-provider;
- OAuth, magic links, e-maillogin en wachtwoordherstel;
- budget, plattegronden, een openbare discoveryfeed, projectmanagementsuite of
  marktplaats;
- een tweede zichtbaar follow- of projecttoegangsmodel;
- geautomatiseerde media- of Bouwboekcrons.

Historische routes, databasevelden en commercecode mogen voor compatibiliteit
dormant blijven. Ze introduceren geen tweede zichtbaar productmodel of
alternatieve providerflow en zijn geen releaseafhankelijkheid.

## Operationeel contract

- `PRODUCT_PROFILE=feedback_beta`;
- `BETA_MODE=false`;
- lokaal, Preview, staging en Production gebruiken `CHECKOUT_MODE=off`;
- `public_demo` is een veilige rollbackoptie en nooit bewijs dat het
  accountgebaseerde MVP-doel is behaald;
- Neon is de database en private Vercel Blob bewaart customer-media;
- browsercode gebruikt uitsluitend de typed same-origin API;
- autorisatie en capabilities komen van de server;
- het digitale Bouwboek vereist geen payment-, printproof- of printworker;
- alleen account lifecycle heeft één dagelijkse cron.

De MVP is pas vrij te geven nadat één vastgezette Preview-build de echte owner-,
deel-, kijker-, Bouwboek-, feedback- en accountverwijderreizen uit F1–F6
aantoonbaar doorloopt, de vereiste CI groen is en de toepasselijke hosting-,
privacy- en providervoorwaarden feitelijk zijn bevestigd. Zie
[releaseprocedure](PRODUCTION_RELEASE.md).
