# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## Buildy launch configuration

### Local checks

```sh
bun test
bunx tsc --noEmit
bun run lint -- --max-warnings=0
bun run build
bunx playwright test
```

Playwright starts the Buildy dev server at `http://127.0.0.1:8090` by default. Set `PLAYWRIGHT_BASE_URL` if you want to test against another running environment.

To run owner-only flows with your own account:

```sh
mkdir -p tests/e2e/.auth
bunx playwright open --save-storage=tests/e2e/.auth/user.json http://127.0.0.1:8090/auth
PLAYWRIGHT_STORAGE_STATE=tests/e2e/.auth/user.json bunx playwright test
```

### Buildy Bouwboek checkout

The app now uses a Buildy-owned checkout flow:

1. Buildy generates a print-ready PDF in the browser.
2. The PDF is uploaded to the public `trip-media` bucket so Peecho can fetch it.
3. Buildy creates a local `photobook_orders` row.
4. `create-photobook-checkout` creates a Stripe Checkout Session for the customer.
5. `stripe-webhook` verifies Stripe's signature, marks the order as paid, and attempts Peecho fulfillment.
6. If Peecho API credentials are missing, the order stays in `paid_pending_fulfillment` so it can be picked up operationally instead of failing silently.

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
supabase secrets set STRIPE_SHIPPING_COUNTRIES="NL,BE,DE"
```

Server-side Supabase secrets for Peecho fulfillment and status webhooks:

```sh
supabase secrets set PEECHO_SECRET_KEY="..."
supabase secrets set PEECHO_ORDER_API_URL="https://www.peecho.com/rest/v3/order/"
supabase secrets set PEECHO_MERCHANT_API_KEY="..."
supabase secrets set PEECHO_OFFERING_ID="..."
supabase secrets set PEECHO_CONTENT_WIDTH_MM="297"
supabase secrets set PEECHO_CONTENT_HEIGHT_MM="210"
```

Deploy the functions after setting secrets:

```sh
supabase db push
supabase functions deploy create-photobook-checkout
supabase functions deploy stripe-webhook
supabase functions deploy peecho-pingback
```

Configure Stripe's webhook endpoint for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `checkout.session.expired`:

```txt
https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook
```

Configure Peecho's `Status update URL` webhook to keep delivery status synced:

```txt
https://YOUR_PROJECT_REF.supabase.co/functions/v1/peecho-pingback
```

The webhook verifies Peecho's `signature` as `SHA256(PEECHO_SECRET_KEY + order_id)` and updates the local `photobook_orders` row via `order_reference`.

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
