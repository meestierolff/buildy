# Vereiste operatoracties

Deze checklist geldt voor de canonieke Buildy production-MVP. Koppel bewijs aan
één volledige release-SHA en zet nooit secrets of persoonsgegevens in de
repository, logs of screenshots.

## 1. Releasekandidaat en Vercel

- [ ] Leg de volledige release-SHA, verantwoordelijke en rollbackbeslissing vast.
- [ ] Gebruik één bekend Vercel-project met gescheiden Preview- en
  Production-environments.
- [ ] Controleer domains, TLS, securityheaders en environment-scoping.
- [ ] Stel overal `PRODUCT_PROFILE=feedback_beta` en `BETA_MODE=false` in.
- [ ] Gebruik lokaal `CHECKOUT_MODE=off`, in Preview/staging exact `test` en in
  Production pas na alle gates exact `live`; laat iedere incomplete mode
  fail-closed.
- [ ] Laat Vercel installeren met de lockfile en bouwen met typecheck plus build.

## 2. Neon en databescherming

- [ ] Gebruik afzonderlijke Preview- en Production-databases of -branches met
  backups en een geoefend herstelpad.
- [ ] Maak unieke TLS-rollen voor migraties, web-runtime, accountworker,
  mediaworker, photobookworker en paymentworker.
- [ ] Configureer `DATABASE_URL`, `DATABASE_ACCOUNT_WORKER_URL` en
  `DATABASE_MEDIA_WORKER_URL` per environment; configureer in Preview/staging en
  live Production daarnaast `DATABASE_PHOTOBOOK_WORKER_URL` en
  `DATABASE_PAYMENT_WORKER_URL`.
- [ ] Houd `DATABASE_MIGRATION_URL` en `DATABASE_DIRECT_URL` buiten de
  web-runtime en gebruik ze alleen voor gecontroleerde operatoracties.
- [ ] Pas de append-only migrations toe en voer `bun run db:verify` uit tegen
  een tijdelijke of expliciet gekozen database.
- [ ] Genereer unieke `PII_ENCRYPTION_KEYS`,
  `PII_ENCRYPTION_CURRENT_VERSION` en `PII_BLIND_INDEX_KEY`; bewaar rotatie- en
  recoveryinformatie buiten de repository.

## 3. Google OpenID Connect

- [ ] Configureer afzonderlijke Google-webclients voor de stabiele Preview en
  Production.
- [ ] Registreer alleen exacte HTTPS-origins en de callback
  `/api/auth/callback/google`; gebruik geen wildcards.
- [ ] Plaats `GOOGLE_CLIENT_ID` en `GOOGLE_CLIENT_SECRET` uitsluitend in de
  juiste Vercel-environment.
- [ ] Test nieuwe en bestaande gebruiker, veilige callback, logout, verlopen
  sessie en accountverwijdering.

Google is de enige loginmethode. Configureer geen wachtwoord-, magic-link- of
e-mailauthenticatie.

## 4. Private Vercel Blob

- [ ] Maak per environment een private Blob-store en configureer het juiste
  `BLOB_READ_WRITE_TOKEN`.
- [ ] Test upload, completion, geautoriseerde same-origin read, weigering voor
  een outsider, verwijderen en orphan cleanup.
- [ ] Controleer dat customer-media niet via een publieke of permanente
  object-URL in HTML, data, logs of caches terechtkomt.

Het digitale Bouwboek gebruikt de web-runtime en private Blob. Proofgeneratie
voor checkout gebruikt daarnaast de geïsoleerde photobookworker; er is geen
automatische printworker of printproviderintegratie.

## 5. Dagelijkse account lifecycle

- [ ] Keur een retentieversie en ingangsdatum goed en configureer
  `ACCOUNT_RETENTION_POLICY_VERSION` en
  `ACCOUNT_RETENTION_POLICY_APPROVED_AT`.
- [ ] Genereer per environment een uniek `CRON_SECRET` van minimaal 32 tekens.
- [ ] Controleer de enige schedule uit `vercel.json`:
  `GET /api/internal/cron/account-lifecycle` om `02:17 UTC`.
- [ ] Test begrensde export-, verwijder- en cleanupverwerking onder de aparte
  accountworkerrol en monitor failures zonder PII te loggen.

Er zijn geen media-, Bouwboek-, e-mail- of providercrons.

## 6. Previewbewijs

- [ ] Deploy exact de vastgezette SHA naar een stabiele Preview-origin.
- [ ] Doorloop landing, lokaal fotovoorbeeld en Google-login.
- [ ] Maak een verbouwing aan en bevestig dat die standaard privé is.
- [ ] Upload een foto, publiceer een Bouwmoment en controleer het Verhaal.
- [ ] Maak en trek een deellink in; controleer anonieme alleen-lezen toegang en
  reageren na inloggen.
- [ ] Controleer cover, indeling, volgorde en inhoudsselectie in het digitale
  Bouwboek.
- [ ] Genereer en keur een exact proof goed; bewijs een server-owned quote,
  Stripe-testcheckout, geverifieerde webhook, paid order en handmatige
  beheerqueue zonder een echte drukkerorder te plaatsen.
- [ ] Verstuur algemene feedback en printinteresse en controleer de ontvangst.
- [ ] Controleer primaire navigatie, toetsenbord/focus, fouten en console op
  mobiel en desktop in Chromium, Firefox en WebKit.
- [ ] Laat de volledige geautomatiseerde verificatieset groen eindigen.

## 7. Productievrijgave

- [ ] Controleer privacy-, voorwaarden-, herroepings- en supportteksten voor de
  dienst en het gepersonaliseerde betaal-/maatwerkpad.
- [ ] Controleer de actuele price-/seller-/termsapprovals, Stripe-liveconfig en
  het goedgekeurde handmatige fulfilmentproces zonder een echte order te maken.
- [ ] Review Previewbewijs, databaseherstel, monitoring en rollback tegen
  dezelfde SHA.
- [ ] Deploy exact die SHA en voer een niet-destructieve smoke uit voor landing,
  auth, private media, delen, digitaal Bouwboek en feedback.
- [ ] Ruim synthetische accounts, media en feedback gecontroleerd op.

## Niet configureren voor deze MVP

- Peecho of een andere automatische druk-/fulfilmentprovider;
- een automatische printworker, providercallback of fulfilmentcron;
- transactionele e-mail of een AI-provider.

Stripe, server-owned prijzen/seller/terms en de payment- en photobookworker zijn
wel actief in `test`/`live`; met `CHECKOUT_MODE=off` moeten zij fail-closed en
onzichtbaar blijven. Historische Peecho-/e-mailruntime blijft dormant.
