# Buildy — small MVP, one verified journey

## Read only what the task needs

Start with [GRAPH](docs/architecture/GRAPH.md) and [STATE](docs/architecture/STATE.md).
Then read the affected flow in [FLOWS](docs/architecture/FLOWS.md) and its linked code/tests.
These three files define the current small-MVP scope, boundaries and evidence.
Older release reports are historical; they do not authorize payments, a rewrite or extra launch gates.
Current code describes implementation; fresh runtime evidence describes deployment. Record disagreements instead of assuming a document is true.

## Product and constraints

**Maak van je verbouwing een verhaal om te bewaren.**
Finish: account → private renovation → saved photo/update → shared story → like/comment → digital Bouwboek.
Preserve the existing design and implementation. Stripe, Peecho, physical ordering, budget, floorplans and broad discovery are later.
Keep `CHECKOUT_MODE=off`. A running `public_demo` is not a working account-based MVP.
Google OIDC is the existing identity implementation, not permission to configure it or replace it without owner approval.
Do not turn authentication off, create a shared account or add guest identity to claim the target journey works.
No Computer Use. Use CLI/API and Playwright; owner performs personal sign-in or secret entry.
Do not purchase plans, publish private data or change production settings without task authorization.

## Change loop

1. Inspect git status first; preserve local work. Never reset/clean away founder changes.
2. Name one flow ID, affected graph nodes/edges, and the expected observable result.
3. Trace UI → API → authorization → persisted data. Fix the first broken edge, not the whole app.
4. Reuse the existing component/service/repository. Add a dependency or abstraction only for a demonstrated blocker.
5. Run focused tests, then the relevant canonical checks before integration. Keep security and required CI checks intact.
6. Verify the result after reload and under a second role where applicable. Distinguish mocks from real hosted providers.
7. Update the affected graph/flow only when its contract changes; update STATE with exact evidence and one next action.

## Boundaries that must survive simplification

- Browser uses typed same-origin API clients, never database credentials. Direct Blob upload requires server-issued scoped authorization.
- Derive identity, ownership and access server-side. Keep RLS and least-privilege roles; a hidden button is not security.
- Keep private media private. Recheck access on reads and after link revocation, follower removal, blocking and deletion.
- Preserve state/nonce/PKCE, secure hashed sessions, mutation origin/CSRF checks and safe redirects.
- Do not leak secrets, session cookies, bypass tokens, private URLs or personal content into commits, logs or evidence.
- Keep mutations retry-safe. Use append-only migrations only when necessary; never rewrite applied migrations or drop customer data to simplify.
- Reuse request-driven media processing. Digital Bouwboek must not depend on printproof, payment or a print worker.
- Validate account deletion and cleanup; never invent retention approval or silently rotate encryption keys.

## Verification and handoff

Read [package.json](package.json) and [CI](.github/workflows/ci.yml) for exact commands.
For code changes use relevant tests plus typecheck, lint and build; database/access changes also need real PostgreSQL/RLS tests.
For a release, keep required CI and prove the affected real hosted journeys on the recorded SHA. Browser-tool brand is not a gate.
For documentation-only changes validate links, scope, diagrams and diff; do not run or build an unrelated product workstream.
Finish with changed flow, evidence, remaining blocker and one next action. Do not claim deployment or GO from test counts alone.
