# Buildy MVP-scope

Status: canoniek voor de production-MVP.

## Belofte en doelgroep

> Maak van je verbouwing een verhaal om te bewaren.

Buildy is voor mensen die hun eigen huis verbouwen en voor de vrienden en
familie die hun voortgang willen volgen. Het lost één probleem op: foto's,
keuzes en verhalen raken verspreid over de camera roll, mappen en
chatgesprekken, terwijl het uiteindelijke verhaal verloren gaat.

De ondersteunende uitleg is:

> Leg ieder bouwmoment vast, laat vrienden en familie meekijken en maak er later
> een persoonlijk Bouwboek van.

## Producthiërarchie

1. Vastleggen
2. Samen beleven
3. Terugkijken
4. Bewaren
5. Bestellen

Het aha-moment is één foto toevoegen: die foto wordt een Bouwmoment, verschijnt
in het chronologische Verhaal, kan reacties krijgen en voegt een spread toe aan
het groeiende Bouwboek. De deelbare productuitkomst is een mooie Voor & Na
Spread uit twee echte Bouwmomenten.

## Primaire loops

Owner: Verbouwing maken → Bouwmoment publiceren → volgers zien de voortgang →
reacties ontvangen → terugkeren → Bouwboek zien groeien.

Follower: profiel vinden → volgen of verzoek sturen → zichtbaar Bouwmoment
bekijken → reageren → notificatie ontvangen → terugkeren.

Commerce: Bouwboek openen → exacte printproof maken en goedkeuren → serverquote
ontvangen → via Stripe betalen → handmatige fulfilment in Buildy volgen.

## In scope

### Publiek

- eigen marketinglanding, lokale foto-demo en duidelijk gelabelde voorbeelden;
- discovery van werkelijk openbare profielen en verbouwingen;
- Google-login;
- voorwaarden, privacy, herroeping, contentbeleid, huisregels, support, melden,
  feedback en een bruikbare 404.

De lokale foto-demo uploadt niets vóór de bezoeker bewust kiest om na Google
login te bewaren.

### Eigenaar

- profielonboarding met alleen noodzakelijke velden;
- Verbouwing maken, bewerken en veilig verwijderen;
- cover, fases, simpele mijlpalen en vier privacyopties;
- foto-first Bouwmomenten maken, bewerken, verwijderen en chronologisch tonen;
- private uploads direct per exact asset verwerken met begrensde owner-poll
  retry, zonder mediacron;
- meerdere foto's, galerij en Voor & Na;
- reacties beheren, volgers beheren, en een high-entropy, tijdelijke,
  roteerbare/intrekbare deellink voor de `unlisted`-modus;
- Bouwboek-preview, deterministische printproof en expliciete goedkeuring;
- server-owned Stripe Checkout en actuele orderstatus;
- account, sessies, export, feedback en accountverwijdering.

### Sociaal

- openbaar of privéprofiel;
- profielen zoeken;
- openbare profielen direct volgen en voor privéprofielen een verzoek sturen;
- Connecties met Zoeken, Volgend, Volgers, Inkomend, Uitgaand en Geblokkeerd;
- accepteren, afwijzen, annuleren, ontvolgen, volger verwijderen, blokkeren en
  deblokkeren;
- een chronologische Volgend-feed op basis van gevolgde profielen;
- reacties, comments, veilige mentions, notificaties en rapportage;
- onmiddellijke access-revocation bij privacy- of blockwijzigingen.

### Bouwboek en betaling

- een Bouwboek dat uitsluitend uit echte Bouwmomenten groeit;
- coverkeuze, include/exclude, volgorde en een klein getest layoutaanbod;
- private, byte-verifieerbare printproof die aan documenthash en mediaset is
  gebonden en bij bronwijziging ongeldig wordt;
- proofrequests direct per exacte revisie verwerken met begrensde ownerpoll,
  zonder photobookcron;
- één nauwe SKU: `a4-landscape-hardcover-v1`, alleen binnen aantoonbaar
  geverifieerde productiegrenzen;
- Stripe Checkout in `test` op Preview;
- `live` alleen na expliciet goedgekeurde prijs-, seller-, juridische,
  hosting-, provider- en releasegates;
- een betaalde orderqueue en beheerpagina's voor handmatige fulfilment;
- actuele betaal-, fulfilment- en trackingstatus voor de koper.

### Founder operations

- feedback- en moderatiebeoordeling;
- role-based beheer voor betaalde orders;
- veilige download van exact de locked print-PDF;
- externe handmatige drukkerreferentie, versleutelde interne notitie,
  trackinglink, statusovergangen, refund review en auditgeschiedenis.

## Secundair

Budget en plattegronden zijn geen primaire productbelofte. Ze blijven alleen
zichtbaar in een secundair Verbouwingmenu wanneer de betreffende route en
mutaties volledig stabiel, begrijpelijk en getest zijn. Verborgen functionaliteit
is geen reden om historische gebruikersdata te verwijderen.

## Bewust niet in scope

- generiek bouwprojectmanagement of een aannemersmarktplaats;
- een Instagram-achtige engagementfeed of creatorplatform;
- een geavanceerde desktop-publishingeditor;
- wachtwoord-, magic-link-, reset-, verificatie- of e-maillogin;
- transactionele e-mail als MVP-afhankelijkheid;
- Better Auth, Brevo, R2, AWS S3 of een tweede backend;
- project-follow als tweede zichtbaar volgmodel;
- afzonderlijke project-accessrequests als zichtbaar toegangsmodel;
- automatische Peecho-quotes, orders, betaling, polling, callbacks of workers;
- een andere betaling dan server-owned Stripe Checkout.

## Releasegrens

“In scope” betekent dat de flow voor de MVP nodig is; het is geen bewijs dat de
flow al production-ready is. Iedere zichtbare actie moet geautomatiseerd én via
de verplichte interactieve Playwright MCP-audit bewezen zijn. Op 23 augustus
2026 werd die browserruntime door de huidige Codex-gebruikslimiet geblokkeerd.
Preview, publieke social MVP, Stripe live en productie blijven daarom **NO-GO**.
