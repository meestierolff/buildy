# Launch Backlog

## P0 Before Real Payments

- Configure Stripe live secrets and webhook endpoint.
- Configure Peecho production API URL, merchant API key, offering ID and product dimensions.
- Verify one live paid Bouwboek order from Stripe to Peecho to shipment.
- Add buyer terms, privacy, refund and support links in checkout-adjacent UI.
- Add alerting or dashboard for `paid_pending_fulfillment`, `needs_configuration`, and `failed`.

## P1 Before Public Beta

- Add authenticated Playwright storage-state test pass.
- Add a post-payment success state on `/trip/:id/photobook`.
- Add analytics events for checkout start/success/failure.
- Add owner-facing order progress timeline.
- Split `Photobook.tsx` into smaller modules.

## P2 Growth

- SEO landing pages for renovation diary and Bouwboek keywords.
- Sample/demo content library.
- Contractor/designer Pro positioning.
- Referral/share loops for public project pages.
