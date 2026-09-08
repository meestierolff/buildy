# Current state and next action

Only mutable progress sheet for the small MVP. Scope: [GRAPH](GRAPH.md),
acceptance: [FLOWS](FLOWS.md). An online demo is not an account-based MVP.

## Current slice — hosted F0–F2, 2026-09-08

The owner authorized restoring the existing hosted candidate through CLI/API,
proving the genuine owner/viewer journey and then releasing through PR #4.
Username/password auth is fixed scope: no Google, email, commerce or redesign.
The owner confirmed personal hobby use; no purchase or upgrade was made.

- Branch: `release/free-mvp-20260908`; [PR #4](https://github.com/meestierolff/buildy/pull/4).
- Last fully green automatic candidate: `3ca87a65cd6a8fc299909e277a012f09824f0dc2`.
  [CI 34213843584](https://github.com/meestierolff/buildy/actions/runs/34213843584):
  12 automatic jobs PASS, 1,036 unit/server tests, 126 migration tests,
  35 real PostgreSQL tests and 245 browser tests across desktop Chromium,
  Firefox, WebKit, mobile and tablet.
  Optional protected hosted jobs were not run and do not supply user proof.
- Original founder work remains preserved: all 53 tracked changes and six
  untracked file contents were backed up outside Git; checkpoints `9646319` and
  `ea68951` retain that work. Architecture PR #3 merged normally at `9783285`.
- Password auth retains salted scrypt, hashed HttpOnly sessions, origin checks,
  network/username throttling and immediate revocation. Migration `0051` is
  append-only; existing external identities are not automatically linked.
- Registration now explicitly says recovery is unavailable and recommends a
  password manager. Eight focused auth tests and three reviewed registration
  captures at 320/390/1440 passed. CI on `71a5b01` found one Linux registration
  snapshot mismatch; the three Linux registration baselines now come from its
  reviewed actual captures. Those baselines pass on `6e73dbd`.

## Actual provider configuration

| Target | Verified state |
| --- | --- |
| Preview Neon | Schema-only branch `br-lucky-wind-b1oc35t6`, database `buildy_preview_20260908`, expiry `2026-09-15T21:59:00Z`. No copied production data. All 51 migrations, checksums, no-op replay, role grants and RLS PASS: 55 tables, 45 RLS |
| Runtime roles | New dedicated web/account-worker/media-worker roles: NOINHERIT, NOBYPASSRLS, no role memberships. Operator credentials remain outside ordinary Vercel runtime |
| Preview Vercel | Explicit candidate branch settings: `feedback_beta`, `BETA_MODE=false`, `CHECKOUT_MODE=off`, exact stable origin and three verified restricted DB connections |
| Preview secrets | Sensitive exports returned placeholders; first faulty redeploy was stopped before signup. Invalid overrides were removed. Existing PII/cron records moved to the candidate by scope-only PATCH, with their IDs/types and internal values preserved. Existing private Preview-only Blob connection is inherited. No key rotation |
| Tested deployment | `dpl_2HyMdNyCGr9idpQt2qi6raDMtije`, exact source `3ca87a65cd6a8fc299909e277a012f09824f0dc2`, READY. [Stable Preview](https://buildy-git-release-free-mvp-20260908-clarios-projects-05f6a57e.vercel.app) |
| Production | [buildy-gamma.vercel.app](https://buildy-gamma.vercel.app/), still demo source `162be48ee3c494c821d3ffe0cb19e9cbda0a4af4`. Fresh read-only Neon inspection found 24 matching migrations and 27 pending. No production mutation or release in this run |

## Genuine hosted evidence and concrete corrections

The private Playwright runner uses real Neon/Blob and normal forms, with no API
mocks. Temporary Vercel access is one alias-scoped 23-hour share cookie, separate
from application login. Credentials, browser state and private URLs stay outside
Git and public evidence.

| Boundary | Evidence |
| --- | --- |
| F0 | Health/profile PASS at 08:50 UTC: password signin and all core capabilities enabled, no invitation required, email/payments/print disabled. Actual readiness HTTP200: configuration/database/accountWorker/mediaWorker all PASS |
| F1 | One real owner registered, then logged out and logged back in through the UI. Secure HttpOnly application cookie confirmed |
| Throttling | Before signup 0 buckets/attempts; after signup 2/2; after browser signin 3/4; after same-account direct curl signin 3/6, with no resets/deletes. This does not distinguish shared egress from `unknown`; separate network buckets are NOT proved. The Vercel header forwarding/parsing path was inspected; no limiter was relaxed |
| F2 | PASS on `2446b8b`: exact two moments/three attached photos, real image bytes and reload, title/text/date edit persistence, logout/old-session denial/wrong password/relogin and the same content. Existing saved moments were recovered through canonical reads after fixes; no duplicate moment POSTs. Owner onboarding was completed via its real UI |
| F3–F4 | Owner link creation and anonymous viewer/photo reads without edit/book access PASS on `2446b8b`. A second real account registered normally. On `3ca87a6`, the same fresh viewer (onboardedAt null, no own project) reads/reloads without the unrelated onboarding dialog and its like persists after reload. First comment POST returns HTTP500; read-only admin inspection confirms zero comments and the one viewer reaction. No comment retry before diagnosis |
| Query failure | Real project-list/timeline GETs returned 400 VALIDATION_FAILED, including requests without query. Installed Vercel 58 route conversion proved the old wildcard injected an extra `path` parameter. Renaming the capture to `__buildy_api_path` prevents the extra parameter; existing strict validation stays intact. Actual converter + restore + schema checks now accept empty/limit queries and still reject unknown fields; 11 focused route/config tests PASS |
| Upload failure | Native hosted securitypolicyviolation proved connect-src blocked the installed Blob SDK API at `https://vercel.com/api/blob`. CSP now permits only its base/subpaths in addition to existing storage hosts. Native browser regression PASS: both Blob API forms work, unrelated Vercel API paths remain blocked |
| Processing failure | On `71a5b01`, upload/completion succeeded but processing failed before writing the canonical original. Two read-only actual Blob HEADs at 09:36 UTC confirmed the temporary object exists and original is absent. The real SDK BlobNotFoundError has name Error; the adapter's name comparison misclassified it as a provider failure. The adapter now uses the exported SDK class. Replacing the artificial test error with the real class first reproduced two failing write tests; the fix plus a fail-closed lookalike-error check pass all 26 storage/worker tests |
| Timestamp failure | Real persisted update JSON contains offset timestamps (+00:00, including microseconds), whereas the shared API contract requires UTC Z. Project cards already normalize timestamps; the shared update mapper did not. Two mapping lines now reuse the existing normalization for mutation/timeline/following reads. A real local PostgreSQL 16 test first failed all three response contracts with +02:00/microsecond values; after the fix the entire affected password/account integration file passes 8/8 with no skips. The 44 focused project tests, typecheck, lint and build also PASS; no response schema or migration changed |
| Viewer onboarding failure | A fresh viewer on a shared project received the unrelated create-renovation dialog because it was globally enabled after dashboard success. The existing dialog now opens only on the personal start/dashboard routes; no project/profile mutation or dismiss is needed to view a share. Four route regression cases reproduced the unwanted dialog before the fix; all eight component tests pass afterward, including starting onboarding later from the dashboard |
| Comment failure | Installed Drizzle compiles the interpolated empty mention list as ()::uuid[], before comment insertion. The actual Preview web connection confirms PostgreSQL 42601 in a read-only transaction. One line now binds the array with sql.param, preserving the eligibility function and access checks. The new real PostgreSQL service/repository regression reproduced 42601 before the fix; afterward both share-link integration tests PASS without skips, including 0/1/2 mentions, persisted reads, idempotent replay, ineligible-recipient refusal and read/write denial after revocation |
| Remaining journey | Corrected fresh-viewer interaction, link/media revocation, personal Bouwboek, feedback and disposable deletion await the corrected deployment |

All hosted F2 failures are preserved as failed evidence. Source corrections are
limited to deployment routing/CSP, the required registration disclosure and
SDK error classification, update timestamp normalization, onboarding route scope
and a typed array binding for comment mentions.
Typecheck, lint, build, bundle budget and nine static
launch checks PASS after the storage correction. No new migration or auth
architecture was introduced. Corrected hosted F2 and downstream proof remain required.

## Next action and release boundary

Deploy the reviewed array-binding correction, then resume the existing viewer's
first comment without toggling its
already saved like. Finish required CI on
the final candidate, then prepare production database rollback/migrations,
restricted runtime connections and its own private Blob store before merge.

Production preparation and smoke scripts are prepared outside Git but have not
run. Real operator/contact details are awaiting one owner response; no identity,
policy approval or retention date has been invented. Production auto-deploys
main, so PR #4 stays separate until Preview proof and production preparation pass.
Verdict: **hosted accounts, three persisted photos, edit/relogin, sharing and like
work; comment binding fix verified with real PostgreSQL; full social/book/deletion journey
and production release remain unproved**.
