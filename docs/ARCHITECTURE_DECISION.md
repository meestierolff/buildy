# ADR-001 — Productionarchitectuur en migratiestrategie voor Buildy

- **Status:** Accepted for implementation
- **Datum:** 2026-08-04
- **Beslissers:** Buildy product- en engineeringverantwoordelijke
- **Reikwijdte:** webapp, server-API, authenticatie, database, object storage, Bouwboek, betalingen, fulfilment, e-mail en migratie
- **Vervangt:** de actieve Lovable/Supabase-runtimearchitectuur en de Peecho Print Button-flow

## Samenvatting van het besluit

Buildy behoudt de bestaande React/Vite-frontend en migreert gefaseerd naar een eigen, provider-neutrale backend. De backend bestaat uit Web API-gebaseerde Vercel Functions, Neon Postgres, Drizzle ORM met geversioneerde SQL-migraties en een self-hosted Better Auth-instance die in Vercel Functions draait en zijn tabellen in Neon bewaart. Browserauthenticatie gebruikt uitsluitend same-origin, `HttpOnly`, `Secure` en passende `SameSite`-cookies.

Alle projectmedia en Bouwboek-PDF's komen in private Cloudflare R2-objectopslag achter een `ObjectStorage`-interface. Lezen verloopt via een autoriserende proxy of een doelgebonden, kortlevende URL. De applicatie wordt opgesplitst in domeinservices, expliciete readmodels, een transactionele outbox/inbox en hervatbare deletionsaga's. Eén canonical `PhotobookDocument` stuurt editor, preview en PDF-rendering aan; een goedgekeurde PDF-revisie wordt immutable en cryptografisch aan checkout en fulfilment gebonden.

Stripe blijft de betaalprovider, Peecho REST API v3 verzorgt print en fulfilment, en Brevo verzorgt transactionele e-mail. Geen van deze providers bepaalt rechtstreeks de interne domeintoestand: geverifieerde provider-events worden idempotent vertaald naar Buildy-events en statusovergangen.

De migratie volgt een stranglerpatroon per verticale slice. Een legacy-slice wordt pas verwijderd nadat data, autorisatie, UI, tests, observability en rollback voor de vervangende slice aantoonbaar werken.

## Context en probleemstelling

De huidige applicatie bevat bruikbare productlogica, maar koppelt React rechtstreeks aan Supabase Auth, Postgres RPC/RLS en Storage. Lovable wordt gebruikt voor OAuth en AI; order- en fulfilmentlogica draait in Supabase Edge Functions. Deze coupling belemmert een gecontroleerde migratie en maakt beveiligingsgaranties afhankelijk van verspreide clientlogica, RLS-versies en bearer-URL's.

De repository-audit bracht onder meer de volgende architectuurproblemen aan het licht:

- sessietokens worden in `localStorage` bewaard;
- een legacy mediabucket is publiek en private media gebruikt bearer-URL's die onvoldoende onmiddellijk intrekbaar zijn;
- profile-follow en private-profieltoegang zijn semantisch vermengd;
- meerdere relaties en cascadepaden missen afdwingbare database-integriteit;
- een gehashte Bouwboek-PDF kan na goedkeuring nog worden overschreven of verwijderd;
- notifications, e-mail, providers en objectcleanup hebben geen uniforme durable outbox/joblaag;
- project-, update- en mediaverwijdering bestaat deels uit niet-transactionele clientacties;
- de migratiehistorie bevat herhalingen en `NOT VALID` constraints, zodat bronmigraties niet zonder live cataloguscontrole als waarheid kunnen gelden.

Tegelijk bevat de bestaande backend waardevolle logica die behouden moet blijven: server-owned pricing, Stripe-signaturecontrole, provider-eventdeduplicatie, monotone orderstatus, fulfilment leases, Peecho-reconciliatie, privacychecks, follow-approval en de accountdeletion-lock/archive/cleanup-opzet.

De architectuur moet daarom geen big-bang rewrite zijn. Zij moet bestaande UUID's en bewezen regels behouden, de gegevensgrenzen expliciet maken en iedere slice afzonderlijk kunnen activeren en terugrollen.

## Architectuurprincipes

1. **De server is de trust boundary.** De browser bepaalt nooit `userId`, ownership, prijs, toegangsstatus, objectkey, orderstatus, paginatal of fulfilmentstatus.
2. **Eén writer per aggregate.** Tijdens migratie heeft iedere domeinslice precies één autoritatieve writer. Shadow reads mogen; ongecontroleerde bidirectionele dual writes niet.
3. **Private by default.** Nieuwe projecten, budgetten, adressen, originelen, floorplans en PDF's zijn privé totdat een server-side policy expliciet toegang verleent.
4. **Bytes en metadata zijn afzonderlijke concerns.** R2 bewaart bytes; Neon bewaart ownership, policy, checksum, revisie, verwerkingstoestand en lifecycle.
5. **Events zijn feiten, statussen zijn projecties.** Providercallbacks worden als immutable inboxevents vastgelegd en daarna idempotent toegepast.
6. **Side effects verlaten de database via een outbox.** E-mail, notificaties, provideracties en cleanup worden niet als onbetrouwbare fire-and-forgetactie aan een kernwrite gekoppeld.
7. **Expand, migrate, contract.** Destructieve schema- of storagecleanup vindt nooit plaats in dezelfde release als de cutover.
8. **Fail closed.** Ontbrekende providerconfiguratie, juridische waarden, prijsgoedkeuring of autorisatie levert geen best-effort liveflow op, maar een server-side uitgeschakelde capability.
9. **Provideradapters lekken niet het domein in.** Domeinservices gebruiken Buildy-contracten en kennen geen Stripe-, Peecho-, Brevo-, R2- of legacy-Supabasepayloads.
10. **Bewijs boven redirect of UI-state.** Alleen geverifieerde serverevents, gecontroleerde bytes en databasecommits wijzigen financiële of privacygevoelige toestand.

## Besluit per laag

### Frontend: React en Vite blijven

De bestaande React/Vite-app blijft de frontend. Routes en gebruikersflows worden verticaal gemigreerd naar een typed API-client; directe Supabase-, Lovable-, database- en storagecalls verdwijnen per slice.

Een frameworkmigratie naar Next.js is geen voorwaarde voor veilige cookies, server-API's of metadata. Een volledige frameworkmigratie zou auth, uploads, Bouwboekrendering en alle UI-routes gelijktijdig raken en daarmee het stranglermodel ondermijnen. Publieke Open Graph-responses worden door specifieke Vercel Functions gegenereerd; hiervoor hoeft de hele app niet server-rendered te worden.

Frontendregels:

- React ontvangt alleen DTO's/readmodels en opaque cursors;
- alle mutaties lopen via same-origin `/api/*`;
- de typed client stuurt cookies met same-origin credentials, maar kan sessietokens niet uitlezen;
- TanStack Query blijft voor cache, invalidatie en optimistic UI met expliciete rollback;
- legacyroutes blijven tijdelijk bestaan als redirects naar nieuwe project/update-routes;
- featureflags komen uit een server-side capability/readmodel, niet uit alleen build-time clientvariabelen.

### Server: Vercel Web API Functions

De API gebruikt Vercel Functions met standaard Web API-objecten (`Request`, `Response`, `Headers`, `URL`, `FormData`, streams). Functies leven onder `/api` en worden gegroepeerd achter een dunne router en gedeelde middleware. De Node.js-runtime is de default totdat een dependency expliciet edge-compatible en getest is.

Deze keuze houdt de API los van een frontendframework, sluit aan op Vercels aanbevolen `fetch`-handler en maakt raw-body webhookverificatie, cookies en streaming mogelijk. De functieregio wordt zo dicht mogelijk bij de gekozen Neon EU-regio geplaatst. Langlopende processen worden niet in één browserrequest gehouden: ze schrijven een durable job en hervatten in begrensde worker/cron-invocations.

Elke request krijgt:

- een request/correlation ID;
- schema-validatie met gedeelde Zod-contracten;
- authn en resource-specifieke authz;
- consistente foutcodes zonder interne details;
- structured logging met PII-, token-, signed-URL- en providersecretredactie;
- rate limiting op actor, IP en doelresource waar passend;
- idempotency-keycontrole voor retrybare mutaties.

Webhooks en cronroutes hebben afzonderlijke entrypoints en credentials. Webhooks lezen de ongewijzigde raw body vóór parsing. Cronroutes accepteren geen browsersessie en gebruiken een roteerbaar, environment-specifiek secret en least-privilege databasepad.

### Database: Neon Postgres en Drizzle

Neon Postgres wordt de autoritatieve database voor Buildy-domeindata, authmetadata, readmodelstate, provider-inbox, outbox en jobs. Runtimeverkeer gebruikt een pooled/serverless connection; migraties gebruiken een directe connection, een migratielock en expliciete timeouts.

Drizzle levert typed schema- en queryconstructies. De gecommitte, geversioneerde SQL-bestanden in `db/migrations/` zijn de enige toegestane schemawijzigingsroute voor preview, staging en productie. `drizzle-kit push` is daar verboden. Iedere migration wordt gereviewd op locks, backfill, rollback/forward-fix en compatibiliteit met de voorgaande applicatieversie.

Voorgestelde structuur:

```text
db/
  schema/
  migrations/
  seeds/
  queries/
  audits/
```

Schema-eisen:

- bestaande domein-UUID's blijven behouden waar mogelijk;
- alle ownership- en parentrelaties krijgen foreign keys;
- cross-project childrelaties krijgen samengestelde constraints of transactionele servicevalidatie;
- geldbedragen zijn integer minor units met vaste currency;
- statuswaarden krijgen PostgreSQL-enums of expliciete check constraints;
- alle feed-, owner-, parent-, status-, lease- en outboxqueries krijgen doelgerichte indexes;
- timestamps zijn `timestamptz` in UTC;
- providerpayloads worden geminimaliseerd; PII wordt niet als algemeen JSON-log opgeslagen;
- gevoelige domeinregels krijgen defense-in-depth constraints en, waar bewezen nuttig, RLS. RLS vervangt de serverautorisatie niet.

### Authenticatie: self-hosted Better Auth op Neon

Buildy host Better Auth zelf in een same-origin Vercel Function en gebruikt de Drizzle/Postgres-adapter op Neon. Better Auth beheert auth-specifieke tabellen voor users, accounts, sessions en verifications; Buildy beheert een stabiele applicatie-identiteit en profielrecords.

De keuze is gebaseerd op de concrete Buildy-eisen:

- frameworkloze React/Vite-frontend met same-origin API;
- `HttpOnly`, `Secure`, `SameSite=Lax` cookies en gecontroleerde CSRF/originchecks;
- database-backed sessies, sessielijst en individuele/all-session revocation;
- freshness/step-upcontrole voor wachtwoord-, e-mail-, export- en deleteacties;
- expliciete legacy-user-ID mapping en beheerste first-loginmigratie;
- server-side private-bèta-invitevalidatie en usage limits;
- lifecyclehooks die transactionele Buildy-outboxevents voor Brevo genereren;
- Google OAuth zonder Lovable-broker en expliciete accountlinkingregels;
- één deploy- en observabilitygrens met de overige Vercel API.

Authcookies zijn host-only tenzij een later domeinbesluit cross-subdomaingebruik aantoonbaar noodzakelijk maakt. Productie forceert HTTPS en secure cookies. State-changing endpoints valideren `Origin`/`Sec-Fetch-Site`, gebruiken SameSite als defense-in-depth en vereisen daarnaast een CSRF-token waar de requestvorm of browsercompatibiliteit dat vraagt. Geen access-, refresh- of sessiontoken wordt in `localStorage`, analytics of logs opgeslagen.

Sessies blijven database-backed. Cookie caching mag alleen kortlevend worden geactiveerd wanneer revocationtests aantonen dat de maximale stale window voldoet aan de privacy-eisen. Password reset en securitywijzigingen trekken andere sessies in. Voor high-riskacties geldt een korte `freshAge` of expliciete herauthenticatie; een UI-tekstconfirmatie is nooit het serverbewijs van step-up.

Beta-invites worden niet als onbetrouwbare `after`-hook verwerkt. Een voorregistratie-intent reserveert atomair een geldige code; accountcreatie finaliseert deze idempotent en schrijft in dezelfde Buildy-transactie een profiel, identity mapping, audit event en e-mailoutboxrecord. Een incomplete reservering verloopt en kan veilig worden hersteld.

#### Legacy-identiteit

Applicatietabellen verwijzen naar een stabiele `app_users.id`, bij voorkeur de bestaande Supabase-auth UUID. Een `auth_identity_mappings`-record koppelt deze ID aan de Better Auth user/account-identiteit en bewaart alleen noodzakelijke provider- en migratiestatusmetadata. Hierdoor hoeven projectownership en sociale relaties niet te worden herschreven wanneer de authprovider verandert.

Wachtwoorden worden nooit als plaintext geëxporteerd. Bestaande hashes worden alleen geïmporteerd wanneer het gebruikte formaat officieel ondersteund en met synthetische accounts getest is. Anders geldt een gecontroleerde magic-link/first-login/password-setflow. Oude sessies worden bij cutover ongeldig; OAuth-gebruikers koppelen Google opnieuw via geverifieerde flows.

#### Waarom nu niet Neon Auth

Neon Auth blijft een kandidaat, maar is voor deze release niet de gekozen runtimeauth. Op de beslisdatum documenteert Neon een React/Vite-clientroute naar een managed Auth URL, terwijl de gedocumenteerde server-SDK en cookiehandler specifiek op Next.js zijn gericht. Dat bewijst nog niet de benodigde same-origin Vite/Vercel-servercombinatie met Buildy's invite-reserveringen, Brevo-outboxhooks, legacy-ID-migratie, step-up en fijnmazige sessiecontrole.

Dit is een bewijsbesluit, geen principiële afwijzing. Neon Auth wordt opnieuw beoordeeld zodra alle onderstaande gates groen zijn:

1. een officieel ondersteunde, stabiele niet-Next serverhandler voor Vercel Web API Functions;
2. same-origin `HttpOnly` cookiebeheer zonder tokenopslag in de browser;
3. server-side session validation, freshness, list/revoke en forced global revocation;
4. before/after lifecycle-integratie waarmee invite- en e-mailoutboxregels transactioneel of aantoonbaar herstelbaar zijn;
5. veilige import of expliciete migratie van legacy identities, passwordless en Google accounts;
6. per-environment trusted origins, callbackconfiguratie en branchgedrag;
7. een Buildy vertical-slice-spike die auth-, CSRF-, IDOR-, revocation- en failure-tests doorstaat;
8. een geschreven migratie- en rollbackplan zonder nieuwe frameworkmigratie.

Een groene gate kan een nieuwe ADR opleveren. Er vindt geen stille providerwissel plaats.

### Object storage: private Cloudflare R2

Cloudflare R2 is de production-default achter een provider-neutrale `ObjectStorage`-interface:

```ts
interface ObjectStorage {
  createUploadUrl(input: CreateUploadInput): Promise<UploadGrant>;
  completeUpload(input: CompleteUploadInput): Promise<StoredObject>;
  createDownloadUrl(input: DownloadGrantInput): Promise<DownloadGrant>;
  headObject(key: string): Promise<ObjectMetadata | null>;
  copyObject(input: CopyObjectInput): Promise<void>;
  deleteObject(key: string): Promise<void>;
  listObjects(input: ListObjectsInput): Promise<ObjectPage>;
  getChecksum(key: string): Promise<string>;
}
```

Productionbuckets hebben geen publieke `r2.dev`-toegang. Logical buckets of prefixes scheiden `originals`, `display-derivatives`, `avatars`, `floorplans`, `photobook-pdfs` en `temporary-uploads`. Credentials zijn per environment en least privilege.

Uploadflow:

1. de API autoriseert actor en doelaggregate en maakt zelf een opaque objectkey;
2. de browser krijgt een kortlevende, operation- en objectgebonden uploadgrant;
3. de browser uploadt rechtstreeks naar R2;
4. `completeUpload` controleert grootte, checksum, magic bytes, MIME en decode;
5. een worker stript EXIF/GPS, respecteert oriëntatie en maakt veilige displayderivatives;
6. het origineel blijft private en immutable voor Bouwboekrendering;
7. pas na succesvolle validatie krijgt het assetrecord status `ready`.

Downloadflow:

- publieke én private projectafbeeldingen lopen via een autoriserende image proxy met policy-versioned cachekey;
- de proxy levert alleen derivatives en controleert actuele project-/profile-/blocktoegang;
- privacywijziging verhoogt de policyversie, purget de relevante cachetag en laat de proxy stale versies weigeren; reeds door een bezoeker gedownloade bytes kunnen vanzelfsprekend niet worden teruggehaald;
- originelen, floorplans en PDF's krijgen alleen een kortlevende, doelgebonden grant na serverautorisatie;
- signed URLs gelden als bearer tokens en komen niet in DB-payloads, analytics, referrers of logs.

R2 bewaart bytes; het Neon `media_assets`-record is autoritatief voor eigenaar, aggregate, objectkey, checksum, detected MIME, dimensies, verwerkingstoestand, privacyversie, revisie en retentie. Objectdelete gebeurt idempotent vanuit een durable job en wordt met `headObject` geverifieerd.

### Domeinservices en readmodels

Businessregels leven in domeinservices en niet in React, routehandlers of provideradapters. Minimaal worden de volgende services onderscheiden:

- `IdentityService` en `ProfileService`;
- `ProjectService` en `UpdateService`;
- `MediaService`;
- `RelationshipService` en `ProjectAccessService`;
- `CommentService`, `ReactionService` en `NotificationService`;
- `FloorplanService` en `BudgetService`;
- `PhotobookService` en `ProofService`;
- `CheckoutService`, `PaymentService` en `FulfilmentService`;
- `ExportService`, `DeletionService` en `ModerationService`.

Repositories bevatten alleen persistentiedetails. Services openen de transactie, autoriseren de actor, schrijven het aggregate en voegen outboxevents toe. Vercel routehandlers valideren input, bouwen de actorcontext en vertalen domeinfouten naar API-responses.

Schermgerichte readmodels voorkomen N+1/waterfalls en lekken geen privévelden. Er komen aparte modellen voor dashboard, following feed, discovery, project overview, timeline, profiel, notificaties, Bouwboek en orderstatus. Feeds, updates, comments en notificaties gebruiken cursorpagination. Readmodels mogen worden gecachet, maar iedere cachekey bevat visibility/policyversie en actorclass waar nodig.

### Outbox, inbox en jobs

`outbox_events` wordt in dezelfde database-transactie geschreven als de domeinmutatie. Een worker claimt records met een lease, voert de side effect uit en bewaart attempt, volgende retry, geminimaliseerd resultaat en foutklasse. Retries gebruiken exponential backoff met jitter; na de limiet volgt `dead_letter` en een operationele alert. Een idempotency key is uniek per logisch effect, bijvoorbeeld `order:{id}:confirmation:v1`.

`provider_inbox_events` bewaart één record per provider/event-ID of, wanneer de provider geen ID geeft, per geverifieerde payloadhash en scoped reference. Verwerking gebeurt via atomic claim. Een event kan `applied`, `ignored`, `retry` of `dead_letter` eindigen; ontvangst alleen verandert geen orderstatus.

Durable jobs worden ook gebruikt voor PDF-rendering, derivatives, data-export, reconciliatie en deletionsaga's. Jobs zijn kleine hervatbare stappen; leases kunnen verlopen en opnieuw worden geclaimd. Iedere stap is idempotent en controleert de reeds bereikte toestand vóór een externe call.

### Deletionsaga

Project- en accountdelete zijn server-side saga's met ten minste:

- `requested`;
- `blocked_active_order`;
- `deletion_pending`;
- `database_redaction`;
- `storage_cleanup`;
- `verification`;
- `completed`;
- `retry_scheduled`;
- `manual_review`;
- `dead_letter`.

Een advisory lock of unieke actieve-jobconstraint serialiseert deletion per aggregate. De eerste transactie markeert het aggregate onbeschikbaar voor nieuwe writes, maakt een volledig assetmanifest, controleert actieve fysieke orders en schrijft de durable job. Fiscale/orderdata wordt uitsluitend volgens goedgekeurde, centrale retentieconfiguratie geminimaliseerd en gearchiveerd. Storagecleanup is idempotent, wordt met readback/head geverifieerd en kan na een crash hervatten. Een betaald actief order verdwijnt nooit stilzwijgend.

## Data-eigenaarschap

| Gegeven of proces | Autoritatieve bron | Afgeleide/cachebron | Regel |
|---|---|---|---|
| Applicatie-identiteit en legacy-ID | Neon `app_users` + identity mapping | Better Auth session DTO | Provider-ID is geen domein-FK |
| Credentials, accounts en sessies | Better Auth-tabellen in Neon | Korte secure cookie/cache | Geen token in browserstorage |
| Profiel, project, update, social en budget | Neon domeintabellen | Typed readmodels/querycache | Alleen domeinservice schrijft |
| Mediaownership, ACL, checksum en lifecycle | Neon `media_assets` | Image-proxycache | Objectkey uit server, niet client |
| Media- en PDF-bytes | Private R2 | Tijdelijke derivative/proxyrespons | Geen permanente publieke object-URL |
| Betalingswaarheid | Geverifieerd Stripe-event + Buildy eventledger | Orderstatus-readmodel | Browserredirect is geen bewijs |
| Fysieke fulfilmentwaarheid | Peecho authoritative fetch/callback + Buildy eventledger | Orderstatus-readmodel | Callback is signaal, reference wordt gebonden |
| E-mailintentie | Neon outbox | Brevo delivery status | Brevotemplate-ID is configuratie, geen domeinstatus |
| Audit en moderation | Neon append-only records | Adminreadmodel | PII geminimaliseerd en toegang beperkt |

Providerstatus is dus nooit rechtstreeks een mutable clientveld. Stripe en Peecho leveren externe feiten; Buildy bepaalt via gecontroleerde transities wat die feiten intern betekenen.

## Security boundaries

| Boundary | Vertrouwen | Verplichte controles |
|---|---|---|
| Browser → Vercel API | Browser en alle velden zijn onbetrouwbaar | Cookie authn, CSRF/origin, Zod, rate limit, resource-authz, idempotency |
| Vercel API → Neon | Alleen servicecode mag schrijven | Least-privilege rollen, parameterized queries, transacties, constraints, optionele RLS |
| Browser → R2 upload | Grant kan uitlekken; bytes zijn onbetrouwbaar | Korte single-key PUT, size/content restrictions, finalize, magic/decode/checksum, quarantine |
| Browser → media proxy | Actor en URL kunnen worden vervalst | Actuele ACL/block/privacycheck, opaque key, policyversion, safe content headers |
| Vercel → providers | Providerconfig kan fout zijn | Account/environment pinning, TLS, timeout, idempotency, responseminimisatie |
| Provider → webhook | Netwerkpayload is onbetrouwbaar | Raw-body signature, timestamp, expected account/app/reference, replay-inbox |
| Cron/worker → jobs | Invocation kan dubbel of laat komen | Secret, lease, idempotente stap, retry/dead-letter, audit |
| Admin/operations | Hoog risico | Sterke rol, step-up, minimale toegang, audit event, geen impersonation zonder expliciete policy |

Het woningadres, contractor notes, budget, floorplans, originelen, authdata, ordercontactdata en exportbestanden zijn afzonderlijke gevoelige datasets. Een publieke projectpolicy impliceert nooit toegang tot die datasets.

## Canonical Bouwboek en immutable proof

Editor, preview en renderer gebruiken één geversioneerd `PhotobookDocument` met minimaal:

- document- en schemaversie;
- projectrevision;
- geselecteerde SKU/format;
- cover, hoofdstukken en pagina's;
- text- en photoblocks;
- crop/focus;
- bronasset-ID's plus assetchecksums;
- printafmetingen, paginatal en renderconfig;
- documentchecksum.

De renderer produceert deterministische PDF-bytes en thumbnails uit dezelfde render. Een `photobook_proof_revisions`-record bindt documentrevision, assetset, page count, PDF-objectversion, byte size en SHA-256.

Proofstatus:

```text
draft → rendering → ready → approved → locked
   └──────────────→ failed
ready/approved → invalidated (bij iedere inhouds- of assetwijziging)
```

`approved` vereist expliciete user approval van precies die revisie. Checkout verandert de revisie atomair naar `locked`; vanaf dat moment kan de R2-key/version niet door de gebruiker worden overschreven of verwijderd. Een wijziging maakt een nieuwe revision en kan een bestaande checkout niet hergebruiken. Voor Peecho-download worden bytes opnieuw ge-head/read en vergeleken met size en SHA-256. Alleen die immutable revision mag in de ordersnapshot voorkomen.

De eerste live SKU blijft fail-closed beperkt tot A4 liggend, hardcover, minimaal 24 pagina's en een even paginatal totdat offering, productspecificatie, quote, proefdruk en E2E-order extern zijn bevestigd.

## Order-, payment- en fulfilmentmodel

Eén gigantische mutable status wordt vermeden. Buildy bewaart drie gekoppelde toestandsmachines en leidt een UI-status af.

### Order/proof

```text
draft → proof_generating → proof_ready → awaiting_payment → checkout_open
checkout_open → paid | cancelled | payment_failed | expired
paid → refunded | partially_refunded
iedere niet-terminale toestand → manual_review
```

### Fulfilment

```text
unclaimed → fulfilment_claimed → peecho_order_created
peecho_order_created → peecho_payment_pending → submitted_to_production
submitted_to_production → in_production → shipped → delivered
iedere actieve toestand → fulfilment_failed → retry_scheduled | manual_review
pre-production → cancelled
```

Een Stripe-refund annuleert een Peecho-order niet impliciet. Een Peecho-status wijzigt de Stripe-paymentstatus niet. De orderreadmodelstatus toont beide dimensies en markeert conflicten als `manual_review`.

### Eventregels

- `photobook_order_events` is append-only en bevat actor/provider, type, vorige/nieuwe status, event-ID, timestamp en geminimaliseerde metadata;
- statusovergangen worden centraal gevalideerd en mogen niet achteruit, behalve via expliciete compensatie-events;
- Stripe Checkout gebruikt server-owned prijs, currency, quantity, shipping, taxbesluit, termsversie en immutable proof-ID;
- iedere Stripecall bevat `app=buildy`, orderreference, environment en een unieke idempotency key;
- webhookevents controleren signature, verwachte Stripe account-ID, mode/environment, metadata en bedragen;
- Peecho `createOrder` en `payOrder` zijn afzonderlijke idempotente stappen; het Peecho order-ID wordt direct na create opgeslagen;
- een onzekere Peecho create-timeout wordt eerst via reference/getOrder gereconcilieerd voordat retry create mag uitvoeren;
- callbacks worden geverifieerd en waar mogelijk alleen als wake-up gebruikt voor een authoritative `getOrder`;
- tracking-URL's worden gehost/gevalideerd tegen een allowlist voordat de UI ze toont.

## Provideradapters

De domeinlaag gebruikt de volgende poorten:

- `PaymentProvider`, met Stripe als implementatie;
- `PrintFulfilmentProvider`, met Peecho REST API v3 als implementatie;
- `EmailProvider`, met Brevo als implementatie;
- `ObjectStorage`, met Cloudflare R2 als implementatie.

Adapters mappen providerpayloads naar kleine Buildy-types, hebben expliciete timeout/retryclassificatie en loggen nooit secrets, signed URLs, e-mailinhoud of shippingaddressen. Sandbox en live credentials, endpoints, webhooksecrets, account-ID's, offering-ID's en template-ID's zijn volledig gescheiden.

Brevo wordt nooit direct vanuit een authhook of userrequest aangeroepen. Auth- en domeinhooks schrijven een outboxevent; de mailworker rendert een geversioneerde Nederlandse HTML- en teksttemplate en verstuurt idempotent. Deliveryevents vullen een apart deliverylog en wijzigen geen core domeintransactie.

## Strangler-migratie

De migratievolgorde staat vast. Per slice wordt eerst de backendgrens gebouwd, dan data gemigreerd, de nieuwe UI geactiveerd en pas daarna legacycode verwijderd.

| Slice | Nieuwe write-owner | Minimaal verticaal bewijs vóór activatie |
|---|---|---|
| 1. Auth en profiel | Better Auth + Identity/Profile services | cookieauth, verify/magic/reset/Google, invite, legacy mapping, session revoke, step-up, profielprivacy |
| 2. Projecten en updates | Project/Update services | CRUD, private default, address isolation, redirects, ownership/IDOR, reconciliation |
| 3. Media | MediaService + private R2 | direct upload/finalize, magic/decode/checksum, derivative, authorized read, public→private revoke, cleanup retry |
| 4. Social en toegang | Relationship/Access services | directionele profielrelatie, projectaccess, block, alle actorclasses en privacytests |
| 5. Reacties en notificaties | Comment/Notification services | zichtbaarheid, threadregels, outbox, duplicate/retry, geen melding over onzichtbare content |
| 6. Plattegronden en budget | Floorplan/Budget services | private assets, pins, owner/shared budgetpolicy, mobileflow, export |
| 7. Bouwboek | Photobook/Proof services | canonical model, deterministic render, PDF-thumbnails, assetset, SHA-256, invalidate/lock |
| 8. Checkout en fulfilment | Checkout/Payment/Fulfilment services | Stripe sandbox, replay/out-of-order, price/land gate, Peecho timeout/reconcile/retry, Brevo ordermail |
| 9. Accountdelete en operations | Export/Deletion/Moderation services | export, active-order block, resumable cleanup, archivepolicy, dead-letter, restore/alerts |
| 10. Legacyverwijdering | Nieuwe stack volledig | zero runtime requests/imports/env naar Lovable/Supabase, final delta, rollbackwindow voltooid |

Tijdens een slice-cutover geldt:

1. legacybron en doelschema worden geïnventariseerd;
2. data wordt idempotent gekopieerd met behouden IDs en mapping;
3. row counts, ownership, orphan counts en relevante checksums worden vergeleken;
4. de nieuwe API draait in shadow-read/diffmodus met synthetische of geautoriseerde testaccounts;
5. een server-side flag verplaatst reads en daarna writes naar de nieuwe owner;
6. observability en supportrunbook worden gecontroleerd;
7. na de rollbackwindow wordt alleen die legacycode verwijderd.

Geen slice leest stiekem uit beide bronnen en kiest de “mooiste” uitkomst. Een mismatch is een fout en blokkeert cutover.

## Vertical-slice acceptance

Een slice is alleen `accepted` wanneer al het volgende aantoonbaar is:

- schema en geversioneerde migration zijn herhaalbaar op een lege en een bestaande branch;
- import/backfill is idempotent en row-count/orphan/ownershipreconciliatie is groen;
- alle writes lopen door één domeinservice en database-transactie;
- server-side authz is getest voor anoniem, niet-gerelateerd, pending, accepted, owner, blocked en admin waar relevant;
- typed API-contract, React-flow en Nederlandse loading/empty/error/successstates werken mobiel en desktop;
- unit-, integration-, E2E-, security- en relevante fault-injectiontests slagen;
- logs/metrics bevatten request-ID's en geen PII, secrets of bearer-URL's;
- side effects zijn idempotent, retrybaar en zichtbaar in operations;
- featureflag/canary en een getest rollback- of forward-fixpad bestaan;
- de paritymatrix wijst iedere legacyfunctie expliciet toe aan migrated, removed of externally blocked;
- legacycode en data worden nog niet destructief verwijderd vóór einde rollbackwindow.

Een compilerende build of succesvolle browserredirect voldoet niet aan deze acceptatie.

## Environmenttopologie

| Environment | Vercel | Neon | R2 | Auth/cookies | Stripe/Peecho/Brevo | Dataregel |
|---|---|---|---|---|---|---|
| Local/test | lokale Vite/API of emulator | lokale Postgres of geïsoleerde Neon dev-branch | lokale S3-emulator/testbucket | localhost-cookieconfig; synthetische users | mocks, Stripe CLI waar expliciet | uitsluitend synthetisch |
| Preview | per-PR previewdeployment | ephemeral branch per PR | unieke previewprefix/bucket | preview-origin trusted; eigen secret | standaard mocks/sandbox, geen live side effects | geen productieclone voor externen |
| Staging | stabiel Vercel stagingproject | permanente stagingbranch/database in EU | private stagingbucket | stagingdomain, eigen cookie-/OAuth-secret | Stripe test, Peecho test, Brevo stagingtemplates/mailsink | synthetisch of expliciet gemaskeerd |
| Production | afzonderlijk Vercel productionproject | productionbranch/database in EU | private productionbuckets | primary domain, production secrets | live alleen na provider- en legal gates | echte data, least privilege, backups |

Runtime gebruikt `DATABASE_URL` voor pooled verbindingen; `DATABASE_MIGRATION_URL` is alleen beschikbaar voor migration jobs. Elke environment heeft eigen Better Auth secret, trusted origins, Google callback, R2 token/bucket, Stripe keys/account/webhooksecret, Peecho base URL/merchantsecret en Brevo key/template-ID's. Secrets worden niet gedeeld tussen preview, staging en production.

`PRIMARY_DOMAIN` is de enige bron voor canonical URLs in productie. Zolang die ontbreekt blijft publieke registratie en live checkout server-side uit. Preview-URLs worden nooit automatisch vertrouwd voor productie-OAuth of webhooks.

## Externe launchgates

De code mag veilige fixtures gebruiken, maar de volgende waarden of bewijzen worden nooit verzonnen:

- definitief domein, support/security/privacycontacten en juridische seller identity;
- KvK/btw/adres/telefoon, tax/VAT-besluit, terms- en privacyversies en goedgekeurde retentietermijnen;
- Neon organisatie/project, EU-regio/plan, backups en production connection;
- R2 account, private bucketnamen, least-privilege token, lifecycle en exacte CORS-origins;
- dedicated Buildy Stripe account-ID, test/live keys, webhooksecrets, branding en statement descriptor;
- Peecho test/live merchantcredentials, offering-ID, productspecificatie, quote/shipping, credits/contract/DPA en gecontroleerde proefdruk;
- Brevo API key, DKIM/DMARC-goedgekeurd senderdomain, senderadressen en environment-template-ID's;
- Google OAuth client, secret, redirect origins en accountlinkingtest;
- commerciële prijs- en landenmatrix wanneer Peecho geen bruikbare destination quote levert;
- leeftijds-, contentmoderatie-, fiscale archief- en privacyreview.

Capabilities zijn afzonderlijk fail-closed: ontbrekende Peechodata blokkeert live fulfilment maar niet projectregistratie in staging; ontbrekende legal/pricing/Stripegate blokkeert live checkout; ontbrekende beta-inviteconfig blokkeert publieke signup. Geen externe gate rechtvaardigt een nep-successstate.

## Rollback- en cutoverstrategie

### Voor iedere slice

- gebruik expand/migrate/contractmigraties die minstens één vorige applicatieversie ondersteunen;
- maak vóór import een source-export en vóór cutover een Neon restore point/branch;
- houd een manifest van gemigreerde IDs, row counts, objectchecksums en fouten;
- routeer via een server-side slice flag en begin met interne canaryaccounts;
- behoud legacy read/write alleen zolang één bron ondubbelzinnig writer is;
- laat provider-events door unieke inboxkeys veilig op oude en nieuwe endpointretry reageren;
- documenteer de exacte rollbackdeadline en eigenaar.

### Bij een probleem vóór nieuwe writes

De flag gaat terug naar legacy, de doelslice wordt read-only voor diagnose en er is geen datamerge nodig.

### Bij een probleem na nieuwe writes

Terugschakelen mag alleen wanneer een vooraf geteste reverse-delta de legacybron volledig en controleerbaar bijwerkt. Zonder zo'n pad wordt de slice bevroren en volgt een forward fix; er wordt niet stil teruggeschakeld naar stale data. Dit beschermt projectcontent, access decisions en orders tegen split-brain.

### Finale cutover

De legacybron gaat read-only, een final delta wordt geïmporteerd, row/object/orderreconciliatie draait en daarna worden DNS, auth callbacks en webhooks omgezet. Smoke tests controleren login, privémedia, projectread/write, proof, sandboxstatus en operations. Oude storageobjecten, projecten en secrets blijven gedurende de goedgekeurde rollbackwindow bestaan. Daarna worden secrets geroteerd en legacyproviders volgens afzonderlijk, geaudit cleanupbesluit gedecommissioned.

Destructieve cleanup, public-bucket disable/delete en oude authprojectdelete zitten nooit in dezelfde handeling als DNS- of webhookcutover.

## Alternatieven en afwijzingen

### Supabase/Lovable behouden

Afgewezen als doelarchitectuur. Het zou directe clientdataaccess, public/signed URL-coupling, een Lovable OAuth-broker en versnipperde RLS/Edge Function-logica behouden. Waardevolle SQL- en providerregels worden wel geport en met regressietests beschermd.

### Big-bang rewrite

Afgewezen. De huidige app bevat te veel onderling afhankelijke productlogica en echte datarelaties. Een strangler met één writer per slice verkleint migratie-, privacy- en rollbackrisico.

### Volledige migratie naar Next.js

Afgewezen voor deze uitvoering. De productspecificatie staat dit alleen toe na een ADR én werkende spike die lager totaalrisico bewijst. Zo'n bewijs bestaat niet; Vercel Web API Functions leveren de benodigde servergrens zonder alle React-routes te herschrijven.

### Neon Auth nu als runtimeauth

Uitgesteld, niet definitief afgewezen. De huidige React/Vite-client- en Next-specifieke serverroutes leveren nog geen bewezen Buildy-combinatie voor same-origin Vercel Web API, invites, Brevo-outbox, legacy mapping, step-up en session controls. De expliciete herbeoordelingsgate voorkomt permanente lock-in bij toekomstige verbetering.

### Auth als bearer/JWT in browserstorage

Afgewezen. XSS zou tokens uitleesbaar maken en onmiddellijke revocation/step-up verzwakken. Same-origin database-backed cookies zijn de gekozen default.

### Directe database- of storagecalls vanuit React

Afgewezen. Zij maken clientvelden, objectpaden en verspreide policies onderdeel van de security boundary. Alle data en grants lopen via de server-API.

### Publieke R2-buckets of permanente signed URLs

Afgewezen. Openbare projectstatus is een actuele applicatiepolicy, geen permanente storage-eigenschap. De authorized proxy kan toegang direct intrekken en houdt objectkeys privé.

### Peecho Print Button/widget

Afgewezen. De widget kan de immutable proof-, server-owned pricing-, state-machine-, idempotency- en supportgaranties niet dragen. Stripe direct plus Peecho REST blijft de gecontroleerde flow.

### Directe providercalls in requests of databasehooks

Afgewezen. Netwerkfalen mag een kerntransactie niet oncontroleerbaar maken. Transactionele outbox/inbox en durable jobs zijn verplicht.

## Consequenties en trade-offs

Positieve gevolgen:

- een heldere same-origin security boundary en geen uitleesbare browsersessietokens;
- providerwissels raken adapters, niet alle React-componenten;
- private media kan onmiddellijk op actuele privacy- en blockregels reageren;
- financiële, fulfilment- en deletionflows worden retrybaar, idempotent en operationeel zichtbaar;
- de gebruiker betaalt en bestelt aantoonbaar exact de goedgekeurde PDF-bytes;
- de migratie kan per slice worden getest, geobserveerd en teruggedraaid;
- bestaande IDs en bewezen commerce/deletionlogica kunnen behouden blijven.

Kosten en risico's:

- self-hosted Better Auth legt patching, configuration review, mailhooks en incidentrespons bij Buildy;
- Vercel Functions zijn ephemeral en hebben uitvoeringslimieten; PDF-, migration- en cleanupjobs moeten daarom resumable en begrensd zijn;
- een authorized image proxy kost compute en cacheontwerp, maar is noodzakelijk voor privacyrevocation;
- readmodels en outbox/inbox voegen tabellen, workers en eventual consistency toe;
- expliciete SQL-review en expand/migrate/contract kosten meer discipline dan schema push;
- tijdelijke dubbele infrastructuur verhoogt kosten tijdens de stranglerperiode;
- Better Auth is een extra abstraction op dezelfde Neon-database en moet op schema-/library-upgrades worden getest;
- providerwebhooks kunnen vertraagd of out-of-order zijn, waardoor de UI expliciete “wordt geverifieerd”-toestanden nodig heeft.

Mitigaties zijn contracttests, pinned dependencies, dependency/security-updates, provider-inboxreplay, operationele alerts, canaryflags, restore rehearsals en de Neon Auth-herbeoordelingsgate.

## Implementatieregels die uit dit ADR volgen

- Nieuwe code gebruikt `project` en `update`; legacy `trip`/`step` komt alleen in migratieadapters voor.
- Geen nieuwe import, envnaam of netwerkrequest naar Lovable of Supabase.
- Geen component importeert Drizzle, Better Auth servercode, R2 SDK of een provider-SDK.
- Geen provideradapter schrijft rechtstreeks statusvelden buiten de domeinservice/transitievalidator.
- Geen signed URL wordt persistent als canonical media- of PDF-URL opgeslagen.
- Geen payment/fulfilmentstate wordt afgeleid uit queryparameters of browserredirects.
- Geen order mag verwijzen naar een mutable proofobject.
- Geen destructive migration of objectdelete zonder export, manifest, verificatie en rollbackwindow.
- Geen environment mag live Stripe/Peecho/Brevoconfiguratie erven via een generieke fallback.
- Alle server-side featureflags defaulten naar uit wanneer configuratie ontbreekt.

## Officiële technische referenties

Deze bronnen zijn op 2026-08-04 geraadpleegd. Implementatie controleert bij provider- of major-versionupgrades opnieuw de actuele documentatie.

- [Vercel Functions](https://vercel.com/docs/functions) — Web API `fetch`-handlers, runtimemodel en function deployments.
- [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver) — verbindingen vanuit Vercel/serverless en keuze tussen HTTP en pooled/WebSocket-transacties.
- [Neon + Drizzle](https://neon.com/docs/guides/drizzle) — officiële Neon-integratie met Drizzle.
- [Neon Auth overview](https://neon.com/docs/auth/overview) en [Neon Auth SDK-wijziging van 30 januari 2026](https://neon.com/docs/changelog/2026-01-30) — managed Auth-model, React/Vite-clientvoorbeelden en de Next.js server-SDK-route waarop de herbeoordelingsgate is gebaseerd.
- [Drizzle Kit migrations](https://orm.drizzle.team/docs/kit-overview) en [`drizzle-kit generate`](https://orm.drizzle.team/docs/drizzle-kit-generate) — geversioneerde SQL-generation en migrationflow.
- [Better Auth cookies](https://better-auth.com/docs/concepts/cookies) — secure/HttpOnly cookies en same-origin/cross-domain aandachtspunten.
- [Better Auth security](https://better-auth.com/docs/reference/security) — SameSite, trusted origins, OAuth state/PKCE en CSRF-maatregelen.
- [Better Auth session management](https://better-auth.com/docs/concepts/session-management) — database-backed sessions, freshness, listing en revocation.
- [Better Auth database en hooks](https://better-auth.com/docs/concepts/database) en [lifecycle hooks](https://better-auth.com/docs/concepts/hooks) — Drizzle/Postgres-persistentie en gecontroleerde lifecycle-uitbreiding.
- [Cloudflare R2 S3 API](https://developers.cloudflare.com/r2/api/s3/) — provider-neutrale S3-compatibiliteit.
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) — doelgebonden tijdelijke grants en de expliciete waarschuwing dat deze bearer tokens zijn.
- [Cloudflare R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/) — buckets zijn standaard privé; Buildy activeert geen publieke buckettoegang.

## Beslisresultaat

Deze ADR is **Accepted for implementation**. Implementatie start met de auth/profiel-vertical slice, maar alleen nadat de live legacycatalogus en storage-inventory als migratiebron zijn vastgelegd. Iedere volgende slice moet de hierboven beschreven acceptance- en rollbackgates passeren. Afwijkingen vereisen een nieuwe ADR of een expliciete, gedateerde amendementsectie; tijdelijke implementatiegemakken wijzigen dit besluit niet.
