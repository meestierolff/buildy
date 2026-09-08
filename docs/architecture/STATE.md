# Current state and next action

Only mutable progress sheet for the small MVP. Scope: [GRAPH](GRAPH.md),
acceptance: [FLOWS](FLOWS.md). An online demo is not an account-based MVP.

## Current slice — F0 → F1, 2026-09-08

The owner requested username/password accounts instead of Google OAuth. The
active UI/API now registers and signs in with those credentials, without email
collection, a Google client or a callback. New passwords use salted versioned
scrypt; sessions are opaque, hashed and HttpOnly. Origin checks, separate
signup/signin network limits and blinded username limits remain server-owned.
Google identities/data remain, with no automatic account linking or password
recovery claim. Migration `0051` is append-only and adds account restriction
locking, immediate session revocation and final credential/session erasure.

- Branch: `release/free-mvp-20260908`; [draft PR #4](https://github.com/meestierolff/buildy/pull/4).
- Application source: `14e747aa9c21e708240ee5dabc290d97137e2f6f`.
  Linux visual baselines and this evidence sheet follow without app code changes.
  Final automatic results are linked from [the PR checks](https://github.com/meestierolff/buildy/pull/4/checks).
- Original founder work is preserved: all 53 tracked changes and six untracked
  file contents were backed up outside Git. Checkpoints `9646319` and `ea68951`
  retain payment hardening and the other local changes separately. Architecture
  PR #3 was merged normally at `9783285`, with no discarded edits or conflicts.
- The existing landing/photo draft, design and digital-book path remain. The
  earlier 320px composer correction is preserved. Checkout remains off.

## Fresh evidence

| Boundary | Result |
| --- | --- |
| Static/unit | Typecheck, ESLint, 154 files / 1,031 tests, build, bundle budget and nine static launch checks PASS |
| PostgreSQL 16 | All 51 migrations apply and replay as a no-op; role isolation and `db/verify.ts` PASS: 55 tables, 45 RLS. Full canonical integration slice: 19 files / 34 tests PASS |
| New auth DB tests | Seven real tests include signup → app actor → private project → logout denial → relogin → same project; duplicate rollback, session isolation, restriction races, deletion, worker denial and export secrecy also PASS |
| Local browsers | Full Playwright: 243/244 passed; sole failure was landing text wrapping after auth copy changed. Fixed that copy; all 19 affected auth/handoff/visual checks PASS against rebuilt app and original landing baselines |
| Auth visuals | Login and signup reviewed at 320/390/1440; no overflow. Six actual Darwin baselines added; six Linux counterparts were reviewed and copied byte-for-byte from actual source CI diagnostics |
| Real local user | Unmocked browser → API → restricted PostgreSQL signup, private project creation, reload, logout denial, wrong-password/outsider-write denial and same account/project after relogin PASS |
| Hosted CI | Source run [34200752218](https://github.com/meestierolff/buildy/actions/runs/34200752218): build, quality, unit, audit, migrations, DB integration and core browser jobs PASS; public job: 73 PASS, only six missing-snapshot errors. The six Linux baselines are now present; final-head CI is tracked in the PR checks above |
| Hosted customer journey | NOT_RUN. No real hosted three-photo persistence, friend interaction, link/media revocation or account-MVP release claim |

Real local browser evidence was recorded 07:43:00–07:43:03 UTC in
`/private/tmp/buildy-real-local-account-20260908/evidence.json`; masked screenshots
include `02-same-renovation-after-relogin.png`. This test had no Blob and did not
verify photo uploads or account-lifecycle runtime readiness. API/Vite processes
were stopped, and both disposable PostgreSQL databases and their credentials
were removed. Safe DB summary: `/private/tmp/buildy-password-verification-2026-09-08.txt`.
No private browser state, credentials or local proof files were committed.

## Actual deployment/configuration

Read-only provider evidence, 2026-09-08; no production provider/data mutations.

| Target | Observation |
| --- | --- |
| Candidate Preview | [Stable alias](https://buildy-git-release-free-mvp-20260908-clarios-projects-05f6a57e.vercel.app). Deployment `dpl_7UGAncq1Tn8sXvpYjcEjYr8zYsBY`, source `14e747aa9c21e708240ee5dabc290d97137e2f6f`, READY |
| Candidate runtime | `/api/product-profile` returned 200 at 07:47 UTC: `feedback_beta/off`, `betaMode=true`, password signin and all core capabilities false. Branch-scoped env listing returned no entries. This is a built candidate, not a working account MVP |
| Preview settings | Existing core/database/PII settings are scoped to old branch `codex/buildy-production-finish`, not this candidate. Google secrets are no longer required |
| Isolated Neon | Last provider inventory: only `main` remains; the previous test branch expired and is absent. No test SQL was run against Neon main |
| Private Blob | Existing Preview store is private/available; actual upload/read/denial remains unproved. Production Blob is still unconfigured in the inspected environment |
| Production | [buildy-gamma.vercel.app](https://buildy-gamma.vercel.app/), deployed SHA `162be48ee3c494c821d3ffe0cb19e9cbda0a4af4`, independently reconfirmed after this auth push. Earlier safe readiness was database-fail/public_demo/off; no production activation or deployment performed |

Vercel deploys `main` automatically to Production. Keep the PR separate until
provider readiness and real owner/viewer proof pass. Retention approval and actual
operator/contact information have not been invented; these still need resolution
before release. Old reports do not authorize commerce or add browser-tool gates.

## One current owner action

Configure the candidate Preview branch `release/free-mvp-20260908` with a valid,
future-expiry isolated Neon database and distinct web/account-worker/media-worker
connections. Make the existing PII/core settings available on that branch without rotating
keys. Set its exact stable origin above in `APP_ORIGIN`/trusted origins and use
`PRODUCT_PROFILE=feedback_beta`, `BETA_MODE=false`, `CHECKOUT_MODE=off`.
Secret values belong only in the dashboard, as requested by the owner.

After that owner configuration, apply migration `0051` and the existing role-grant
script on the isolated database, check readiness and perform the real owner
three-photo/save/relogin journey,
followed by friend interaction, revocation, digital book, feedback and disposable
account deletion. Production readiness/Blob/contact details remain subsequent
release prerequisites. Verdict: **auth implemented and locally proved; hosted
account MVP blocked by candidate provider configuration; not released**.
