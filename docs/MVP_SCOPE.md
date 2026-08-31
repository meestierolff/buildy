# Buildy MVP-scope

Status: canoniek voor de eenvoudige, gratis MVP.

## Belofte

> Maak van je verbouwing een verhaal om te bewaren.

Buildy brengt voortgangsfoto's en korte verhalen samen in één rustig,
chronologisch verbouwingsdagboek. Hetzelfde bronmateriaal groeit automatisch
uit tot een digitaal Bouwboek.

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
- bekijkt en verfijnt het digitale Bouwboek;
- deelt algemene feedback of printinteresse.

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
- feedbackformulier en vrijblijvende interesse in later laten drukken;
- accountinzage, export en verwijdering;
- privacy-, voorwaarden- en supportpagina's.

De primaire navigatie is:

- desktop: `Mijn verbouwing`, `Bouwmoment toevoegen`, `Bouwboek`, `Profiel`;
- mobiel: `Verhaal`, `Toevoegen`, `Bouwboek`, `Profiel`.

## Bewust niet in scope

- betalingen, checkout, prijzen, bestellingen of refunds;
- een printproof, drukopdracht of fulfilmentprovider;
- transactionele e-mail of een AI-provider;
- wachtwoorden, magic links of een tweede loginmethode;
- een openbare discoveryfeed, projectmanagementsuite of marktplaats;
- een tweede zichtbaar follow- of projecttoegangsmodel;
- geautomatiseerde media- of Bouwboekcrons.

Historische routes, databasevelden en commercecode mogen voor compatibiliteit
dormant blijven. Ze staan niet in de primaire navigatie en zijn geen onderdeel
van de releasebelofte.

## Operationeel contract

- `PRODUCT_PROFILE=feedback_beta`;
- `BETA_MODE=false`;
- `CHECKOUT_MODE=off`;
- Neon is de database en private Vercel Blob bewaart customer-media;
- browsercode gebruikt uitsluitend de typed same-origin API;
- autorisatie en capabilities komen van de server;
- alleen account lifecycle heeft één dagelijkse cron.

De MVP is pas vrij te geven nadat één vastgezette Preview-build de owner-,
deel-, kijker-, Bouwboek- en feedbackreizen op desktop en mobiel aantoonbaar
doorloopt.
