# Current state and next action

Only mutable progress sheet for the small MVP. Scope: [GRAPH](GRAPH.md),
acceptance: [FLOWS](FLOWS.md). An online demo is not an account-based MVP.

## Current slice — Preview proved, Production staged, 2026-09-08

The owner authorized restoring the existing hosted candidate through CLI/API,
proving the genuine owner/viewer journey and then releasing through PR #4.
Username/password auth is fixed scope: no Google, email, commerce or redesign.
The owner confirmed personal hobby use; no purchase or upgrade was made.

- Branch: `release/free-mvp-20260908`; [PR #4](https://github.com/meestierolff/buildy/pull/4).
- Last passing automatic candidate: `66d0c272d108e11e21604ca66dfa927ed8cb2e70`.
  [CI 34216553767](https://github.com/meestierolff/buildy/actions/runs/34216553767):
  12 automatic jobs PASS, 1,036 unit/server tests, 126 migration tests,
  37 real PostgreSQL tests and 245 browser checks across desktop Chromium,
  Firefox, WebKit, mobile and tablet, with no browser retries, failures or skips.
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
| Tested Preview | `dpl_DuP7318Q4xQXhumuh46TYweQHNtJ`, exact source `66d0c272d108e11e21604ca66dfa927ed8cb2e70`, READY. [Stable Preview](https://buildy-git-release-free-mvp-20260908-clarios-projects-05f6a57e.vercel.app) |
| Public Production | [buildy-gamma.vercel.app](https://buildy-gamma.vercel.app/), still demo source `162be48ee3c494c821d3ffe0cb19e9cbda0a4af4`, deployment `dpl_69yfxtocmLFXVRY3eVxx9tKupiSi`. No merge or public account-MVP release |
| Production Neon prepared | Full-data rollback branch `br-gentle-recipe-b1hql4zh` from main at LSN `0/2660608`, no compute endpoint, expires `2026-09-15T10:52:06Z`. Existing migration role applied the 27 missing migrations: ledger/checksums, all 51 migrations, no-op replay, canonical grants/RLS and new restricted runtime connections PASS. All 48 existing table counts compared: no decreases; only three canonical outbox events added. Existing passwords/ownership unchanged |
| Production Vercel prepared | `feedback_beta`, BETA_MODE false, checkout off, exact public origins and the three verified restricted runtime connections installed. Own private fra1 Blob store `store_dHQJVVge0sUQ7rmJ` connected only to Production. Existing PII/lifecycle records preserved; verified operator credentials backed up privately and removed from ordinary runtime |
| Protected Production build | `dpl_7gLneQfnAz62xy7VCxR5HpexfS1E`, source `66d0c27`, READY/STAGED, autoAssignCustomDomains false. The generated project alias is assigned, but both generated hosts require Vercel authentication and the sole configured public domain retains demo162. F0 configuration/database/account/media PASS; readiness is 503 solely because an inactive legacy photobook-worker connection is still checked with checkout off |

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
| F3–F4 | Owner link creation and anonymous viewer/photo reads without edit/book access PASS on `2446b8b`. On `9a6dc8`, the same separately registered fresh viewer reads/reloads without the unrelated onboarding dialog, its like persists, and comment creation/reload/own deletion plus a second comment's owner moderation all PASS. Canonical reads confirm zero remaining comments. A third account registered on this SHA; direct private project/timeline/media/edit access without a grant is denied |
| F5 | Book title and second cover photo persisted on `9a6dc8`; its exclusion write failed before the targeted array correction. On `66d0c27`, hiding a moment, reload and restoration all PASS; canonical final book has zero exclusions, all three source assets, matching cover/title and no print proof |
| Query failure | Real project-list/timeline GETs returned 400 VALIDATION_FAILED, including requests without query. Installed Vercel 58 route conversion proved the old wildcard injected an extra `path` parameter. Renaming the capture to `__buildy_api_path` prevents the extra parameter; existing strict validation stays intact. Actual converter + restore + schema checks now accept empty/limit queries and still reject unknown fields; 11 focused route/config tests PASS |
| Upload failure | Native hosted securitypolicyviolation proved connect-src blocked the installed Blob SDK API at `https://vercel.com/api/blob`. CSP now permits only its base/subpaths in addition to existing storage hosts. Native browser regression PASS: both Blob API forms work, unrelated Vercel API paths remain blocked |
| Processing failure | On `71a5b01`, upload/completion succeeded but processing failed before writing the canonical original. Two read-only actual Blob HEADs at 09:36 UTC confirmed the temporary object exists and original is absent. The real SDK BlobNotFoundError has name Error; the adapter's name comparison misclassified it as a provider failure. The adapter now uses the exported SDK class. Replacing the artificial test error with the real class first reproduced two failing write tests; the fix plus a fail-closed lookalike-error check pass all 26 storage/worker tests |
| Timestamp failure | Real persisted update JSON contains offset timestamps (+00:00, including microseconds), whereas the shared API contract requires UTC Z. Project cards already normalize timestamps; the shared update mapper did not. Two mapping lines now reuse the existing normalization for mutation/timeline/following reads. A real local PostgreSQL 16 test first failed all three response contracts with +02:00/microsecond values; after the fix the entire affected password/account integration file passes 8/8 with no skips. The 44 focused project tests, typecheck, lint and build also PASS; no response schema or migration changed |
| Viewer onboarding failure | A fresh viewer on a shared project received the unrelated create-renovation dialog because it was globally enabled after dashboard success. The existing dialog now opens only on the personal start/dashboard routes; no project/profile mutation or dismiss is needed to view a share. Four route regression cases reproduced the unwanted dialog before the fix; all eight component tests pass afterward, including starting onboarding later from the dashboard |
| Comment failure | Installed Drizzle compiles the interpolated empty mention list as ()::uuid[], before comment insertion. The actual Preview web connection confirms PostgreSQL 42601 in a read-only transaction. One line now binds the array with sql.param, preserving the eligibility function and access checks. The new real PostgreSQL service/repository regression reproduced 42601 before the fix; afterward both share-link integration tests PASS without skips, including 0/1/2 mentions, persisted reads, idempotent replay, ineligible-recipient refusal and read/write denial after revocation |
| Book exclusion failure | Three direct UUID-array interpolations in replaceExclusions compile as scalar/record values instead of one PostgreSQL array. Real local PostgreSQL reproduces 22P02 for one target and 42846 for multiple targets; the existing update alias is valid. Exactly three sql.param bindings fix this. The new repository/web-role regression first fails on one update target, then passes persisted 0/1/2 update/media/chapter exclusions, other chapter, reset and foreign-project rejection with rollback. The entire affected integration file passes 2/2 without skips; 21 focused service/HTTP tests, typecheck, lint and build PASS. No migration or proof/commerce code changed |
| Final F3/F6 | On `66d0c27`, old viewer page/timeline/all three media paths, old share token and fresh anonymous access are denied after revocation; owner retains edit access and the existing unlisted visibility. Real feedback receipt PASS. Disposable project/photo, ordinary logout/login/delete, old-session/data/media denial and deleted-login denial all PASS. Final owner read confirms the original two moments, three photos and edited content |
| Preview cleanup | All three synthetic run accounts deleted through normal UI and the canonical restricted worker. No auth identities/credentials/sessions/mappings remain; all three jobs completed with redacted tombstones. All 21 manifest objects and nine additional exact official locations are HEAD-absent. Feedback remains canonically unlinked/redacted. No broad deletion or other-user data touched. The exact disposable local PostgreSQL cluster was stopped and removed |
| Staged readiness mismatch | Composition creates a printproof worker only for checkout test/live, but readiness still probed a configured worker with checkout off. The staged build proves this blocks the free core despite all its required boundaries passing. Automatic approval review rejected deleting the unreadable Sensitive Production record; no deletion occurred. Readiness now follows the existing active-worker condition, preserving that setting and every active worker security check. HTTP regression first reproduced 503 and an unwanted proof query with checkout off; afterward all 35 router/composition tests PASS, off makes no proof query and returns 200, while test/live still return 503 on the failed boundary. Typecheck, lint and build PASS |

All hosted F2 failures are preserved as failed evidence. Source corrections are
limited to deployment routing/CSP, the required registration disclosure and
SDK error classification, update timestamp normalization, onboarding route scope
and typed array bindings for comment mentions and digital book exclusions.
Typecheck, lint, build, bundle budget and nine static
launch checks PASS after the storage correction. No new migration or auth
architecture was introduced. The genuine Preview journey is complete. Its private
final evidence records each phase's actual corrective SHA; historical signup and
edits are not represented as newly repeated actions on the final SHA. Failed
provider checkpoints and corrected runner assumptions remain archived separately.

## Next action and release boundary

Verify the narrow readiness correction with off versus active-mode regression,
required CI on the new candidate and fresh actual Preview/staged Production F0.
The already proved identity/photo/share/book/deletion paths are unchanged.

Production preparation is executed and its actual mutation evidence is retained
privately. Public-domain signup/photo/relogin smoke has not run. Real public
operator/contact details still await one owner response; no identity, policy
approval or retention date was invented. Production auto-deploys main, so PR #4
must remain unmerged until those details and the corrected staged F0 are ready.
Verdict: **the complete real Preview journey and its cleanup PASS; Production
database/storage/configuration are prepared, with the inactive-worker readiness
correction under verification; public release remains pending**.
