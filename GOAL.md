# Buildy production relaunch

## Doelstelling

Transformeer de bestaande Buildy-repository via een bewezen migratiepad van het huidige prototype naar een oorspronkelijke, production-grade en privacy-first sociale verbouwingsapp. Alle code-, ontwerp-, database-, security-, test- en deploymenttaken uit de aangehechte productspecificatie worden uitgevoerd en aantoonbaar geverifieerd. Werk door totdat alleen externe blokkades resteren die niet met code of beschikbare tooling kunnen worden opgelost.

## Actuele fase

Fase 0 — veilige repository-inventarisatie, baseline en verplichte auditdocumenten afronden.

## Afgeronde taken

- Bestaande Git-status gecontroleerd: de repository was schoon op `main`.
- Werkbranch `codex/buildy-production-relaunch` aangemaakt.
- Duurzame Codex-goal geregistreerd.
- Dit voortgangsbestand aangemaakt.
- Volledige productspecificatie (1.996 regels) gelezen en harde launchgrenzen vastgelegd.
- Bestaande lokale baseline uitgevoerd voor typecheck, lint, unit tests, build en Playwright.
- Ontbrekende officiële Playwright Chromium-runtime geïnstalleerd.
- 102 baseline-screenshots vastgelegd voor lokaal en live, op 390×844, 768×1024 en 1440×1000, met manifest in `artifacts/baseline/`.
- Publieke live referentie read-only gecontroleerd: HTTP 200, maar de headless render bleef leeg op de Lovable-badge na.
- Actuele officiële documentatie voor Neon Auth/Drizzle, Vercel Functions en private Cloudflare R2-presigned URLs geraadpleegd.
- Frontend/productaudit afgerond; 49 bestaande en vereiste flows zijn in een feature-paritymatrix gezet.
- Backend/securityaudit afgerond over circa 62 legacy SQL-migraties, 24 effectieve tabellen, policies/RPC's/triggers, vier storagegebieden en zes Edge Functions.
- Operations-/test-/deploymentaudit afgerond en vastgelegd in `docs/CURRENT_STATE_AUDIT.md`.
- Designnulmeting en concrete redesignacceptatie vastgelegd in `docs/DESIGN_AUDIT.md`.
- Implementatielog gestart in `docs/IMPLEMENTATION_LOG.md`.

## Volgende taken

- Architectuur-ADR afronden en auditbaseline als afzonderlijke commit vastleggen.
- Gefaseerde productiearchitectuur, privacy/security en productflows implementeren.
- Unit-, integratie-, E2E-, toegankelijkheids- en securitychecks toevoegen en herstellen.
- Stagingconfiguratie valideren en, bij aanwezige providercredentials, gecontroleerd deployen.

## Teststatus

- Baseline typecheck: **PASS** — exit 0.
- Baseline lint: **PASS met schuld** — exit 0, 0 errors en 149 waarschuwingen voor expliciete `any`-types.
- Baseline unit tests: **PASS** — exit 0, 60 tests geslaagd.
- Baseline build: **PASS met waarschuwingen** — exit 0; dynamische sitemapfetch niet bereikbaar, verouderde Browserslist-data en te grote chunks.
- Baseline Playwright eerste sandboxpoging: **ENVIRONMENT FAIL** — lokale poort mocht niet luisteren.
- Baseline Playwright vóór browserinstallatie: **ENVIRONMENT FAIL** — Chromium executable ontbrak.
- Baseline Playwright na browserinstallatie: **PRODUCT FAIL** — exit 1; 26 geslaagd, 5 auth-afhankelijk overgeslagen, 1 bestaande failure: medialightbox opent niet in de publieke projecttest.
- Visuele baseline: **CAPTURED** — 102/102 screenshots, geen capturefailures. Authenticated/owner-only bewijs ontbreekt omdat geen veilige synthetische storage state of testcredentials beschikbaar waren.
- Security dependencybaseline: **FAIL** — `bun audit` exit 1 met 53 advisories (1 critical, 25 high, 22 moderate, 5 low).
- Legacy launchcheck: **FAIL** — exit 1; 10/13 controles groen, publiek domein/Google niet bereikbaar en orderschemaprobe HTTP 400.
- Legacy private-asset-/socialaudit: **BLOCKED** — beide exit 2 door ontbrekende afgeschermde service-role credential; geen data gewijzigd.

## Externe blokkades

- Geen veilige synthetische login/storage state beschikbaar voor de bestaande Supabase-baseline; owner-only screenshots en tests konden niet werkelijk ingelogd worden bewezen.
- Live Lovable-referentie geeft HTTP 200 maar rendert in headless Chromium uitsluitend een lege pagina met providerbadge.
- Neon, R2, Brevo, Stripe en Peecho accountwaarden/credentials worden nog geïnventariseerd; niets wordt verondersteld of gelogd.
- Legacy live catalogus, storageobjecten en sociale integriteit konden zonder service-role credential niet volledig worden geëxporteerd; schemafiles zijn daarom niet als live waarheid behandeld.

## Belangrijke architectuurbesluiten

- Geen big-bang rewrite: waardevolle bestaande productlogica blijft behouden en wordt gefaseerd gemigreerd.
- Privacy en server-side autorisatie zijn harde productgrenzen; client-side verbergen geldt niet als beveiliging.
- Productiebetalingen, printorders en destructieve productiedatamigraties blijven uit totdat hun launchgates aantoonbaar groen zijn.
- Onafgemaakte functionaliteit wordt volledig afgemaakt of via een server-side featureflag onzichtbaar gehouden.
- React/Vite blijft behouden; Vercel ondersteunt voor een frameworkloze Vite-app officiële TypeScript Functions vanuit de rootmap `api/`.
- Cloudflare R2 blijft volledig privé; presigned URLs zijn kortlevende bearer tokens en browseruploads vereisen exact-origin CORS.
- Drizzle gebruikt versioned SQL-migraties als source of truth; `push` is niet het productie-cutovermechanisme.
- Bewezen legacylogica voor order-idempotentie, Stripe-signatures, Peecho create/payment-scheiding, monotone states en deletion locks wordt geport, maar permissieve RLS en URL-/storagecoupling niet.
- Een checkout krijgt uitsluitend een immutable, content-addressed en opnieuw gehashte goedgekeurde PDF-revisie; browser/eigenaar kan de fulfilmentbytes na approval niet wijzigen.
