# Design Audit

## Strengths

- Buildy has a focused product metaphor: project, update, Bouwboek.
- The photobook preview is emotionally strong and close to the Polarsteps-style mental model.
- Timeline, floorplan, budget and all-photos tabs map well to renovation workflows.

## Changes Made

- Recent photobook work added page-level photo grouping and extra text pages.
- Timeline background now uses a renovation blueprint visual language.
- Checkout copy now explains Buildy payment first and Peecho fulfillment second.

## UX Risks

- The photobook editor controls are powerful but dense. Owners need confidence that dragging photos affects the book, not the project timeline.
- Checkout starts after PDF generation, so users wait before seeing Stripe. Add progress phases if generation takes long.
- There is no post-payment confirmation page; users return to the photobook with order history only.

## Next Design Moves

- Add an explicit "Betaling gelukt, Bouwboek in productie" return state.
- Add a small order timeline: PDF klaar, betaald, naar Peecho, in productie, verzonden.
- Consider an "admin/retry" empty state for fulfillment issues.
- Do a mobile-specific pass on photobook editing controls.
