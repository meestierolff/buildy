# Production-MVP gebruikerstestplan

Status: plan; testerselectie, consent, Previewproviders en interactieve runtime
zijn nog open. Social bereik is geen gebruikers- of klantenaantal.

## Doelgroep en doel

Onderzoek met 6–10 volwassen particuliere verbouwers en meelezers of zij zonder
klik-instructie de kernbelofte begrijpen, een veilig fotoverhaal maken, samen
beleven en de Bouwboek-/betaal-/fulfilmentgrenzen juist interpreteren.
Minderjarigen pas na expliciet leeftijds-/privacybesluit.

Gebruik uitsluitend synthetische of bewust gekozen foto's; vraag toestemming
voor herkenbare derden en vermijd adressen/documenten. Scherm/audio alleen met
afzonderlijke consent. Leg kwalitatieve notities onder een test-ID vast en
redigeer PII vóór delen.

## Rollen

- nieuwe Google-invite user;
- owner;
- public-profile follower;
- private-profile requester;
- blocked actorpair;
- moderator en admin;
- buyer/orderowner.

Iedere fixture is synthetisch, environmentgebonden en fail-closed wanneer de
bedoelde rol/identity niet aantoonbaar is.

## Taken

1. Begrijp landing en probeer de lokale fotodemo; bevestig dat niets uploadt.
2. Reserveer invite, login met Google en rond onboarding af.
3. Maak een Verbouwing en leg verschil uit tussen `private`, `followers`,
   `unlisted` en `public`.
4. Publiceer meerdere foto's als Bouwmoment, reorder/edit/delete en bekijk het
   Verhaal plus Voor & Na.
5. Volg openbaar; stuur/cancel/resend privéverzoek; accept/reject/remove/unfollow.
6. Block en unblock; bewijs dat access/follow niet terugkeert.
7. Reageer/comment, open Volgend/Connecties/notificatie en controleer privacy.
8. Maak een Bouwboek, include/exclude/reorder/layout, bekijk exact-PDF en keur de
   proof bewust goed.
9. Preview/test: controleer serverquote/seller/terms, Stripe Checkout,
   cancel/success/webhookstatus; gebruik alleen Stripe testmode.
10. Admin: gewone-user denial, paid queue, exact proof, handmatige statussen,
    tracking en refund review. Plaats geen echte drukkerorder.
11. Dien report/support/feedback in; doorloop moderation met synthetische tekst.
12. Revoke session, exporteer en vraag account-/Verbouwingverwijdering aan.

## Observatie

Vraag wat een actie doet, wie welke inhoud ziet, wat “proof goedkeuren” en
“betaald” betekenen, waar status vandaan komt en hoe fouten hersteld worden.
Let op terugstappen, privacytwijfel, misleidende successstates, focus/keyboard,
loading/error/retry, 390/768/1440 layout en lange/random invoer.

## Meting

Alleen allowlisted eventnaam, UTC, environment, pseudonieme test-/actor-ID,
routeklasse, resultaat, duurklasse en release. Verboden: naam/e-mail/adres,
caption/comment, media/PDF/Checkout-URL, token, vrije PII of providerpayload.

Onderzoeksdrempels:

- minimaal 80% voltooit login → Verbouwing → eerste Bouwmoment zonder hulp;
- minimaal 70% voltooit canonical follow/visibility en Bouwboekproof zonder
  blokkerende hulp;
- 100% kan zijn visibility en Stripe test/paymentstatus correct uitleggen;
- nul privacy/IDOR/block-, proof-, price/payment- of admin-RBAC-incident;
- nul onbehandelde P0/P1 of ernstige accessibilitybevinding.

Deze drempels zijn onderzoekscriteria, geen commerciële of releaseclaim.

## Go/no-go

NO-GO bij privacy/securityincident, data loss/corruptie, registration buiten
invite, visibility/blocklek, broken deletion, foutieve proof/prijs/betaling,
ongeautoriseerde adminactie, echte payment/drukkerorder, P0/P1, ernstige a11y of
ontbrekende moderation/supportdekking.

Automated Playwright heeft een afzonderlijke finale lokale matrix; dit plan
vereist daarnaast echte Previewproviders en de in-app Browser MCP-interactie.
Die runtime-aanvraag werd door de huidige Codex-gebruikslimiet geblokkeerd, dus
gebruikersonderzoek/Preview/productie zijn nog **NO-GO**.
