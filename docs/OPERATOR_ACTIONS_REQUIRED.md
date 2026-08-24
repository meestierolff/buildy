# Vereiste operatoracties

Status: alle vakken staan open totdat bewijs aan één vastgezette releasecommit
is gekoppeld. Dit bestand bevat geen secretwaarden.

## 1. Eigenaarschap en commercieel hostingbesluit

- [ ] Wijs release-, privacy/security-, legal/commercial-, support/refund- en
  fulfilmenteigenaars aan.
- [ ] Bevestig het exacte Vercel-project/team en wie Production mag muteren.
- [ ] Upgrade of verplaats het gekoppelde Vercel Hobby-project naar een plan en
  contract dat het beoogde commerciële gebruik, functies, crons, Blob,
  observability en support aantoonbaar toestaat.
- [ ] Sluit waar vereist de toepasselijke Vercel DPA af; het gecontroleerde
  Hobby-account levert hiervoor geen voldoende production/commercial bewijs.
- [ ] Leg plan, approver, datum, budgetlimieten en facturatie-alerts vast zonder
  account- of betaalgegevens in de repository te zetten.

Blokkeert: live Stripe, publieke verkoop en productie-GO.

## 2. Juridische identiteit en productteksten

- [ ] Laat juridische entiteit, handelsnaam, registratienummer, btw-positie,
  vestigingsadres en bevoegdheid om te verkopen goedkeuren.
- [ ] Leg een echt supportcontact vast in de seller-envelope en zichtbare
  juridische/supportteksten. Er is geen losse `SUPPORT_EMAIL`-envvariabele.
- [ ] Laat voorwaarden, privacy, herroeping/maatwerk, contentbeleid, huisregels,
  klachten, refunds, levering, bewaartermijnen en provider-/verwerkersrollen
  beoordelen voor de werkelijke landen en doelgroep.
- [ ] Controleer dat iedere footer-, checkout-, order-, report-, support- en
  accountverwijderingslink dezelfde goedgekeurde informatie toont.

Buildy heeft geen transactionele e-mailprovider. Een supportmailbox/contact is
geen toestemming om Brevo of een andere mailruntime toe te voegen.

Blokkeert: publieke bèta, checkout en productie-GO.

## 3. Neon database, rollen en recovery

- [ ] Kies en documenteer Preview- en Production-project/branch, EU-regio,
  DPA, backupretentie, point-in-time recovery en restore-oefening.
- [ ] Maak unieke TLS-credentials voor migrator, web, accountworker,
  mediaworker, photobookworker en paymentworker.
- [ ] Plaats per Vercel environment de juiste `DATABASE_URL`,
  `DATABASE_DIRECT_URL`, worker-URL's en uitsluitend voor operators/CI
  `DATABASE_MIGRATION_URL`.
- [ ] Pas de actuele append-only ledger op een clean room toe; configureer en
  verifieer rollen; voer `db/verify.ts` uit; bewijs een idempotente replay.
- [ ] Herhaal dat op een productieachtige kopie en leg een recovery point vast
  vóór de uiteindelijke productiemigration.

Nooit database-URL's op de commandoregel, in screenshots of in logs publiceren.
Blokkeert: Preview en productie.

## 4. Data protection, retentie en crons

- [ ] Genereer unieke Preview- en Productionwaarden voor
  `PII_ENCRYPTION_KEYS`, `PII_ENCRYPTION_CURRENT_VERSION` en
  `PII_BLIND_INDEX_KEY`; leg rotatie en recovery buiten de repository vast.
- [ ] Laat `ACCOUNT_RETENTION_POLICY_VERSION` en
  `ACCOUNT_RETENTION_POLICY_APPROVED_AT` aansluiten op de juridisch
  goedgekeurde retentie.
- [ ] Genereer per environment een uniek `CRON_SECRET` van minimaal 32 tekens,
  uitsluitend voor account lifecycle.
- [ ] Bevestig en monitor de enige schedule uit `vercel.json`: dagelijkse
  account lifecycle via `GET /api/internal/cron/account-lifecycle`.
- [ ] Bewijs dat media-completion het exacte asset en een Bouwboekproofrequest
  de exacte revisie verwerkt onder de eigen workerrol; test begrensde
  owner-polling, retry, leaseverlies en fail-closed fouten.
- [ ] Test accountdeletion/export, Blob-opruiming, orphan cleanup, printproof-
  retentie en herstel bij workerfailure.

Er zijn geen media-, photobook-, e-mail- of Peecho-crons. Media en Bouwboek
vereisen wel hun least-privilege worker-DB-URL en private Blob, maar niet
`CRON_SECRET`. Blokkeert: Preview en productie.

## 5. Google OpenID Connect

- [ ] Maak of controleer afzonderlijke Google webclients/configuratie voor het
  stabiele Preview/stagingdoel en Production.
- [ ] Configureer de exacte HTTPS-origins en callback
  `/api/auth/callback/google`; sta geen wildcard of willekeurige Preview-origin
  toe.
- [ ] Plaats `GOOGLE_CLIENT_ID` en `GOOGLE_CLIENT_SECRET` uitsluitend in de
  overeenkomstige Vercel environment.
- [ ] Controleer consent screen, appnaam, toegestane domeinen, contact- en
  privacyinformatie.
- [ ] Bewijs redirect, PKCE/state/nonce callback, new/existing user, logout,
  revocation, verlopen sessie en veilige `next` op Preview.

Er is geen wachtwoord-, magic-link-, verificatie-, reset- of e-maillogin en geen
`SESSION_SECRET`. Blokkeert: Preview, publieke bèta en productie.

## 6. Private Vercel Blob

- [ ] Maak per omgeving een private Blob-store en bevestig in het Vercel-
  dashboard dat access `private` is.
- [ ] Plaats het juiste `BLOB_READ_WRITE_TOKEN` alleen in die environment; leg
  rotatie, regio/DPA, budget en incidentrespons vast.
- [ ] Bewijs op Preview begrensde upload, content-check, completion, SHA-256/
  bytegrootte, geautoriseerde same-origin read, denial voor outsider/block,
  delete en cleanup.
- [ ] Controleer dat geen publieke of permanente signed customer-media-URL in
  data, logs, HTML, evidence of cache terechtkomt.

Cloudflare R2 en AWS S3 zijn niet actief. Blokkeert: media-, Bouwboek- en
productierelease.

## 7. Stripe test en live

- [ ] Wijs het echte Buildy Stripe-account aan en leg test/live account-ID's,
  businessdetails, payout-/refundrechten, taxbesluit en operator-MFA vast.
- [ ] Configureer Preview met `CHECKOUT_MODE=test`, `STRIPE_ENVIRONMENT=test`,
  `sk_test_…`, een eigen `whsec_…` en exact `acct_…`.
- [ ] Registreer `POST /api/webhooks/stripe` en alleen de eventtypen uit
  [STRIPE_SETUP.md](STRIPE_SETUP.md).
- [ ] Bewijs quote, gehoste Checkout, success/cancel, geldige en ongeldige
  webhook, async success/failure, expiry, duplicate replay en refund in Preview.
- [ ] Maak voor Production afzonderlijke live secrets en webhook klaar, maar
  activeer `live` niet vóór de volledige release-GO.

Blokkeert: Preview betaalbewijs, verkoop en productie.

## 8. Prijs, seller en voorwaarden

- [ ] Laat per toegestaan land echte basisprijs, extra pagina, verzending,
  extra exemplaar, btw-behandeling, levertijd en productreferentie goedkeuren.
- [ ] Maak afzonderlijke `test`- en `live`-envelopes voor
  `ORDER_PRICE_MATRIX_JSON`; gebruik actuele `approvedAt`/`expiresAt` en een
  herleidbare `commercialApprovalId`.
- [ ] Maak overeenkomstige, actuele `ORDER_SELLER_JSON`-envelopes met de
  juridisch goedgekeurde sellergegevens.
- [ ] Stel `ORDER_TERMS_VERSION` in op exact de tekst die bij checkout wordt
  geaccepteerd en archiveer de goedkeuring buiten secrets/config.
- [ ] Oefen het fail-closed pad voor ontbrekende, verlopen, verkeerde-environment
  of gewijzigde config.

De client bepaalt geen bedragen, btw, verzending of seller. Blokkeert: iedere
Stripe Checkout.

## 9. Handmatige drukkerfulfilment

- [ ] Kies de drukker en leg contract, verwerkersrol, toegang, MFA, landen,
  formaat, paginagrenzen, bestandseisen, actuele quote, levertijd, retentie en
  escalatie vast.
- [ ] Bestel en beoordeel een proefdruk met synthetische data.
- [ ] Wijs minimaal de orderoperator, tweede controle en refundbeslisser aan.
- [ ] Geef alleen de juiste founder een server-side `admin`-grant via het
  gecontroleerde migration-ownerproces; test gewone-user denial.
- [ ] Doorloop op Preview exact-PDF-download, review, handmatige externe order,
  productie, shipment/tracking, completion, manual review, cancel en refund.
- [ ] Leg support-/incident-SLA en provideraccount-offboarding vast.

Voeg geen Peecho API-key of `PEECHO_*` env toe. Er is geen automatische quote,
order, callback, worker of polling. Zie
[MANUAL_PEECHO_FULFILMENT.md](MANUAL_PEECHO_FULFILMENT.md).

Blokkeert: echte betaalde order en productie.

## 10. Preview environment en providerchecks

- [ ] Maak een stabiele, afgeschermde Vercel Preview/stagingdeployment van één
  vastgezette SHA.
- [ ] Configureer alle actieve waarden uit [`.env.example`](../.env.example)
  voor die environment. Gebruik voor het staging providercheck-contract
  `APP_ENV=staging`, een exacte `APP_ORIGIN`, `PRODUCT_PROFILE=feedback_beta`,
  `BETA_MODE=true` en `CHECKOUT_MODE=test`.
- [ ] Controleer domains, TLS, security headers, CSP, redirects, de ene
  account-lifecyclecron en
  afzonderlijke Preview/Production secret scope.
- [ ] Voer met de geladen, niet-gelogde omgeving uit:

```sh
bun run setup:providers -- --staging --check
```

- [ ] Leg ieder pass/fail/manual resultaat vast, los alle fails op en herhaal.

Er is nog geen geïntegreerde Previewconfiguratie of deploymentbewijs. Blokkeert:
alle externe en productiegates.

## 11. CI, browsers en rolfixtures

- [ ] Laat de volledige GitHub Actions-gate groen lopen op de vastgezette SHA,
  inclusief dependency audit, build/bundle/launch, migrations/RLS, actieve DB-
  integratie en zero-skip Playwrightjobs.
- [ ] Werk met toegestane registrytoegang de gecontroleerde `openid-client`
  patchrelease van de huidige pin `6.8.4` naar de actuele stabiele `6.8.7` bij,
  commit de echte Bun-lockfile en herhaal auth/type/test/audit. De lokale
  download/escalatie werd door de Codex-gebruikslimiet afgewezen; wijzig de
  lockfile niet handmatig.
- [ ] Voer de huidige lokale productie-previewmatrix uit. Alleen de inventaris
  is bewezen: **205 tests**, verdeeld als Chromium desktop 69 en 34 elk voor
  Firefox, WebKit, mobile Chromium en tablet Chromium. De sandboxpoort en daarna
  de benodigde escalatie waren geblokkeerd; er is geen huidige passclaim.
- [ ] Voer exact die volledige matrix uit in hosted CI en tegen de vastgezette
  Preview-SHA.
- [ ] Provision synthetische, PII-arme fixtures voor new user, owner, public
  follower, private requester, blocked pair, moderator/admin en buyer/order.
- [ ] Doorloop alle P0/P1-reizen uit [QA_FUNCTION_MATRIX.md](QA_FUNCTION_MATRIX.md)
  op dezelfde Preview.
- [ ] Ruim synthetische provider-, Blob-, Stripe- en databaseresources veilig op
  en bewijs dat echte data niet is geraakt.

Blokkeert: release-GO.

## 12. Verplichte Playwright MCP-audit

- [ ] Herstel een beschikbare in-app-browserruntime. De laatste runtime/tool-
  aanvraag werd door de Codex-gebruikslimiet afgewezen tot **2026-08-29 02:26**;
  een eerdere enumeratie in dezelfde werkstroom leverde geen browsertool op.
- [ ] Voer de vier contexten uit: bestaand doel, lokale productiebuild, nieuwe
  Preview en — pas na alle eerdere GO's — de niet-destructieve production smoke.
- [ ] Controleer iedere route, rol, link, control, form, back/forward/reload,
  toetsenbord/focus, loading/error, 390/768/1440 layout, console, pageerror,
  netwerk en 5xx.
- [ ] Koppel echte bevindingen aan regressietests en artifacts; fabriceer geen
  screenshot-, trace- of interactieve claim.

Automated Playwright is geen vervanging. Zolang de vereiste runtime niet
beschikbaar en volledig doorlopen is, blijven Preview en productie **NO-GO**.

## 13. Production change approval

- [ ] Laat alle bovenstaande evidence reviewen en expliciet goedkeuren tegen één
  SHA en één releasevenster.
- [ ] Controleer productionbackup/recovery point, rollback, monitoring, budgets,
  on-call en incidentcommunicatie.
- [ ] Configureer pas daarna exact `APP_ENV=production`, `PRIMARY_DOMAIN`,
  `CHECKOUT_MODE=live`, `STRIPE_ENVIRONMENT=live` en alle afzonderlijke live
  approvals/secrets.
- [ ] Volg [PRODUCTION_RELEASE.md](PRODUCTION_RELEASE.md) zonder de smoke uit te
  breiden naar een echte betaling of drukkerorder zonder aparte toestemming.

Huidige status: **NO-GO**. Deze documentatiewijziging heeft geen
productionconfig, data, deployment, alias, Stripe-order of drukkerorder gemuteerd.
