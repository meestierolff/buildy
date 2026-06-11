# Engineering Audit

## Strengths

- Clear React/Vite/Supabase stack with simple route surface.
- Photobook editor already handles PDF generation, preview, page count padding and Supabase upload.
- Playwright and Vitest are present and cover core public flows.
- Supabase Edge Functions already exist for AI floorplan processing and Peecho pingbacks.

## Changes Made

- Introduced server-side Stripe Checkout creation via `supabase/functions/create-photobook-checkout`.
- Introduced Stripe webhook processing via `supabase/functions/stripe-webhook`.
- Added order payment and fulfillment columns in `20260611120000_photobook_stripe_checkout.sql`.
- Added `photobook_order_events` as an audit trail for checkout, Stripe and Peecho events.
- Updated `Photobook.tsx` to redirect to Stripe after generating and uploading the print-ready PDF.

## Launch Risks

- `src/pages/Photobook.tsx` is large and owns too many responsibilities: data fetching, editor, preview, print ordering and multiple helper components. Split after launch pressure drops.
- Several pages still use `any` heavily; Supabase types exist but are not consistently applied.
- Checkout currently depends on browser-side PDF generation. That is fast to ship, but server-side generation would be more robust for retries and fulfillment recovery.
- Stripe webhook can create a Peecho order, but Peecho payment/submission details depend on account-specific API setup.

## Next Engineering Moves

- Add an order detail/admin view for `paid_pending_fulfillment`.
- Add retry button or scheduled job for failed Peecho fulfillment.
- Extract photobook page building into testable pure modules.
- Add tests around checkout function payload construction and webhook state transitions.
