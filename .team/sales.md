# Sales Audit

## Revenue Surface

- Primary: paid Bouwboek checkout.
- Potential: Pro accounts for multiple projects, higher storage, white-label contractor pages.
- Potential B2B: contractors/interior designers documenting work for clients.

## Changes Made

- Added Buildy-owned checkout foundation so Buildy can capture payment before Peecho fulfillment.
- Added order payment amount and fulfillment status to support support/sales operations.

## Pricing Notes

- Current default pricing is `€12,95 + €0,75 per page`, configurable via Edge Function secrets.
- Before production, validate Peecho COGS, shipping, VAT and Stripe fees against this price.

## Sales Risks

- Shipping price and tax handling are not yet fully modeled in the visible UI.
- Fulfillment failures need a human-readable support path.
- Refund policy and buyer terms must be available before real payments.
