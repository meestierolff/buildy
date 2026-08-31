# Kernflow en scope

Status: compacte productroute; [MVP_SCOPE.md](MVP_SCOPE.md) is de volledige
scopebeschrijving.

## Kernflow

1. Publieke landing en lokale foto-demo zonder upload.
2. Google OIDC en profielonboarding.
3. Verbouwing maken met één van vier visibilitymodi.
4. Private foto uploaden, exact dit asset request-driven verwerken en als
   Bouwmoment publiceren.
5. Chronologisch Verhaal en automatisch groeiend Bouwboek.
6. Openbaar volgen of privéfollowrequest; beleven via Volgend, reacties en
   notificaties.
7. Bouwboek samenstellen, exact de aangevraagde proofrevisie request-driven
   verwerken, privé bekijken en expliciet goedkeuren.
8. Serverquote en Stripe-hosted Checkout.
9. Webhook-bevestigde betaalstatus en handmatige adminfulfilment.
10. Orderstatus, support/feedback/moderatie, export en accountverwijdering.

## Producthiërarchie

`Vastleggen → Samen beleven → Terugkijken → Bewaren → Bestellen`

Een foto is het aha-moment: dezelfde echte inhoud wordt Bouwmoment, Verhaalitem,
Bouwboekspread en mogelijke Voor & Na Spread. Social en commerce ondersteunen
dit dagboek; zij zijn geen los generiek netwerk of winkelplatform.

## In scope

- meerdere Verbouwingen, covers, fases en eenvoudige mijlpalen;
- meerdere foto's, galerij, Voor & Na, comments/reactions en notificaties;
- één canoniek profiel-followmodel, block en Connecties;
- `private`, `followers`, `unlisted`, `public`, waarbij `unlisted` uitsluitend
  via een tijdelijke owner-issued share capability leest;
- discovery van werkelijk openbare profielen/Verbouwingen;
- Bouwboek include/exclude/order/layout en deterministische locked proof;
- request-driven media-/proofverwerking onder afzonderlijke workerrollen, met
  begrensde owner-poll retry en zonder media-/photobookcron;
- één nauwe hardcover-SKU, server-owned price/seller/terms;
- Stripe test op Preview en live alleen na volledige GO;
- adminorderqueue en handmatige drukkerfulfilment;
- legal, support, feedback, moderation, sessions, export en deletion.

Budget en plattegronden zijn secundair en alleen acceptabel wanneer hun
zichtbare route en mutaties stabiel en getest zijn.

## Niet in scope

- wachtwoord/e-mailauth, Better Auth of transactionele e-mail;
- R2/S3 of publieke customer-media;
- project-follow/project-access als tweede sociaal model;
- Peecho API, automatische quote/order/payment/callback/polling/worker;
- automatische printfulfilment of een geavanceerde DTP-editor;
- client-owned pricing, seller, role, visibility of payment truth.

## Releasegrens

In scope betekent nodig, niet production-bewezen. Preview, Stripe test, echte
orders en productie blijven NO-GO totdat [LAUNCH_READINESS.md](LAUNCH_READINESS.md)
groen is. De verplichte Browser MCP-runtime was door de huidige Codex-
gebruikslimiet geblokkeerd.
