# Buildy

Buildy is een sociaal verbouwingsdagboek: bewoners leggen hun project vast in
updates, volgen elkaar en maken van hun verhaal een gedrukt Bouwboek. De frontend
is React/TypeScript met Vite, Tailwind en shadcn/ui; Supabase verzorgt auth,
PostgreSQL, storage en Edge Functions. Stripe handelt de betaling af en Peecho
verzorgt print en fulfilment.

## Lokaal starten

Vereisten: [Bun](https://bun.sh/) en, voor de lokale backend, Docker plus de
Supabase CLI.

```sh
cp .env.example .env.local
bun install
bun run dev
```

Vul minimaal `VITE_SUPABASE_URL` en `VITE_SUPABASE_PUBLISHABLE_KEY` in. Voor een
schone lokale database:

```sh
bunx supabase start
bunx supabase db reset
```

De belangrijkste productroutes zijn `/`, `/auth`, `/trips/new`, `/trip/:id`,
`/trip/:id/photobook`, `/vrienden`, `/account` en `/bestelling/:orderId`.

## Buildy launch configuration

### Local checks

```sh
bun run typecheck
bun run lint
bun test
bun run build
bun run test:e2e:preview
bun run check:launch
```

Playwright starts the Buildy dev server at `http://127.0.0.1:8090` by default. Set `PLAYWRIGHT_BASE_URL` if you want to test against another running environment.

To run owner-only flows with your own account:

```sh
mkdir -p tests/e2e/.auth
bunx playwright codegen --save-storage=tests/e2e/.auth/user.json http://127.0.0.1:8090/auth
PLAYWRIGHT_STORAGE_STATE=tests/e2e/.auth/user.json bunx playwright test
```

### Buildy Bouwboek checkout

The app now uses a Buildy-owned checkout flow:

1. Buildy generates and validates a print-ready PDF in the browser.
2. The PDF is uploaded to the private `photobook-pdfs` bucket.
3. `create-photobook-checkout` verifies ownership, PDF bytes/page count, launch configuration and the server-owned price before it creates the order and an idempotent Stripe Checkout Session.
4. The customer sees the exact total (book, VAT-inclusive price and shipping) before opening Stripe.
5. `stripe-webhook` verifies Stripe's signature, session identity, subtotal, shipping, exact total and currency, then atomically claims fulfillment.
6. The webhook creates a Peecho order and calls Peecho's separate `/order/payment` endpoint. Only after that second call is the book submitted to production.
7. Peecho receives a temporary signed PDF URL; terminal orders remove the private source PDF.

Checkout is intentionally fail-closed: missing price, shipping, Stripe or Peecho configuration prevents payment instead of accepting money for an order that cannot be fulfilled. The Peecho account must have sufficient credit or an invoicing agreement for `/order/payment` to succeed.

Legacy client-side Peecho button env is still supported by helper code but no longer shown in the main order dialog:

```sh
VITE_PEECHO_SCRIPT_URL="https://d3aln0nj58oevo.cloudfront.net/button/script/YOUR_BUTTON_KEY.js"
# or:
VITE_PEECHO_BUTTON_KEY="YOUR_BUTTON_KEY"
```

Server-side Supabase secrets for Stripe checkout:

```sh
supabase secrets set STRIPE_SECRET_KEY="sk_live_..."
supabase secrets set STRIPE_WEBHOOK_SECRET="whsec_..."
supabase secrets set SITE_URL="https://buildy.app"
supabase secrets set PHOTOBOOK_CURRENCY="eur"
supabase secrets set PHOTOBOOK_BASE_PRICE_CENTS="1295"
supabase secrets set PHOTOBOOK_PRICE_PER_PAGE_CENTS="75"
supabase secrets set PHOTOBOOK_SHIPPING_PRICE_CENTS="695"
supabase secrets set PHOTOBOOK_PRICES_INCLUDE_VAT="true"
supabase secrets set PHOTOBOOK_DELIVERY_ESTIMATE="5–10 werkdagen na productie"
supabase secrets set PHOTOBOOK_TERMS_VERSION="2026-07-15"
supabase secrets set SELLER_LEGAL_NAME="Exacte juridische verkopersnaam"
supabase secrets set SELLER_CONTACT_EMAIL="bestellingen@example.com"
supabase secrets set SELLER_CONTACT_PHONE="+31 20 123 45 67"
supabase secrets set SELLER_POSTAL_ADDRESS="Straat 1, 1234 AB Plaats, Nederland"
supabase secrets set SELLER_REGISTRATION_NUMBER="KvK 12345678 · btw-id NL..."
supabase secrets set STRIPE_SHIPPING_COUNTRIES="NL,BE,DE"
supabase secrets set STRIPE_AUTOMATIC_TAX="true" # optional; configure Stripe Tax first
```

Server-side Supabase secrets for Peecho fulfillment and status webhooks:

```sh
supabase secrets set PEECHO_SECRET_KEY="..."
supabase secrets set PEECHO_ORDER_API_URL="https://www.peecho.com/rest/v3/order/"
supabase secrets set PEECHO_PAYMENT_API_URL="https://www.peecho.com/rest/v3/order/payment" # optional; derived by default
supabase secrets set PEECHO_MERCHANT_API_KEY="..."
supabase secrets set PEECHO_OFFERING_ID_A4_LANDSCAPE="..."
supabase secrets set PEECHO_OFFERING_ID_A4_PORTRAIT="..."
supabase secrets set PEECHO_OFFERING_ID_SQUARE_210="..."
supabase secrets set PEECHO_PDF_SIGNED_URL_TTL_SECONDS="2592000"
supabase secrets set PHOTOBOOK_ABANDONED_PDF_RETENTION_HOURS="48"
supabase secrets set PHOTOBOOK_PAID_PDF_MAX_RETENTION_DAYS="90"
supabase secrets set PHOTOBOOK_PDF_COMPLAINT_RETENTION_DAYS="30"
supabase secrets set PHOTOBOOK_RETENTION_CRON_SECRET="a-long-random-secret"
```

AI-blauwdrukken staan standaard zowel in de frontend als server-side uit. Zet ze
pas aan nadat de leveranciers-/privacybeoordeling, een kostenalarm en de
daglimiet zijn goedgekeurd:

```sh
# frontend build
VITE_AI_BLUEPRINT_ENABLED="true"

# Supabase secrets
supabase secrets set AI_BLUEPRINT_ENABLED="true"
supabase secrets set AI_BLUEPRINT_DAILY_LIMIT="3"
supabase secrets set LOVABLE_API_KEY="..."
```

Deploy the functions after setting secrets:

```sh
supabase db push
supabase functions deploy create-photobook-checkout
supabase functions deploy stripe-webhook
supabase functions deploy peecho-pingback
supabase functions deploy cleanup-photobook-retention
supabase functions deploy delete-account
supabase functions deploy floorplan-blueprint
```

Deploy `floorplan-blueprint` ook wanneer AI uit blijft: de geharde versie dwingt
de server-side featureflag en het dagquotum af en faalt standaard gesloten.

Schedule a daily authenticated `POST` to
`/functions/v1/cleanup-photobook-retention` with header
`x-cron-secret: $PHOTOBOOK_RETENTION_CRON_SECRET`. It deletes delivered-book PDFs
after the complaint window, abandoned checkout PDFs after their short TTL, and
paid PDFs at the configured hard maximum even when a Peecho pingback never
arrives. `SHIPPED` starts the complaint-retention window because Peecho API v3
does not guarantee a later `DELIVERED` callback. The job also purges anonymized
fiscal order archives only after their seven-year `retain_until` date. Open
checkouts and paid/refunded orders whose physical Peecho fulfillment is not yet
shipped, delivered or provider-confirmed cancelled deliberately block account deletion.

Configure Stripe's webhook endpoint for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `refund.created`, and `refund.updated`. `STRIPE_WEBHOOK_SECRET` must be the signing secret for this exact endpoint and environment. Refund events update the customer-visible status idempotently, but deliberately leave Peecho fulfillment in manual review: a Stripe refund is not proof that the physical print order was cancelled.

```txt
https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook
```

Configure Peecho's `Status update URL` webhook to keep delivery status synced:

```txt
https://YOUR_PROJECT_REF.supabase.co/functions/v1/peecho-pingback
```

The webhook verifies Peecho's `signature` as `SHA256(PEECHO_SECRET_KEY + order_id)` and updates the local `photobook_orders` row via `order_reference`.

Each new order stores the exact VAT-inclusive quote, delivery promise, allowed
countries, seller identity, accepted terms version and personalized-product
exception in `checkout_snapshot`. These values are also shown on the authenticated
order page and retained in the minimized fiscal archive when an account is deleted.

> **Launch blocker:** the repository does not yet send a durable transactional
> order confirmation by email or PDF. A Stripe receipt is not a replacement for
> the complete Buildy sales confirmation. Before enabling live payments, connect
> a transactional mail provider and verify that the buyer receives the order,
> exact price/shipping/VAT, delivery promise, seller details and applicable terms
> version in a form they can retain. Do not announce or accept real orders until
> this test mail succeeds and the legal seller fields above match the public legal
> pages, Stripe account and support channel.

## Productiedeployment

1. Rond eerst alle P0-punten in [LAUNCH_READINESS.md](./LAUNCH_READINESS.md) af.
2. Koppel het productiedomein met geldige DNS en HTTPS en zet `VITE_SITE_URL` en
   `SITE_URL` op exact die origin.
3. Vul de expliciete productieconfiguratie uit `.env.example` als hosting- en
   Supabase-secrets in. Gebruik geen testkeys of voorbeeldwaarden.
4. Link de juiste Supabase-projectref, voer `supabase db push` uit en deploy alle
   Edge Functions, inclusief `cleanup-photobook-retention`.
5. Configureer de Stripe-webhook en Peecho-statuscallback, en plan de dagelijkse
   retentiejob met het aparte cronsecret.
6. Draai de volledige lokale suite en vervolgens tegen productie:
   `bun run check:launch`, `bun run audit:private-assets` en
   `bun run audit:social`. Valideer de elf social-FK's pas nadat de audit
   `PASS` geeft; de exacte SQL staat in [LAUNCH_READINESS.md](./LAUNCH_READINESS.md).
7. Rond daarna één gecontroleerde Stripe/Peecho-testorder end-to-end af.

Een geslaagde build is geen launch-go: DNS, live secrets, sellergegevens,
providercontracten, duurzame orderbevestiging en een echte fulfilmenttest zijn
expliciete releasevoorwaarden.
