# Verification Log

## Automated Checks

Last run in this sweep:

- `bun test` — passed, 9 tests.
- `npm run lint` — passed.
- `bunx tsc --noEmit` — passed.
- `npm run build` — passed, with existing Vite chunk-size warning.
- `bunx playwright test` — passed, 14 tests and 1 owner-only checkout test skipped.
- `npm audit --audit-level=moderate` — improved from 19 advisories to 2 remaining moderate advisories in Vite/esbuild dev-server tooling. NPM recommends `npm audit fix --force`, which would jump to Vite 8 and should be treated as a separate breaking upgrade.

## Playwright Crawl

Public crawl completed against `http://127.0.0.1:8090`:

- Home.
- Auth.
- Friends search.
- Trip detail.
- Timeline, floorplan and all-photos tabs.
- Timeline image/lightbox interaction.
- Photobook spread navigation.
- Budget.
- Profile.
- Protected favorites/new-project redirects.

Result: no page errors or console errors after making photobook order history backward-compatible with the not-yet-migrated remote schema.

Authenticated owner crawl:

- Playwright browser was opened for login with `--save-storage=tests/e2e/.auth/user.json`.
- No storage state was saved in this run, so owner-only crawl could not be completed yet.
- Existing Playwright suite still confirms protected pages redirect when unauthenticated.

## External Documentation Checked

- Stripe Checkout Session creation docs: use Checkout Sessions with `mode=payment`, line items, shipping address collection, success/cancel URLs and `client_reference_id`.
- Stripe webhook docs: verify events with the raw body, `Stripe-Signature` header and endpoint secret.
- Peecho Print API guidance: customer payment can happen in your own checkout first, then a Peecho API order is created using merchant API credentials, product/offering ID, file details and address details.

## Deployment Order

1. `supabase db push`.
2. Set Stripe and Peecho secrets.
3. Deploy `create-photobook-checkout`.
4. Deploy `stripe-webhook`.
5. Deploy `peecho-pingback`.
6. Configure Stripe webhook endpoint.
7. Configure Peecho status webhook endpoint.
8. Place a test paid order end-to-end.
