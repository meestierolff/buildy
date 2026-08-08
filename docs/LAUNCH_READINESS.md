# Launch readiness

**Peildatum:** 8 augustus 2026  
**Besluit:** **NO-GO voor publieke productie, publieke registratie en live
betalingen.** De lokale code- en browsergates zijn groen, maar echte provider-,
staging-, restore- en fysieke-proefdrukbewijzen ontbreken nog.

Een gate wordt alleen `GO` met een controleerbaar artifact en werkelijke
environmenttest. `CODE READY` betekent uitsluitend dat de repositorykant is
geïmplementeerd en lokaal/CI kan worden bewezen.

## Technische gates

| Gate | Status | Bewijs / resterend |
|---|---|---|
| Doelarchitectuur | CODE READY | React/Vite praat via typed API met Neon/Drizzle; actieve runtime-scan bevat geen oude prototypeprovider/oude BaaS-provider-koppeling |
| Legacy decommission | GO (repository) | statische launchcheck 7/7 groen; actieve bron- en package-scan bevat geen legacy runtimekoppeling of retired providerpaden |
| Typecheck en lint | GO | `bun run typecheck` exit 0; `bun run lint` exit 0 |
| Unit/integratietests | GO | `bun run test` exit 0; 810 passed, 20 skipped |
| Productiebuild | GO | `bun run build` en `bun run check:bundle` exit 0; grootste JS-asset 235.1 KiB raw / 67.6 KiB gzip |
| Migraties | PARTIAL | 24 migrations statisch gevalideerd en in CI toegepast; echte apply/verify/no-op buiten CI blijft nog te bewijzen voor `0013–0024` |
| Least-privilege DB-rollen | CODE READY | configure/verify-scripts en readinessprobes bestaan; tegen doel-Neon nog niet bewezen |
| Private R2-media | CODE READY | korte doelgebonden grants, proxy/readback/checksum en workers getest met fakes; echte private bucket/CORS/delete ontbreekt |
| Better Auth | CODE READY | HttpOnly-cookieflow, verificatie, magic link, reset, sessies en server-authz getest; echte Neon/Brevo/Google-config ontbreekt |
| Private bèta | CODE READY / ENV NO-GO | transactionele invite-only e-mail/Google-signup, expiry/usage/allowlist, veilige CLI, bèta-UI en 18 privacy-minimale events zijn geïmplementeerd; target-rolegrants, stagingrace/OAuth en retentiebesluit ontbreken nog |
| Project/update/social/planning | CODE READY | typed reads/writes, privacy/access, comments/reactions/notificaties, floorplans en budget hebben tests; volledige authenticated browsermatrix ontbreekt |
| Projectdelete | CODE READY | project- en update-deletion-saga zijn append-only gemigreerd; echte staging-/storagefaultinjectie blijft nog open |
| Bouwboek/proof | CODE READY | canonical model, deterministische renderer, echte private proof-viewer en receipt-gebonden goedkeuring zijn lokaal groen; echte staging proof/printcontrole ontbreekt |
| Stripe checkout/webhook | CODE READY | server-owned prijs, raw signature, account/environment, idempotency en statusmachine getest; sandboxbetaling ontbreekt |
| Peecho fulfilment | CODE READY | adapter, leases, create/payment-scheiding, canonical callbacks, retries/manual review getest; sandboxorder en proefdruk ontbreken |
| Transactionele mail | PARTIAL | auth-, order-, community-, welcome-, access-, security- en migratiemail hebben een duurzame, leasegebonden, AAD-gebonden en least-privilege workergrens; echte Brevo-delivery en providerbewijs ontbreken |
| Moderatie/support | PARTIAL | privacy-first intake en receipts bestaan; bevoegde moderator-RBAC/adminqueue/hide-restore/warning-suspension ontbreken nog of blijven fail-closed |
| Observability/alerts | PARTIAL | structured PII-redacted logs, readiness en query/runbooks bestaan; externe monitor, thresholds en storingsproef ontbreken |
| Backup/restore | NO-GO | procedure bestaat; geen echte restore rehearsal op een niet-productie Neon-branch |
| Accessibility | PARTIAL | publieke axe-suite is lokaal groen (3/3); protected/manual screenreaderacceptatie blijft open |
| Performance | NO-GO | route splitting aanwezig, maar hoofdchunkwaarschuwing en Lighthouse-doelen zijn niet finaal bewezen |
| Visual regression | PARTIAL | 102/102 baselinecaptures plus 14/14 synthetische quality-screenshots groen; authenticated/ownerstagingbewijs blijft open |
| Launchcheck | GO (static) | `bun run check:launch -- --static` 7/7 groen; live stagingprobe blijft bewust apart |

## Externe gates

Alle onderstaande gates zijn `NO-GO`; zie
`docs/EXTERNAL_INPUTS_REQUIRED.md` voor de exacte waarden en bewijsstukken.

| Gate | Vereist bewijs |
|---|---|
| Juridische identiteit en policies | goedgekeurde seller/contactdata, voorwaarden/privacy/content/huisregels/leeftijd en retentie |
| Primair domein | Vercel inspect, DNS, HTTPS, apex/www, auth origins, CORS/CSP en redirects |
| Neon | eigen project/regio/plan/DPA, rollen, apply/verify/no-op en restore rehearsal |
| Cloudflare R2 | private bucket, CORS/lifecycle, upload/read/delete/checksum en anonieme denial |
| Brevo | aparte sender, SPF/DKIM/DMARC, templates, testmail en deliverycallback |
| Google OAuth | eigen client, exacte redirect/origins en linking/delete-test |
| Stripe | dedicated account, sandboxbetaling/webhook/reconcile; live pas met apart akkoord |
| Peecho | sandbox offering/quote/create/payment/callback, credits/invoicing en ontvangen fysieke proefdruk |
| Scheduler/monitoring | ondersteunde cronfrequentie, alerts, on-call en fault-injectionbewijs |
| Legacy data/storage | inventory, rehearsal, final delta, reconciliatie, rollbackwindow en secretrotatie |
| Private bèta/moderatie | invitebeleid/testers, moderators, support- en escalatieproces |

## Go-besluit

Publieke registratie kan pas aan wanneer auth/bèta, legal, domein, Brevo, Google
(indien aangeboden), moderatie, privacy en restore groen zijn. Checkout kan pas
aan wanneer daarnaast Stripe, prijs/seller/terms, ordermail, Peecho, R2,
scheduler/alerts en fysieke proefdruk groen zijn. Een capability wordt afzonderlijk
fail-closed gehouden; een ontbrekende printgate hoeft projectgebruik in een
private stagingbèta niet te blokkeren.

De kortste gecontroleerde route is:

1. Rond codegates voor beta, projectdelete, e-mail, moderation/admin,
   performance en finale browseracceptatie af.
2. Maak stagingproviders met gescheiden credentials en pas alle migrations toe.
3. Migreer synthetische/rehearsaldata, bewijs R2 privacy en voer de volledige
   staging launchcheck uit.
4. Voer Stripe/Peecho/Brevo-sandboxflows, fault injection en Neon restore uit.
5. Ontvang en keur een fysieke proefdruk goed.
6. Laat legal/privacy/boekhouder en operations hun gates tekenen.
7. Voer legacy freeze/final delta/reconciliatie uit, roteer oude secrets en
   start een begrensde private bèta vóór enige publieke/live activering.
