# Current state and next action

Only mutable progress sheet for the small MVP. Scope: [GRAPH](GRAPH.md),
acceptance: [FLOWS](FLOWS.md). An online demo is not an account-based MVP.

## Authorized current slice — F0 → F1, 2026-09-08

The owner explicitly requested: “Verwijder de Google OAuth link. Gewoon username
en password maken. Simpel.” This replaces the earlier Google setup action.
Current work changes U → H → A → D to username/password signup and signin,
salted Node crypto scrypt hashes, server-owned hashed HttpOnly sessions, origin/CSRF
checks and rate limiting. New accounts collect no email; retained Google
identities are not automatically linked. No password recovery is promised.

The username/password implementation is complete in the working tree based on
`8ff1cf80bb2e666b3ae9b72182b70efdb9f308d6`; its checkpoint and hosted CI follow.
Google secrets/callbacks are no longer a provider setting or owner blocker.
Migration `0051` adds credentials and opaque hashed sessions without altering
applied migrations or fabricating emails. The obsolete OAuth client dependency
is removed. Signup and signin use separate network throttles plus a shared
username throttle, with blinded limiter subjects.

Fresh local evidence for this auth slice:
- Typecheck and ESLint pass. All 154 unit-test files / 1,031 tests pass.
- PostgreSQL 16: all 51 migrations apply and replay as a no-op; role grants and
  `db/verify.ts` pass (55 tables, 45 RLS). The full canonical integration slice
  passes 19 files / 34 tests. Seven new tests include real signup → app actor →
  private project → logout denial → password relogin → same stored project,
  concurrent signup rollback, session isolation, restriction races, deletion,
  worker denial and export secrecy. Only disposable local databases were used.
- Build, bundle budget and all nine static launch checks pass. Full Playwright
  ran 244 cases: 243 passed and one landing text-wrap snapshot failed. That
  concrete copy issue was fixed; all 19 affected auth/handoff/visual checks then
  passed against the rebuilt app and unchanged landing baselines.
- Six new auth screenshots at 320/390/1440 were reviewed with no overflow.
  Darwin baselines are present; matching Linux baselines need actual CI output.
- Real local browser signup/persistence/relogin proof is running separately.
  Hosted Neon/Blob owner/viewer journeys remain NOT_RUN. No production change.

## Previous integrated source — before the password-auth change

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
- Previous source candidate: `fb839114630efb5a7afb129a011e3b731edb972c`.
  The password-auth candidate needs fresh evidence on its final PR head.
- `9353b3e` replaces the incompatible hosted Stripe/proof check with a narrow,
  unmocked persisted-owner-fixture smoke. Strict TypeScript, ESLint and test
  discovery pass; actual hosted execution NOT_RUN and does not prove signup/login.
- Composer at 320 px had 20 px internal overflow. Two CSS class changes let the
  form shrink and stack its buttons only below 360 px. The failing regression was
  reproduced; all 30 project-detail cases across five browser projects now pass.
- That earlier slice added no migrations. The current password-auth slice adds
  an append-only credentials migration and requires fresh real PostgreSQL/RLS proof.

## Fresh provider observations — 2026-09-08

Read-only Vercel/Neon CLI/API inspection; no provider or customer-data mutations.

| Target | Observed state |
| --- | --- |
| Production | [buildy-gamma.vercel.app](https://buildy-gamma.vercel.app/), deployed SHA `162be48ee3c494c821d3ffe0cb19e9cbda0a4af4`, Vercel READY; health 200, `public_demo/off`; readiness 503 with database failure |
| Candidate Preview | [stable candidate alias](https://buildy-git-release-free-mvp-20260908-clarios-projects-05f6a57e.vercel.app); Git-linked deployment created for [draft PR #4](https://github.com/meestierolff/buildy/pull/4); verify current head against Vercel metadata. Provider activation remains blocked. |
| Preview config scope | Core runtime, database, PII, cron and retention names exist only for `codex/buildy-production-finish`; new candidate branch does not inherit them. Presence is not proof that values work. |
| Isolated Neon | Project `patient-fire-15490270` currently has only `main`. Previous isolated branch expired `2026-09-06T21:59:00Z` and is absent. No test SQL executed against main. |
| Preview Blob | `buildy-preview-media`, private, available, fra1, valid Preview connection; zero objects, so upload/read/denial remains unproved |
| Production config | Core DB/worker/PII/cron/retention names exist; `BLOB_READ_WRITE_TOKEN` is missing. Database log gives `database.readiness_failed`, no safe cause code. Association with the deleted test branch is **not established**. |
| Deployment control | Vercel automatically deploys GitHub `main` to Production. Keep candidate separate until real provider/owner-viewer proof passes. No Production activation or deployment performed. |

## Prior evidence boundary — recheck affected flows after password-auth changes

| Flow | Fresh evidence on integrated source | Real hosted owner/viewer |
| --- | --- | --- |
| F0 | Previous 20 targeted gate tests passed; old Google capability assertions are stale and being replaced by password readiness checks | BLOCKED by database/core config scope and remaining Blob setup above |
| F1–F6 | Previous local auth/logout, media, sharing/engagement, book, feedback and deletion suites passed with synthetic fixtures; changed auth needs fresh tests | NOT_RUN; no real signup/login, three-photo persistence after relogin, friend, revocation or deletion claim |
| F7 | Typecheck, lint, 154 test files / 1,009 tests, build, bundle budget and 9 static launchchecks pass; 234 Playwright tests pass before the 320px correction; 30 affected browser cases pass after it, including five new 320px cases; zero skips/retries | NOT_RUN; no account-MVP release |

Commands: `bun run typecheck`, `bun run lint`,
`bun run test -- --exclude 'tests/db/*.integration.test.ts'`, `bun run build`,
`bun run check:bundle`, `bun run check:launch -- --static`, and
`PLAYWRIGHT_MODE=preview bunx playwright test` (JUnit recorded outside Git).
Local Node is 26; canonical hosted CI uses Node 22 and remains separately required.
Real PostgreSQL integration tests were not rerun locally in that earlier slice;
they are required for the current database/auth change.
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
integration suite; this is distinct from real hosted signup/login/Blob proof.

## Remaining external setup and one next action

1. An isolated Neon test branch with a future expiry is still absent. Configure its
   distinct `DATABASE_URL`, `DATABASE_ACCOUNT_WORKER_URL` and
   `DATABASE_MEDIA_WORKER_URL` for the candidate Preview. Scope the existing
   PII/cron/retention/core settings to that candidate, preserving encryption keys.
   Apply and verify the new append-only credentials migration on that isolated
   database; no OAuth client or callback setup is needed.
2. Before release, repair Production database readiness and connect separate
   private Production Blob. Existing retentiedate presence is not owner approval;
   public privacy/support copy still lacks the actual operator/contact details.
   No hosting/legal/retention approval or contact has been invented.

**Next action:** finish and verify the authorized F1 signup/login slice, including
real PostgreSQL/RLS tests, then record the exact candidate SHA and results here.
After the remaining isolated Preview configuration is available, prove:
register → private renovation → three photos → logout/login → same stored
content, followed by viewer interaction, revocation, book, feedback and deletion.
Target verdict: **password-auth work in progress; hosted MVP not released**.
