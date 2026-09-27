# Buildy — small MVP, one verified journey

## Read only what the task needs

Start with [GRAPH](docs/architecture/GRAPH.md) and [STATE](docs/architecture/STATE.md).
Then read the affected flow in [FLOWS](docs/architecture/FLOWS.md) and its linked code/tests.
These three files define the current small-MVP scope, boundaries and evidence.
Older release reports are historical; they do not authorize payments, a rewrite or extra launch gates.
Current code describes implementation; fresh runtime evidence describes deployment. Record disagreements instead of assuming a document is true.

## Product and constraints

**Maak van je verbouwing een verhaal om te bewaren.**
Finish: account → private renovation → saved Bouwmoment → chronological story → project follow/reaction/comment → canonical Bouwboek → real quote → Stripe Checkout → owner-released Peecho order.
Preserve the existing React/Vite, Vercel, Neon, private Blob, design and implementation. Stripe/Peecho are now authorized scope; budget, floorplans, chat, broad discovery and a replacement stack remain outside it.
Keep `CHECKOUT_MODE=off` during the first connectivity slice. Prove one real Peecho hardcover product and three valid quotes before connecting Stripe test checkout. A running `public_demo` is not a working account-based MVP.
Following targets one renovation, never silently all projects of its owner; reuse suitable existing relations without a second competing follow system. Following grants no edit rights or bypass of private/revoked access.
Use one canonical, globally chronological book document for preview, page count, quote and PDF. A digital preview alone is not proof of a printable book.
The owner authorized replacing Google OIDC with username/password signup and login.
New username accounts collect no email. Use Node crypto scrypt password hashes,
hashed server-owned sessions, HttpOnly cookies, same-origin CSRF checks and rate limiting.
Do not reintroduce OAuth configuration or silently link retained Google accounts.
Password recovery is not implemented; do not promise it.
Do not turn authentication off, create a shared account or add guest identity to claim the target journey works.
Use CLI/API and Playwright where practical; the owner explicitly authorizes Computer Use for the Buildy setup, including the existing Peecho dashboard. Owner performs login/MFA, sandbox signup and any secret entry that tools cannot keep out of output. Never rotate existing credentials.
Do not purchase plans, publish private data or change production settings without task authorization.
No real order, payment, release, cancellation, credits, wallet deposit or physical proof during setup. Later tests may use bounded sandbox orders with synthetic data; real spending requires separate approval of amount, copies, address and final file. No automatic fulfilment: an authorized owner action releases a verified paid revision.
Live ordering remains gated on approved real production quote/margin, operator details, Stripe account, commercially permitted hosting and print handling. Preserve the account app and test checkout when only live approval is missing; report live sales inactive.

## Change loop

1. Inspect git status first; preserve local work. Never reset/clean away founder changes.
2. Name one flow ID, affected graph nodes/edges, and the expected observable result.
3. Trace UI → API → authorization → persisted data. Fix the first broken edge, not the whole app.
4. Reuse the existing component/service/repository. Add a dependency or abstraction only for a demonstrated blocker.
5. Validate the actual change once with focused checks. Do not add procedural gates or repeatedly poll unchanged blockers. Preserve runtime security; required CI runs at integration.
6. Verify the result after reload and under a second role where applicable. Distinguish mocks from real hosted providers.
7. Update the affected graph/flow only when its contract changes; update STATE with exact evidence and one next action.

## Boundaries that must survive simplification

- Browser uses typed same-origin API clients, never database credentials. Direct Blob upload requires server-issued scoped authorization.
- Derive identity, ownership and access server-side. Keep RLS and least-privilege roles; a hidden button is not security.
- Keep private media private. Recheck access on reads and after link revocation, follower removal, blocking and deletion.
- Preserve salted password hashing, secure hashed sessions, mutation origin/CSRF checks,
  rate limiting and safe redirects. Never log passwords or store them in browser persistence.
- Do not leak secrets, session cookies, bypass tokens, private URLs or personal content into commits, logs or evidence.
- Keep Peecho test credentials/products separate from production. Verify only presence, scope and API success; no credentials in screenshots, traces, `VITE_*` or client bundles. Use safe secret entry into the correct environment or a gitignored local file.
- Keep mutations retry-safe. Use append-only migrations only when necessary; never rewrite applied migrations or drop customer data to simplify.
- Reuse request-driven media processing. Digital Bouwboek must not depend on printproof, payment or a print worker.
- Ordering uses the approved immutable book revision and server-validated quote. Verified Stripe payment, not a redirect, marks it paid. Duplicate webhooks or release retries must not create another charge/order; reconcile uncertain Peecho create/pay outcomes before retrying.
- Keep print files private; grant Peecho temporary server-owned access only to the paid revision, supporting HEAD/GET/Range and retries. No arbitrary customer fetch URLs or permanent public files.
- Validate account deletion and cleanup; never invent retention approval or silently rotate encryption keys.

## Verification and handoff

Read [package.json](package.json) and [CI](.github/workflows/ci.yml) for exact commands.
Use checks proportionate to the changed behavior; avoid repeating full suites during development. Database/access changes need real PostgreSQL/RLS evidence. Required CI provides typecheck, lint and build at integration.
For a release, keep required CI and prove the affected real hosted journeys on the recorded SHA. Browser-tool brand is not a gate.
Normal non-destructive commit/push/PR/merge/deploy is authorized after required checks and proven production configuration/core flow. Preserve the current deployment as rollback, verify the built SHA and public smoke, and clean only this run's test data. This does not authorize live ordering or paid upgrades.
For documentation-only changes validate links, scope, diagrams and diff; do not run or build an unrelated product workstream.
Finish with changed flow, evidence, remaining blocker and one next action. Do not claim deployment or GO from test counts alone.
