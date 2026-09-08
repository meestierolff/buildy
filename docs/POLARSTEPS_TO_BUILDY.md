# Polarsteps naar Buildy

Onderzocht op 29 augustus 2026 via één begrensde openbare Firecrawl-pass
(homepage, Travel Tracker, Travel Book, login en twee supportartikelen) en een
read-only ingelogde browsersessie. Dit is patroononderzoek, geen toestemming
om Polarsteps-assets, fonts, teksten of trade dress over te nemen.

## Structurele patronen

| Polarsteps | Buildy |
| --- | --- |
| Eén emotionele belofte boven beeldvullende fotografie | De Buildy-belofte, één primaire CTA en echte renovatiefotografie |
| Eén chronologisch reisverhaal | Eén verticaal Verhaal met foto-first Bouwmomenten |
| Tripnaam, maker en delen direct boven de tijdlijn | Verbouwingsnaam, privacy en `Deel je verbouwing` bij de cover |
| Step met titel/meta, fotoreeks, tekst en kleine interactielaag | Bouwmoment met datum/fase, grote foto's, korte tekst, reacties en opmerkingen |
| Desktop: smalle tijdlijn naast een ondersteunend kaartvlak | Centrale verhaalkolom naast een rustige rail voor delen en Bouwboek |
| Mobiel: één kolom, grote media en compacte navigatie | Volle-breedte foto's, vaste toevoegactie en vier primaire bestemmingen |
| Secret link werkt zonder account | Herroepbare deellink met duidelijke bearer-linkwaarschuwing |
| Travel Book verschijnt na de waarde van het digitale verhaal | Bouwboekpreview groeit pas vanuit echte Bouwmomenten |

Het ingelogde profiel gebruikt op desktop een zijpaneel van circa 393 px naast
het hoofdbeeld. Een Step staat in een kolom van circa 600 px en gebruikt 24 px
binnenruimte, een horizontale fotoreeks en interacties onder het verhaal.
Delen staat naast de triptitel. Het onderzochte account had geen eigen trips;
een owner-Step-editor en persoonlijke Travel Book-editor waren daarom niet
toegankelijk zonder de verboden actie een trip aan te maken. De aanmaak- en
privacystructuur is alleen read-only als leeg formulier bekeken en aangevuld
met de twee openbare supportartikelen.

## Designtokens

- Buildy behoudt graphite `#26231F`, warm paper `#F7F2E9`, vellum `#FFFDF8`,
  terracotta `#A94E36`, linen `#D8CFC1` en muted text `#655F57`.
- Instrument Serif is uitsluitend voor emotionele statements en
  Bouwboekhoofdstukken; Inter draagt navigatie, formulieren en interactie.
- Desktopinhoud blijft meestal 960–1120 px breed; leestekst is smaller.
- Mobiel gebruikt 24 px gutters, minimaal 44 px aanraakvlakken en één kolom.
- Foto's zijn 3:2, 4:3 of volle-breedte crops; een open boek gebruikt circa
  2:1. Media mag 16–24 px radius hebben, functionele controls minder.
- Overgangen duren 200–300 ms en beperken zich tot opacity, kleur en kleine
  positiewijzigingen; `prefers-reduced-motion` blijft leidend.
- Schaduwen zijn licht. Scheiding komt vooral uit fotografie, papierkleur en
  haarlijnen, niet uit een stapel afgeronde kaarten.

## Schermmapping

1. Landing: beeldvullende renovatie, belofte, lokale foto-demo, de reeks
   `foto -> Bouwmoment -> Verhaal -> Bouwboek`, deelweergave en privacy.
2. Auth: 50/50 fotografie en één rustige `Doorgaan met Google`-actie.
3. Onboarding: naam, optioneel type, privé aanmaken en direct composer openen.
4. Verbouwing: cover, naam/privacy/delen, verticale bouwlijn en Bouwmomenten.
5. Bouwmoment: grote media, datum/fase, korte tekst en ondergeschikte reacties.
6. Gedeelde viewer: dezelfde foto-hiërarchie zonder editcontrols; login alleen
   wanneer iemand wil reageren of een opmerking wil plaatsen.
7. Bouwboek: cover en chronologische spreads, maximaal twee layouts, een exact
   printproof en daarna de server-owned quote en Stripe-hosted Checkout.
8. Profiel: eigen verbouwing, naam/privacy, feedback en uitloggen; beheer en
   handmatige fulfilment blijven op afzonderlijke beveiligde adminroutes.

## Buildy-componentbesluiten

- De herkenbare lijn is de **bouwlijn**: dezelfde verticale lijn verbindt
  fases en Bouwmomenten en eindigt visueel als de rug van het Bouwboek.
- `VerbouwingHero` bevat cover, privacy, delen en `Bouwmoment toevoegen`.
- `Bouwlijn` rendert gewone documentflow; geen horizontale snap-tijdlijn.
- `BouwmomentCard` houdt foto's dominant en opmerkingen in een sheet/drawer.
- `ShareLinkDialog` benoemt expliciet dat iedereen met de link kan kijken en
  ondersteunt kopiëren, native delen en intrekken.
- `BouwboekViewer` blijft digitaal en afgeleid; de actieve bestelstap bindt
  checkout uitsluitend aan één goedgekeurde proofrevisie en server-owned
  prijs-, seller- en termswaarheid.
- Lege en foutstaten geven één concrete vervolgstap en tonen nooit een ruwe
  database- of providerfout.

## Niet kopiëren

- Geen Polarsteps-logo, naam, fonts, foto's, profielen, reviews, illustraties,
  kaartassets, appbadges, broncode, exacte teksten of trademarkdetails.
- Geen letterlijke kaart of route als renovatiemetafoor.
- Geen nagebouwde proprietary Step- of Travel Book-layout.
- Geen testimonial, gebruikersaantal of productbeschikbaarheid suggereren die
  Buildy nog niet werkelijk heeft.
- Geen automatische fulfilment, providerstatus of productbeschikbaarheid
  beloven die niet werkelijk operationeel en aantoonbaar goedgekeurd is.
