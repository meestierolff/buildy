# Current state and next action

Only mutable progress sheet for the small MVP. Scope: [GRAPH](GRAPH.md),
acceptance: [FLOWS](FLOWS.md). An online demo is not an account-based MVP.

## Integrated source — 2026-09-08

- Workbranch: `release/free-mvp-20260908`; original local/main HEAD and fetched
  `origin/main`: `162be48ee3c494c821d3ffe0cb19e9cbda0a4af4`.
- Preserved all 53 tracked local changes and the contents of six untracked
  source/test/documentation files in an owner-only backup outside the repository.
  No secret files, browser state or backup contents were published.
- Checkpoints: `9646319` preserves payment hardening separately; `ea68951`
  preserves auth/logout, router, accessibility, tests and release work.
- Open architecture [PR #3](https://github.com/meestierolff/buildy/pull/3), head
  `2866bb9c8a3b040e25acbd21aa28eb93be2682a7`, merged normally at `9783285`.
  No conflicts or discarded local edits. This is the joint starting version.
- F0 correction `f7040d5`: release/provider checks require `feedback_beta`,
  `BETA_MODE=false`, `CHECKOUT_MODE=off`; accounts, private media, lifecycle and
  digital Bouwboek must be ready. Core database roles must pass. Commerce
  credentials are unnecessary; a public demo still cannot pass the MVP gate.
- Source candidate: `fb839114630efb5a7afb129a011e3b731edb972c`; state-document updates may follow without
  changing this tested source. Hosted CI must run on the final PR head.
- `9353b3e` replaces the incompatible hosted Stripe/proof check with a narrow,
  unmocked persisted-owner-fixture smoke. Strict TypeScript, ESLint and test
  discovery pass; actual hosted execution NOT_RUN and never counts as Google login.
- Composer at 320 px had 20 px internal overflow. Two CSS class changes let the
  form shrink and stack its buttons only below 360 px. The failing regression was
  reproduced; all 30 project-detail cases across five browser projects now pass.
- Schema/provider/dependency versions are unchanged; no migrations added.

## Fresh provider observations — 2026-09-08

Read-only Vercel/Neon CLI/API inspection; no provider or customer-data mutations.

| Target | Observed state |
| --- | --- |
| Production | [buildy-gamma.vercel.app](https://buildy-gamma.vercel.app/), deployed SHA `162be48ee3c494c821d3ffe0cb19e9cbda0a4af4`, Vercel READY; health 200, `public_demo/off`; readiness 503 with database failure |
| Candidate Preview | [stable candidate alias](https://buildy-git-release-free-mvp-20260908-clarios-projects-05f6a57e.vercel.app); Git-linked deployment created for [draft PR #4](https://github.com/meestierolff/buildy/pull/4); verify current head against Vercel metadata. Provider activation remains blocked. |
| Google | `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` absent in both Preview and Production |
| Preview config scope | Core runtime, database, PII, cron and retention names exist only for `codex/buildy-production-finish`; new candidate branch does not inherit them. Presence is not proof that values work. |
| Isolated Neon | Project `patient-fire-15490270` currently has only `main`. Previous isolated branch expired `2026-09-06T21:59:00Z` and is absent. No test SQL executed against main. |
| Preview Blob | `buildy-preview-media`, private, available, fra1, valid Preview connection; zero objects, so upload/read/denial remains unproved |
| Production config | Core DB/worker/PII/cron/retention names exist; Google and `BLOB_READ_WRITE_TOKEN` are missing. Database log gives `database.readiness_failed`, no safe cause code. Association with the deleted test branch is **not established**. |
| Deployment control | Vercel automatically deploys GitHub `main` to Production. Keep candidate separate until real provider/owner-viewer proof passes. No Production activation or deployment performed. |

## Evidence boundary

| Flow | Fresh evidence on integrated source | Real hosted owner/viewer |
| --- | --- | --- |
| F0 | 20 targeted gate tests pass; public-demo, active-checkout, missing Google/Blob and unverified core workers rejected | BLOCKED by provider configuration above |
| F1–F6 | Existing local auth/logout, media, sharing/engagement, book, feedback and deletion regression suites pass with synthetic fixtures | NOT_RUN; no Google login, three-photo persistence after relogin, friend, revocation or deletion claim |
| F7 | Typecheck, lint, 154 test files / 1,009 tests, build, bundle budget and 9 static launchchecks pass; 234 Playwright tests pass before the 320px correction; 30 affected browser cases pass after it, including five new 320px cases; zero skips/retries | NOT_RUN; no account-MVP release |

Commands: `bun run typecheck`, `bun run lint`,
`bun run test -- --exclude 'tests/db/*.integration.test.ts'`, `bun run build`,
`bun run check:bundle`, `bun run check:launch -- --static`, and
`PLAYWRIGHT_MODE=preview bunx playwright test` (JUnit recorded outside Git).
Local Node is 26; canonical hosted CI uses Node 22 and remains separately required.
Real PostgreSQL integration tests were not rerun locally; no new database change.
The 390/1440 visual regression screenshots and 15 additional photo-rich
captures at 320/390/1440 were generated and inspected locally. The latter use
repository example photos, with owner/viewer stories, digital book and composer.
They use mock APIs and contain no real accounts or private photos. The final
composer check has zero internal overflow at 320, 390 and 1440 px; dialog
client/scroll widths are 318/318, 388/388 and 670/670. Final composer
captures are in `/private/tmp/buildy-photo-visual-20260908/`; other browser artifacts
are outside Git. No visual baselines were changed. Hosted CI is pending at this
checkpoint; follow [the candidate checks](https://github.com/meestierolff/buildy/pull/4/checks)
before any release. The workflow also runs the real PostgreSQL migration/RLS
integration suite; this is distinct from real hosted Google/Blob proof.

## Concrete owner action / next slice

Current slice: F0 → F1. Owner Google setup action has been requested; the candidate alias above replaces
the old-branch alias used in the initial request. Do not
replace OIDC, disable accounts or treat elapsed time as permission.

1. In Google Auth Platform configure webclients for exact origins
   `https://buildy-gamma.vercel.app` and the candidate Preview origin above.
   Each redirect is its exact origin plus `/api/auth/callback/google`; no wildcard.
   Enter the two Google values only in the matching Vercel dashboard scopes and
   allow the two intended test accounts if Google remains in testing mode.
2. Recreate an isolated Neon test branch with a future expiry; configure its
   distinct `DATABASE_URL`, `DATABASE_ACCOUNT_WORKER_URL` and
   `DATABASE_MEDIA_WORKER_URL` for the candidate Preview. Scope the existing
   PII/cron/retention/core settings to that candidate, preserving encryption keys.
   Keep the final stable Preview origin and Google callback identical.
3. Before release, repair Production database readiness and connect separate
   private Production Blob. Existing retentiedate presence is not owner approval;
   public privacy/support copy still lacks the actual operator/contact details.
   No hosting/legal/retention approval or contact has been invented.

Then verify safe readiness and perform the first real owner journey: Google →
private renovation → three photos → logout/login → same stored content. Only
then prove sharing, friend like/comment, revocation, personal book, feedback and
account deletion on the isolated Preview. Target verdict: **BLOCKED, not released**.
