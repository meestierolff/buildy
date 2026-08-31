# Launch readiness

Peildatum: 23 augustus 2026. Besluit: **NO-GO** voor nieuwe Previewrelease,
publieke feedbackbèta, echte betaling/drukorder en productie.

Dit document is een gateoverzicht, geen testlog. Zie
[MVP_RELEASE_REPORT.md](MVP_RELEASE_REPORT.md) voor vastgelegde evidence en
[OPERATOR_ACTIONS_REQUIRED.md](OPERATOR_ACTIONS_REQUIRED.md) voor eigenaarschap.

## Technische gates

- [ ] finale geïntegreerde SHA/PR vastgezet en volledige GitHub `CI gate` groen;
- [x] statische append-only ledgercheck: 49 migrations geldig door `0049`;
- [ ] actuele ledger op lege PostgreSQL toepassen en replayen; vijf rollen,
  `db/verify` en alle 18 DB-integratiebestanden/27 tests groen;
- [ ] nul verplichte testskips en alle P0/P1-regressies groen;
- [x] huidige typecheck, lint, 145 bestanden/933 niet-DB-tests, build, bundle en
  9/9 static-launch groen;
- [ ] netwerkdependency-audit groen; lokale netwerktoegang en escalatie waren
  door sandbox/Codex-quota geblokkeerd;
- [ ] gecontroleerde stabiele `openid-client` 6.8.7 via de registry installeren
  en locken; huidige ondersteunde v6-pin is 6.8.4 omdat de download quota-
  geblokkeerd was;
- [ ] huidige lokale productie-previewmatrix uitvoeren; alleen 205 tests zijn
  geïnventariseerd (69/34/34/34/34), zonder `skip`/`fixme`/`only`;
- [ ] dezelfde browser-/viewportdekking groen in hosted CI en op de vastgezette
  Preview-SHA;
- [ ] complete owner/follower/private requester/block/moderator/admin/buyer
  synthetic fixtures en rolreizen groen;
- [ ] in-app Browser MCP-interactieve audit groen.

De laatste gate is hard geblokkeerd: de vereiste runtime/tool-aanvraag werd door
de huidige Codex-gebruikslimiet afgewezen tot **2026-08-29 02:26**.

## Preview- en providergates

- [ ] nieuwe Vercel Preview van exact de release-SHA;
- [ ] gescheiden, complete Previewenvironment met `APP_ENV=staging`,
  `PRODUCT_PROFILE=feedback_beta`, `CHECKOUT_MODE=test`; de gecontroleerde
  Previewenvironment was leeg;
- [ ] Neonrollen, health/readiness en recoverybewijs;
- [ ] echte Google OIDC callback/session/logout;
- [ ] private Vercel Blob upload/read/denial/delete;
- [ ] Stripe test Checkout/webhook/failure/replay/refund;
- [ ] locked proof, adminorderqueue en volledige handmatige fulfilmenttest;
- [ ] synthetische data/providerresources veilig opgeruimd.

## Product- en privacygates

- [ ] belofte en foto→Bouwmoment→Verhaal→Bouwboek-loop begrijpelijk;
- [ ] één canonical profile follow/private request en block-revocation;
- [ ] `private`, `followers`, `unlisted`, `public` zonder lek;
- [ ] `unlisted` high-entropy share-link lifecycle: fragment scrub, body-only
  redemption, hash-only opslag, signed-cookie toegang, expiry/rotate/revoke;
- [ ] Google-only auth en geen zichtbare password/e-mailflow;
- [ ] geen publieke/signed media-URL, PII-log of client-owned capability/pricing;
- [ ] support, feedback, admin-only feedbackreview, report, moderation, export
  en deletion bruikbaar; feedback-PII gewist bij accountverwijdering;
- [ ] first-publish- en orderstatusnotificaties exact, toegangsgevoelig en
  zonder PII in payload of dedupekey;
- [ ] exact-PDF/hash en alleen webhook-owned paymentstatus.

## Commercial, legal en operations

- [ ] Vercel-plan/voorwaarden en waar vereist DPA commercieel geschikt; huidige
  controle was Hobby;
- [ ] echte juridische identiteit, terms, privacy, herroeping, contentbeleid en
  supportcontact goedgekeurd;
- [ ] actuele test/live price- en sellerapprovals plus tax/shippingbesluit;
- [ ] drukkercontract/providerrol, productquote, proefdruk, landen, levertijd,
  MFA, fulfilment/refund/incidentproces goedgekeurd;
- [ ] backups, retentie, alerts, budgets, on-call, de account-lifecyclecron en
  request-driven media-/proofmonitoring bewezen;
- [ ] release-, legal-, privacy-, support- en fulfilmenteigenaars tekenen af.

## Modecontract

- `off`: checkout fail-closed; alleen bewust gesloten lokaal/incidentpad;
- `test`: verplicht voor Preview en geautomatiseerde betaaltests;
- `live`: pas na alle gates, met afzonderlijke live credentials/approvals.

Geen incomplete/mismatched mode mag een checkoutcapability publiceren. Een
bestaand openbaar Vercel-adres, groene build of Stripe-key is geen GO.

## Production

Production mag pas worden gemuteerd volgens
[PRODUCTION_RELEASE.md](PRODUCTION_RELEASE.md) nadat alle vakken groen en aan één
SHA gebonden zijn. In deze snapshot is geen nieuwe Preview of production deploy,
alias-, environment-, database-, Stripe- of providerwijziging uitgevoerd.
