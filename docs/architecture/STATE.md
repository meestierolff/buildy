# Current state and next action

Only mutable progress sheet for the small MVP. Scope: [GRAPH](GRAPH.md),
acceptance: [FLOWS](FLOWS.md). An online demo is not an account-based MVP.

## Current slice — hosted F0–F2, 2026-09-08

The owner authorized restoring the existing hosted candidate through CLI/API,
proving the genuine owner/viewer journey and then releasing through PR #4.
Username/password auth is fixed scope: no Google, email, commerce or redesign.
The owner confirmed personal hobby use; no purchase or upgrade was made.

- Branch: `release/free-mvp-20260908`; [PR #4](https://github.com/meestierolff/buildy/pull/4).
- Last fully green automatic candidate: `b141d1f5c486a7aa1cf34b224f811c70a8d5f55e`.
  [CI 34201457255](https://github.com/meestierolff/buildy/actions/runs/34201457255):
  12 automatic jobs PASS, 1,031 unit/server tests, 34 real PostgreSQL tests and
  244 browser tests across desktop Chromium, Firefox, WebKit, mobile and tablet.
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
  reviewed actual captures. All other CI jobs passed. Final-candidate CI is pending.

## Actual provider configuration

| Target | Verified state |
| --- | --- |
| Preview Neon | Schema-only branch `br-lucky-wind-b1oc35t6`, database `buildy_preview_20260908`, expiry `2026-09-15T21:59:00Z`. No copied production data. All 51 migrations, checksums, no-op replay, role grants and RLS PASS: 55 tables, 45 RLS |
| Runtime roles | New dedicated web/account-worker/media-worker roles: NOINHERIT, NOBYPASSRLS, no role memberships. Operator credentials remain outside ordinary Vercel runtime |
| Preview Vercel | Explicit candidate branch settings: `feedback_beta`, `BETA_MODE=false`, `CHECKOUT_MODE=off`, exact stable origin and three verified restricted DB connections |
| Preview secrets | Sensitive exports returned placeholders; first faulty redeploy was stopped before signup. Invalid overrides were removed. Existing PII/cron records moved to the candidate by scope-only PATCH, with their IDs/types and internal values preserved. Existing private Preview-only Blob connection is inherited. No key rotation |
| Tested deployment | `dpl_51XA8wJm34oNGQnw8bRsYEs89Gqi`, exact source `71a5b01d4642c47c833141766fd80db976f1ad2e`, READY. [Stable Preview](https://buildy-git-release-free-mvp-20260908-clarios-projects-05f6a57e.vercel.app) |
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
| F2 | Same real owner/private project retained. Corrected project-list/timeline GETs, both empty and limited, PASS on `71a5b01`. Photo/moment persistence NOT yet proved: one old pending-upload reservation, one uploaded asset, three worker attempts with STORAGE_PROVIDER_ERROR and no saved update |
| Query failure | Real project-list/timeline GETs returned 400 VALIDATION_FAILED, including requests without query. Installed Vercel 58 route conversion proved the old wildcard injected an extra `path` parameter. Renaming the capture to `__buildy_api_path` prevents the extra parameter; existing strict validation stays intact. Actual converter + restore + schema checks now accept empty/limit queries and still reject unknown fields; 11 focused route/config tests PASS |
| Upload failure | Native hosted securitypolicyviolation proved connect-src blocked the installed Blob SDK API at `https://vercel.com/api/blob`. CSP now permits only its base/subpaths in addition to existing storage hosts. Native browser regression PASS: both Blob API forms work, unrelated Vercel API paths remain blocked |
| Processing failure | On `71a5b01`, upload/completion succeeded but processing failed before writing the canonical original. Two read-only actual Blob HEADs at 09:36 UTC confirmed the temporary object exists and original is absent. The real SDK BlobNotFoundError has name Error; the adapter's name comparison misclassified it as a provider failure. The adapter now uses the exported SDK class. Replacing the artificial test error with the real class first reproduced two failing write tests; the fix plus a fail-closed lookalike-error check pass all 26 storage/worker tests |
| Remaining journey | Three photos/reload/edit, normal logout/wrong-password/relogin, friend interaction, link/media revocation, personal Bouwboek, feedback and disposable deletion await the corrected deployment |

All hosted F2 failures are preserved as failed evidence. Source corrections are
limited to deployment routing/CSP, the required registration disclosure and
SDK error classification. Typecheck, lint, build, bundle budget and nine static
launch checks PASS after the storage correction. No new migration or auth
architecture was introduced. Corrected hosted F2 and downstream proof remain required.

## Next action and release boundary

Commit the reviewed SDK correction and Linux registration baselines to this
existing branch/PR, test the new deployed SHA and resume with the same synthetic
owner. Finish required CI on
the final candidate, then prepare production database rollback/migrations,
restricted runtime connections and its own private Blob store before merge.

Production preparation and smoke scripts are prepared outside Git but have not
run. Real operator/contact details are awaiting one owner response; no identity,
policy approval or retention date has been invented. Production auto-deploys
main, so PR #4 stays separate until Preview proof and production preparation pass.
Verdict: **hosted accounts and photo upload work; processing fix locally checked; complete
photo/social/book journey and production release remain unproved**.
