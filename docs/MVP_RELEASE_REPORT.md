# MVP release report

Peildatum: 23 augustus 2026.

## Besluit

| Doel | Besluit | Reden |
| --- | --- | --- |
| Lokale ontwikkel-/reviewcandidate | partieel geautomatiseerd groen, **NO-GO** als release | Typecheck, lint, Vitest, build, bundle en static-launch zijn groen. De huidige DB-integratie, dependency-audit, Playwrightuitvoering, hosted CI, interactieve browser, Preview en providers zijn niet bewezen. |
| Nieuwe Vercel Preview | **NO-GO** | Preview-env, deployment, providers, complete rolreizen en MCP-audit zijn niet bewezen. |
| Publieke feedbackbèta | **NO-GO** | Dezelfde technische gates plus legal/commercial/operations staan open. |
| Stripe test op Preview | **NO-GO** | De fail-closed testimplementatie bestaat, maar er is geen echte Preview Checkout/webhook-roundtrip vastgelegd. |
| Stripe live | **NO-GO** | Hosting, legal, price/seller, provider, Preview en releasegates staan open. |
| Handmatige printfulfilment | **NO-GO** voor echte orders | De beheerflow bestaat, maar providercontract, proefdruk en complete Preview-operatorreis zijn niet bewezen. |
| Peecho-API/automatisering | niet van toepassing | Bewust verwijderd uit de actieve MVP. |
| Productiedeployment | **NIET UITGEVOERD** | Geen production mutation of deployclaim in deze snapshot. |

## Release-identiteit

- branch: `sol/buildy-production-mvp`;
- documentatiesnapshot gebaseerd op HEAD
  `452cc74fd352970e24a844ee5171804fa4970dac` plus de ongecommitte gedeelde
  werkboom;
- bestaand pull request 1 hoort bij een ouder reviewpad en is geen review van
  de huidige branch/tree;
- gekoppeld Vercel-project: `buildy`;
- bestaand publiek adres: `https://buildy-gamma.vercel.app/`;
- nieuwe Preview van de geïntegreerde wijziging: niet aangemaakt of bewezen;
- productie-alias/config/data: door deze werkzaamheden niet gemuteerd.

Omdat de werkboom tijdens parallelle integratie veranderde, is een testresultaat
alleen geldig voor de SHA/tree waarop het werd uitgevoerd. Dit rapport verklaart
geen eerder resultaat automatisch geldig voor een latere eindtree.

## Geïmplementeerd productcontract

- Google OIDC Authorization Code + PKCE/state/nonce als enige login;
- opaque server-owned sessies met gehashte tokens in Neon en veilige cookies;
- typed same-origin API en server-side autorisatie;
- private Vercel Blob met begrensde upload en geautoriseerde delivery;
- request-driven verwerking van exact het completed media-asset en exact de
  aangevraagde Bouwboekrevisie, met leased/idempotente owner-poll retry en
  zonder media-/photobookcron;
- foto-first Verbouwing/Bouwmoment/Verhaal/Bouwboek-flow;
- één canoniek profiel-followmodel met privéverzoeken en block-revocation;
- projectvisibility `private`, `followers`, `unlisted` en `public`;
- owner-issued, high-entropy, expiring/revocable share links uitsluitend voor
  `unlisted`, met fragment→body redemption, gehashte opslag en signed link-ID-
  cookie;
- expliciete camera- en bibliotheekingang, desktop dropzone, multifoto-preview,
  reorder/remove, lokale duplicate-waarschuwing en per-image progress/retry;
- locked, gehashte printproof en server-owned prijs/seller/terms;
- Stripe-hosted Checkout en geverifieerde idempotente webhook;
- buyer orderlijst/detail en typed product-/orderstatusnotificaties zonder PII
  in payloads of dedupekeys;
- admin-RBAC, handmatige fulfilmentqueue en admin-only feedbackreview met
  metadata-only queue en detaildecryption op selectie;
- account lifecycle, moderatie, feedback en support zonder e-mailprovider;
- append-only retirement van actieve Better Auth-, R2-, Brevo-, Peecho- en
  project-social runtimepaden.

Historische databaseobjecten en migrations blijven bestaan. Zij zijn geen
tweede actief product- of providercontract.

## Vastgelegde automatische evidence

De huidige lokale geautomatiseerde snapshot legt het volgende vast:

- de productie-previewbuild slaagde;
- de repositorybrede Vitest-run passeerde **145 bestanden / 933 tests**; de 18
  expliciete PostgreSQL-bestanden / 27 tests werden zonder disposable database
  overgeslagen en zijn niet als groen geclaimd;
- de append-only ledgercheck valideerde **49 migrations** door
  `0049_product_notifications.sql`; er was geen huidige migration apply/replay,
  rol-/RLS-verificatie of `db/verify` tegen een verse PostgreSQL;
- de build/bundlecheck rapporteerde 71 JavaScriptchunks en één CSS-chunk,
  **1157,4 KiB raw / 364,4 KiB gzip**, binnen budget;
- static launch passeerde **9/9** controles, inclusief 389/406 source scans,
  retired-path absence, fail-closed Vercelconfig, 49 migrations en 147
  bereikbare productiemodules zonder dode module;
- de huidige Playwrightconfiguratie inventariseerde **205 tests**
  (69/34/34/34/34), zonder `skip`/`fixme`/`only`; geen ervan werd uitgevoerd;
- gerichte server-, social-, account-, payment-, Blob-, migration- en RLS-
  regressies zijn in de QA-evidence vastgelegd.

De harde CI-databasejob bevat exact alle **18** huidige integratiebestanden,
inclusief share links, feedbackreview, productnotificaties en request-hash
replay. Die volledigheid is statisch gecontroleerd; uitvoering blijft open.
De netwerkdependency-audit kon in de sandbox niet verbinden en de verplichte
escalatie werd door de huidige Codex-gebruikslimiet afgewezen. De officiële
packagebronnen tonen inmiddels `openid-client` 6.8.7 als actuele stabiele
patch; de tree blijft op ondersteunde v6-pin 6.8.4 omdat ook die registryupdate
werd afgewezen. Er is geen handmatige lockfileclaim gemaakt.

Dit is lokale geautomatiseerde evidence, geen interactieve, hosted CI-, Preview-,
provider- of productie-evidence. De tree kreeg na deze run nog documentatie;
een release moet de definitieve SHA daarom opnieuw aan de verplichte hosted en
Previewgates binden. Er is nog geen volledige GitHub Actions-run in dit rapport.

Zie [QA_FUNCTION_MATRIX.md](QA_FUNCTION_MATRIX.md) voor de fijnmazige status en
[PLAYWRIGHT_MCP_AUDIT.md](PLAYWRIGHT_MCP_AUDIT.md) voor de scheiding tussen
automated en interactief bewijs.

## Harde open blokkades

### Interactieve browser

De verplichte in-app Playwright MCP-runtime kon niet worden gestart. De laatste
runtime/tool-aanvraag werd door de huidige Codex-gebruikslimiet afgewezen tot
**2026-08-29 02:26**; een eerdere enumeratie in dezelfde werkstroom leverde
geen browsertool op.

Daarom is geen enkele route, rol, view, control, form, history-, keyboard-,
responsive-, console- of networkreis interactief geverifieerd. Automated
Playwright vervangt deze gate niet.

### Preview en providers

- geen nieuwe geïntegreerde Vercel Preview;
- de gecontroleerde Vercel Preview-environment bevatte geen van de vereiste
  actieve waarden;
- geen echte Google OIDC redirect/callback/sessionjourney;
- geen echte private Blob upload/read/revoke/delete-journey;
- geen Stripe test Checkout/webhook/refund-roundtrip;
- geen complete owner/follower/private-request/block/admin/buyer role fixtures;
- geen echte Preview admin-order/manual-fulfilment- en providerjourney;
- geen volledige synthetic-data cleanup op een nieuwe Preview.

### Commercial, legal en operations

- het gekoppelde Vercel-team stond bij controle op Hobby; live commercieel
  gebruik en de vereiste contractuele/DPA-basis zijn niet goedgekeurd;
- juridische identiteit, actuele verkoopvoorwaarden, privacy/providerrollen en
  supportcontact zijn niet als compleet goedgekeurd bewezen;
- test- en live-prijsmatrix, seller-envelope en btw-/verzendbesluit ontbreken
  als echte approvals;
- handmatige drukkerkeuze, overeenkomst, actuele productquote, proefdruk,
  landen, levertijd, refund- en escalatiepad zijn niet afgetekend;
- productiebackups/recovery, alerting, budgetten, account-cron- en
  request-processingmonitoring en release-eigenaarschap zijn niet bewezen.

## Vereiste vervolgstap

Volg [OPERATOR_ACTIONS_REQUIRED.md](OPERATOR_ACTIONS_REQUIRED.md), maak daarna
een geïsoleerde Preview en voer [PRODUCTION_RELEASE.md](PRODUCTION_RELEASE.md)
vanaf Fase 0 uit. Geef alleen een nieuw releasebesluit voor één vastgezette
commit met echte, herhaalbare evidence. Tot die tijd blijft productie **NO-GO**.
