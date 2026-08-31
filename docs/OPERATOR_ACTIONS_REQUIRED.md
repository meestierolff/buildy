# Vereiste operatoracties

Deze checklist geldt voor de eenvoudige, gratis Buildy-MVP. Koppel bewijs aan
één volledige release-SHA en zet nooit secrets of persoonsgegevens in de
repository, logs of screenshots.

## 1. Releasekandidaat en Vercel

- [ ] Leg de volledige release-SHA, verantwoordelijke en rollbackbeslissing vast.
- [ ] Gebruik één bekend Vercel-project met gescheiden Preview- en
  Production-environments.
- [ ] Controleer domains, TLS, securityheaders en environment-scoping.
- [ ] Stel overal `PRODUCT_PROFILE=feedback_beta`, `BETA_MODE=false` en
  `CHECKOUT_MODE=off` in.
- [ ] Laat Vercel installeren met de lockfile en bouwen met typecheck plus build.

## 2. Neon en databescherming

- [ ] Gebruik afzonderlijke Preview- en Production-databases of -branches met
  backups en een geoefend herstelpad.
- [ ] Maak unieke TLS-rollen voor migraties, web-runtime, accountworker en
  mediaworker.
- [ ] Configureer `DATABASE_URL`, `DATABASE_ACCOUNT_WORKER_URL` en
  `DATABASE_MEDIA_WORKER_URL` per environment.
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

Het digitale Bouwboek gebruikt de web-runtime en private Blob. Het heeft in
deze MVP geen print- of Bouwboekworker nodig.

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
- [ ] Verstuur algemene feedback en printinteresse en controleer de ontvangst.
- [ ] Controleer primaire navigatie, toetsenbord/focus, fouten en console op
  mobiel en desktop in Chromium, Firefox en WebKit.
- [ ] Laat de volledige geautomatiseerde verificatieset groen eindigen.

## 7. Productievrijgave

- [ ] Controleer privacy-, voorwaarden- en supportteksten voor de gratis dienst.
- [ ] Review Previewbewijs, databaseherstel, monitoring en rollback tegen
  dezelfde SHA.
- [ ] Deploy exact die SHA en voer een niet-destructieve smoke uit voor landing,
  auth, private media, delen, digitaal Bouwboek en feedback.
- [ ] Ruim synthetische accounts, media en feedback gecontroleerd op.

## Niet configureren voor deze MVP

- Stripe, prijzen, sellerdata, checkoutwebhooks of paymentworkers;
- Peecho of een andere druk-/fulfilmentprovider;
- een printproof- of Bouwboekworker;
- transactionele e-mail of een AI-provider.

Historische schema's en routes voor deze onderdelen zijn dormant. Met
`CHECKOUT_MODE=off` mogen ze geen zichtbare flow of releaseafhankelijkheid zijn.
