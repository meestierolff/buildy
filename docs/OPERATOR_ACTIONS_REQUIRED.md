# Vereiste operatoracties

Deze checklist geldt voor de gratis Buildy-MVP uit
[GRAPH](architecture/GRAPH.md) en [FLOWS](architecture/FLOWS.md). Koppel bewijs aan
één volledige release-SHA en zet nooit secrets of persoonsgegevens in de
repository, logs of screenshots. Leg actueel bewijs en één volgende actie vast
in [STATE](architecture/STATE.md). Deze checklist verleent geen toestemming om
Google-configuratie of productie-instellingen te wijzigen.

## 1. Releasekandidaat en Vercel

- [ ] Leg de volledige release-SHA, verantwoordelijke en rollbackbeslissing vast.
- [ ] Gebruik één bekend Vercel-project met gescheiden Preview- en
  Production-environments.
- [ ] Controleer domains, TLS, securityheaders en environment-scoping.
- [ ] Stel overal `PRODUCT_PROFILE=feedback_beta` en `BETA_MODE=false` in.
- [ ] Gebruik lokaal, in Preview/staging en in Production `CHECKOUT_MODE=off`.
- [ ] Leg `public_demo` vast als rollbackoptie, zonder het als MVP-succes te tellen.
- [ ] Laat Vercel installeren met de lockfile en bouwen met typecheck plus build.

## 2. Neon en databescherming

- [ ] Gebruik afzonderlijke Preview- en Production-databases of -branches met
  backups en een geoefend herstelpad.
- [ ] Gebruik unieke TLS-rollen voor migraties, web-runtime, accountworker en
  mediaworker. Behoud de bestaande RLS- en rolisolatiechecks, ook voor dormant
  schema; commerceworkercredentials zijn geen actieve runtimevereiste.
- [ ] Configureer `DATABASE_URL`, `DATABASE_ACCOUNT_WORKER_URL` en
  `DATABASE_MEDIA_WORKER_URL` per environment.
- [ ] Houd `DATABASE_MIGRATION_URL` en `DATABASE_DIRECT_URL` buiten de
  web-runtime en gebruik ze alleen voor gecontroleerde operatoracties.
- [ ] Pas de append-only migrations toe en voer `bun run db:verify` uit tegen
  een tijdelijke of expliciet gekozen database.
- [ ] Controleer `PII_ENCRYPTION_KEYS`, `PII_ENCRYPTION_CURRENT_VERSION` en
  `PII_BLIND_INDEX_KEY` zonder waarden te tonen. Genereer alleen bij nieuwe
  configuratie; roteer bestaande encryptiesleutels niet stilzwijgend. Bewaar
  rotatie- en recoveryinformatie buiten de repository.

## 3. Google OpenID Connect

- [ ] Controleer de bestaande Google-webclients voor de stabiele Preview en
  Production; vraag eigenaartoestemming als configuratie ontbreekt of moet wijzigen.
- [ ] Registreer alleen exacte HTTPS-origins en de callback
  `/api/auth/callback/google`; gebruik geen wildcards.
- [ ] Plaats `GOOGLE_CLIENT_ID` en `GOOGLE_CLIENT_SECRET` uitsluitend in de
  juiste Vercel-environment.
- [ ] Test nieuwe en bestaande gebruiker, veilige callback, logout, verlopen
  sessie en accountverwijdering.

Google is de enige loginmethode. Configureer geen wachtwoord-, magic-link- of
e-mailauthenticatie. De eigenaar doet persoonlijke login en secretinvoer; gebruik
CLI/API en Playwright voor controle, geen Computer Use of vervangende identiteit.

## 4. Private Vercel Blob

- [ ] Maak per environment een private Blob-store en configureer het juiste
  `BLOB_READ_WRITE_TOKEN`.
- [ ] Test upload, completion, geautoriseerde same-origin read, weigering voor
  een outsider, verwijderen en orphan cleanup.
- [ ] Controleer dat customer-media niet via een publieke of permanente
  object-URL in HTML, data, logs of caches terechtkomt.

Het digitale Bouwboek gebruikt de web-runtime en private Blob en heeft geen
payment-, printproof- of printworker nodig.

## 5. Dagelijkse account lifecycle

- [ ] Laat de bevoegde eigenaar een retentieversie en ingangsdatum bevestigen
  voordat je deze configureert; verzin geen approval. Controleer
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
  liken/reageren met een afzonderlijk ingelogde kijker. Controleer ook dat de
  ingetrokken link geen API- of mediatoegang meer geeft.
- [ ] Controleer cover, indeling, volgorde en inhoudsselectie in het digitale
  Bouwboek.
- [ ] Controleer opslag na herladen, inclusief Bouwmoment, like/reactie en
  digitale Bouwboekinstellingen; onderscheid mocks van echte hosted providers.
- [ ] Verstuur algemene feedback en controleer de ontvangst.
- [ ] Verifieer logout en verwijdering van een afzonderlijk wegwerpaccount:
  sessies en toegang verdwijnen meteen; cleanup rapporteert de werkelijke status.
- [ ] Controleer primaire navigatie, toetsenbord/focus, fouten en console op
  mobiel en desktop in Chromium, Firefox en WebKit.
- [ ] Laat de volledige geautomatiseerde verificatieset groen eindigen.

## 7. Productievrijgave

- [ ] Controleer privacy-, voorwaarden- en supportteksten voor de gratis dienst.
- [ ] Bevestig de actuele hostingvoorwaarden, het beoogde gebruik, benodigde
  verwerkersafspraken en verantwoordelijke contactgegevens. Gratis gebruik is
  niet automatisch niet-commercieel; koop geen plan zonder toestemming.
- [ ] Review Previewbewijs, databaseherstel, monitoring en rollback tegen
  dezelfde SHA.
- [ ] Deploy binnen de gegeven toestemming exact die SHA en voer een
  niet-destructieve smoke uit voor landing, auth, private media, delen, digitaal
  Bouwboek en feedback.
- [ ] Ruim synthetische accounts, media en feedback gecontroleerd op.

## Niet configureren voor deze MVP

- Stripe, prijzen, sellerdata, checkoutwebhooks of paymentworkers;
- Peecho, een druk-/fulfilmentprovider of fysieke bestellingen;
- een printproofworker, providercallback of fulfilmentcron;
- transactionele e-mail of een AI-provider.

Historische schema's en routes voor deze onderdelen blijven dormant. Met
`CHECKOUT_MODE=off` zijn ze geen zichtbare flow of releaseafhankelijkheid.
