# Cybersecurity Audit

## Strengths

- Supabase Auth is used consistently for protected routes.
- Sensitive budget and contractor data has separate table treatment in migrations.
- Storage upload policies are scoped to the user's folder.
- Peecho pingback signature verification already exists.

## Changes Made

- Removed owner `UPDATE` and `DELETE` RLS policies for `photobook_orders`.
- Payment state is now changed only by Edge Functions using service role credentials.
- Stripe webhook verifies HMAC signature against the raw request body.
- Payment and fulfillment events are logged server-side in `photobook_order_events`.

## Risks Before Live

- `trip-media` is a public bucket. That is necessary for Peecho PDF fetches today, but private renovation media may be sensitive. Consider signed URLs or a dedicated public-only export bucket.
- User-generated images and descriptions are broadly displayed for public projects; moderation/reporting is not yet visible.
- Edge Functions use permissive CORS. Acceptable for Stripe/Peecho webhooks and Supabase invoke, but tighten origin checks before scale.
- No rate limiting on expensive PDF generation, AI floorplan function or auth flows beyond provider defaults.

## Required Before Paid Launch

- Configure Stripe webhook secret and test failed/expired/successful payment states.
- Confirm Peecho API credential storage and production/test separation.
- Add operational alerting for `fulfillment_status in ('failed', 'needs_configuration')`.
- Resolve the remaining Vite/esbuild dev-server advisory via a planned Vite major upgrade or a vetted patch path. High/critical npm audit findings were removed in this sweep.
