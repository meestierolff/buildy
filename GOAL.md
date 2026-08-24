# Buildy production-MVP

## Doel

Buildy wordt een mooie, stabiele en privacy-first production-MVP rond één
founder-authoritative belofte:

`Maak van je verbouwing een verhaal om te bewaren.`

## Kernflow

1. Een bezoeker begrijpt het product en probeert veilig één lokale foto.
2. De gebruiker meldt zich alleen met Google OIDC aan.
3. Een foto wordt een Bouwmoment in een chronologisch Verhaal en groeiend
   Bouwboek.
4. De eigenaar kiest `private`, `followers`, `unlisted` of `public`.
5. Openbare profielen worden direct gevolgd; privéprofielen gebruiken één
   canoniek followrequestmodel.
6. Volgers beleven mee via Volgend, reacties en notificaties; block trekt
   toegang onmiddellijk in.
7. De eigenaar controleert een locked printproof, accepteert actuele voorwaarden
   en betaalt via Stripe-hosted Checkout.
8. Een geverifieerde Stripe-webhook maakt de order betaald; een admin handelt de
   drukopdracht daarna handmatig af.
9. Support, moderatie, feedback, export en accountverwijdering blijven veilig en
   begrijpelijk zonder e-mailprovider.

## Niet de MVP

- wachtwoord- of e-maillogin
- Better Auth, Brevo, R2/S3 of een tweede backend
- project-follow/project-access als tweede sociaal model
- een generiek sociaal netwerk of projectmanagementtool als kernbelofte
- een geavanceerde desktop-publishingeditor
- Peecho-API, callbacks, workers, polling of automatische fulfilment
- transactionele e-mail als launchafhankelijkheid
- budget en plattegronden als primaire loop; zij zijn hoogstens secundair

## Huidige status

- Google-only auth, private Vercel Blob, canonical social, vier visibilities,
  Stripe Checkout en handmatige orderbeheergrenzen zijn in de huidige werkboom
  geïmplementeerd;
- media-completion en Bouwboekproofrequests verwerken alleen het exacte
  asset/de revisie onder geïsoleerde workerrollen, met begrensde owner-polling
  en zonder media-/photobookcron;
- geautomatiseerde evidence is per snapshot vastgelegd in de QA-documenten en
  moet opnieuw aan de uiteindelijke geïntegreerde SHA worden gebonden;
- er is geen nieuwe geïntegreerde Vercel Preview of production deployment
  bewezen en productie is door deze werkzaamheden niet gemuteerd;
- de verplichte Browser MCP-runtime/tool-aanvraag werd door de huidige Codex-
  gebruikslimiet afgewezen tot 29 augustus 2026 02:26.

## Nog open buiten code

- commercieel toegestane Vercel-hosting; het gekoppelde plan stond bij controle
  op Hobby;
- goedgekeurde juridische identiteit, privacy/voorwaarden/support en
  prijs-/seller-/btwconfiguratie;
- echte Previewomgeving met gescheiden Neonrollen, Google OIDC, private Blob en
  Stripe test Checkout/webhooks;
- gekozen drukker, provider-/privacyafspraken, actuele quote, proefdruk en
  handmatig fulfilment-/refundproces;
- hosted CI, een verse apply/replay van de 49-migratieledger en uitvoering van
  de huidige 205-test browsermatrix tegen één vastgezette Preview-SHA;
- complete provider-/rolreizen en een geslaagde interactieve MCP-audit.

`CHECKOUT_MODE=off|test|live` blijft fail-closed. Preview moet `test` gebruiken;
`live` blijft **NO-GO** totdat iedere technische, commerciële, juridische,
provider-, operationele en releasegate groen is.

Zie [docs/MVP_RELEASE_REPORT.md](docs/MVP_RELEASE_REPORT.md) voor de actuele
uitvoeringstoestand.
