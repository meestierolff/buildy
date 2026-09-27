# Current state and next action

Only mutable progress sheet for the small MVP. Scope: [GRAPH](GRAPH.md),
acceptance: [FLOWS](FLOWS.md). An online demo is not an account-based MVP.

## F7 — fresh isolated Preview online, 2026-09-27

App commit `8d7f711bd58ca02800860d292a5416e476c0ed54` is pushed to
[PR #4](https://github.com/meestierolff/buildy/pull/4). Preview deployment
`dpl_DZkqWtJjoqaKs2YhHugQTWQm68se` is READY at the
[existing branch origin](https://buildy-git-release-free-mvp-20260908-clarios-projects-05f6a57e.vercel.app).
Actual readiness reports configuration, database, account worker, media worker
and photobook worker all `pass`; payment worker is intentionally `not_checked`.
Native Chrome reaches the landing page and username/password login.
The actual hosted browser journey PASS on this SHA: username registration,
private project, three synthetic photo/date/text saves, reload, logout/login and
the same persisted images. Three real Blob uploads and ready finalizations were
observed; anonymous project/media reads were denied. The downloaded 24-page PDF
matches canonical document/PDF hashes and page count, preserves backdated A→B→A
chronology and all 14 long-text paragraphs. Downloaded pages 3/7 were visually
inspected. A separate registered viewer followed the exact project, reacted and
commented, with persistence after reload and no project editing/book controls.
After owner link revocation, project/update/media/comment API reads returned
404, the timeline disappeared, the following feed excluded the project and the
old link displayed its revoked state. No browser errors or server 5xx observed.
The runner needed selector/lazy-image corrections; no product fault was hidden
or mocked. All issued share links were revoked. No physical-print claim.

Patched commit `775db05ccfc99de09eb2309bafa16a0536311ce6` also passed the actual
hosted follow-up: a fourth photo uploaded to private Blob and a new 24-page PDF
included all four source assets. F6 account deletion passed for both synthetic
accounts: each request returned 202 with `deletion_pending`; retained old cookies
resolved to a null session, account reads returned 401 and project/media reads
returned 404. Immediate access denial is proven; physical cleanup is not claimed.

The new schema-only Neon branch `br-spring-river-b19te8h8` contains a fresh
`buildy_preview` database: 53 migrations, 55 tables and 45 RLS tables verified.
Canonical grants and all four runtime connections passed. Only branch-scoped
Preview connection settings were replaced; PII keys and Blob token were not
exported or rotated. `feedback_beta`, beta off, checkout off and the branch
origin are explicit. Existing Vercel CLI authentication supplies a private
test cookie; deployment protection stays enabled.

Fresh rollback `br-damp-night-b1l5amxe` is READY at main parent LSN
`0/2EF2688`, with no compute endpoint. Public Production is not yet redeployed.
Read-only main verification found 51 valid migrations, only 0052/0053 pending,
and the existing restricted `buildy_prod_20260908_*` roles. The existing
migrator and photobook credentials were retrieved individually through Neon,
stored privately and checked read-only; no credentials were rotated.
The verified existing restricted photobook URL is configured for the next
Production build; no main migration has run yet.

CI run `36302034837` found stale migration/project-follow expectations, an old
visibility label, the intentionally changed mobile Bouwboek screenshot and two
dependency advisories. The expectations now match exact-project subscriptions
and current access; sharp is patched to 0.35.4 and js-yaml to 4.3.2. Focused
migration/security/image/PDF tests 53/53, the single mobile visibility test and
the high-severity dependency audit PASS. The Linux Bouwboek baseline was visually
reviewed against the actual CI artifact: canonical 24 pages and the PDF toolbar
replace the old four-page client rewrite. No unrelated suite was rerun.
CI run `36302990512` on `775db05` passed unit tests, typecheck/lint, audit, build,
both PostgreSQL jobs and Chromium/mobile/tablet/WebKit. Firefox alone rejected
an intentionally superseded `renovation-progress` landing image request during
logout. The test-only correction adds that image to the existing narrow abort
allowance and still requires it to decode successfully; the repeated image
locator was scoped to its first instance. The sole Firefox logout test then
PASS. Application code and mandatory CI are unchanged. Remote CI on this final
test-only repair is pending. Next action: finish required CI, then release the
verified account app with ordering off.

## F4 — project following complete locally, 2026-09-27

F4 / U,H,A,S,E,D: the existing `project_followers` relation now backs the
project button, idempotent PUT/DELETE, server-derived overview status/count and
the following feed. Following one project does not include the owner's other
projects or grant access. Profile relationships remain visibility connections
and are labelled accordingly. Trusted share context is rechecked; blocking and
connection removal revoke exact-pair subscriptions through a guarded helper.
Append-only migrations 0052/0053 preserve existing RLS and visibility rules.

Focused UI/API tests 30/30 and profile UI 5/5 PASS. Server checks 82 PASS; the
new real repository test exposed legacy cleanup calling a retired function,
then PASS after migration 0053. Five focused PostgreSQL boundary/notification
tests, canonical grants and schema verification PASS (53 migrations, 45 RLS
tables). Both new DB test files are included in the existing CI database job.

Actual local Playwright at `2026-09-27T07:00:02Z–07:00:05Z` used real login,
API and isolated PostgreSQL: viewer followed project A, reloaded, saw only A
and not project B from the same owner in `/volgend`, unfollowed, reloaded and
saw an empty feed. Both mutations returned 200. Synthetic local data only;
no intercepted requests, saved browser traces or credentials in evidence.

Coordinated final typecheck, lint, CI-configured production build, bundle budget
and four static launch checks PASS at `2026-09-27T06:59:11Z`; no duplicate full
test matrix. Native Chrome was also used to inspect the real local project
and its anonymous follow-to-login route. No deployment claimed yet.

The replacement isolated Neon Preview `br-spring-river-b19te8h8` was created
from schema only, without production rows. Provisioning and deployment are
completed above. The old main branch and public deployment remain unchanged.

Next action: connect the isolated Preview and prove the hosted photo/book
journey. Peecho company details and ordering remain explicitly deferred.

## F5 — canonical Bouwboek and PDF download completed locally, 2026-09-27

F5 / U,H,A,B,P,M,D: preview now consumes the exact server document, without
client-side sorting, inserted pages or changed counts. The repository carries
`sort_order`; the builder uses date/order/id like the timeline and keeps phase
runs chronological (including A→B→A). Short text shares a page with its first
photo; long text continues completely. Excluded chapters no longer supply an
automatic cover; excluded assets do not block an unrelated included book.
The final page is a canonical back cover, with even/minimum padding before it.

The existing private PDF request/download now has a user action, render status,
visible content warnings and exact document/PDF matching. Checkout off no longer
disables the existing request-driven renderer; the dedicated photobook database
role is still required. Stored approved/locked revisions remain immutable.
No paid order or Peecho print compatibility is claimed.

Visual inspection exposed two real font faults: `latin-ext` omitted ordinary
Dutch glyphs; the installed Latin WOFF2 files crashed during fontkit subsetting.
The existing equivalent Latin WOFF files now serve measurement and embedding,
and Vercel packages them. Renderer version is `pdfkit-0.19.1-buildy-2`.
Dutch text/accents work; full Unicode/emoji coverage is not established.

Evidence: focused chronology/exclusions/text tests 9/9, current PDF/worker tests
11/11, canonical client tests 4/4, PDF UI/API/viewer tests 17/17 plus the targeted
warning test PASS. Checkout-off runtime/router/service tests 63/63 PASS.
Typecheck, changed-source lint and production build PASS; no full suite repeated.
The untracked local example `output/pdf/buildy-bouwboek-voorbeeld.pdf` has
24 pages, document SHA `e94e1833e0f226fd8480179b173e49d618b8a2384d1e404472d6471f3fcd5a6d`,
PDF SHA `93c0f7d9ca159b688f3e48c37d15ff594ed3f96a081737358654016dad3eacfd`.
Pages 1/3/5/8/10/24 were rendered and visually inspected; extracted text confirms
January→February→March order and all 24 long-story paragraphs. Synthetic local
artifact only, no hosted download/provider/physical proof. No deployment yet. The PDF was also opened through native Chrome Computer Use;
the browser displays the same title, chronology and 24-page count.

F4 is completed locally above; hosted photo/book evidence is the next action.

## Current slice — Peecho dashboard reached; release checks simplified, 2026-09-27

Latest owner steering explicitly authorizes browser setup and removal of
unnecessary checks. F0/F7 / C,H,Q: removed five obsolete release gates (provider
name/import bans, retired-directory inventory, handwritten import crawler,
exact copy regexes and historical-report presence), plus two unused email
staging helpers and their test machinery. This removes 190 lines relative to
the preceding local worktree. Existing CI jobs and actual auth, private-media,
origin, payment, migration, header and deployment-SHA checks remain unchanged.
One focused run of `check-launch.test.ts` and `release-gates.test.ts` passed
11/11; no full test matrix was rerun. No application deployment was made.

Native Chrome now reaches the existing logged-in **production** Peecho dashboard
at `peecho.com/mio-dashboard/settings/products`; earlier browser-inventory
absence did not establish native-app inaccessibility. The account has active
`Hardcover Photobook A4 (landscape)`, product **7382413**, gloss 200gsm,
24–300 pages. The UI displays wholesale **EUR 6.20 + 0.21 per page**.
This is catalog evidence only: NL shipping, tax basis and a full quote have not
been verified. No catalog settings, margins, company details or orders changed.

The API page contains existing Merchant/Secret keys and empty company fields.
The first native-app observation unintentionally included credential fields in
tool output; values were not copied to repository/evidence or repeated. Later
observations hide fields and limit output to the relevant Peecho page; no
credential was rotated. Owner supplied a key in the gitignored 0600
`.env.peecho.local` (not `.env.local`) and explicitly confirmed it is a production
key, authorizing product/quote reads only. Its nonsecret environment label is now
`live`, with product `7382413`. The authenticated live product read passed at
`2026-09-27T06:22:26.653Z`: `EU-hcl-M-l`, 297×210 mm, minimum quantity 1,
24–300 pages, fixed dimensions. No order/payment request was made.

The real quote endpoint returns HTTP 404 with **APP_NO_COMP_DETAILS**: Peecho
requires actual company/billing details. Raw provider errors are withheld because
they can echo request URLs/credentials; the preflight reports only recognized
machine codes. The owner explicitly deferred company details and asked to finish
the account app. Do not poll this unchanged external dependency. `BUTTON_KEY`
is unnecessary for Stripe Checkout; `SECRET_KEY` is needed only for later
server-side Peecho payment signing, not product/quote reads. Neither becomes a
Vite/client setting.

Current action: complete F5's shared chronological preview/PDF and downloadable
digital book, independently of Peecho quotes and checkout. Live sales remain off.

### Earlier F0 preparation in this session

F0 / C,H,D,Q: the owner's new scope authorizes Peecho/Stripe after real product
and quote proof, project-specific following and one canonical print document.
AGENTS/GRAPH/FLOWS now express that target. Checkout remains off; no live sales,
order, payment, secret rotation, account deletion or deployment was performed.
The September 8–9 results below are historical, not current hosted proof.

- Local/remote branch remains `release/free-mvp-20260908`; HEAD and open
  [PR #4](https://github.com/meestierolff/buildy/pull/4) agree on
  `9c0287c15ca4ccba5a5bc3e741626ec10935cda6`. Remote main remains
  `162be48ee3c494c821d3ffe0cb19e9cbda0a4af4`. Existing CI is green from September 8,
  not a new run. The initial 47-line local STATE addition is preserved, with
  staged/unstaged binary patches outside Git in a 0700 directory, files 0600;
  there were no untracked files. No checkout/reset/clean occurred.
- Fresh public health/profile reads confirm Production remains `public_demo`,
  checkout off, SHA `162be48`, deployment `dpl_69yfxtocmLFXVRY3eVxx9tKupiSi` READY.
  Latest Preview `dpl_C7vWGKTY4Wzg4dp1zzoh1DYpVtH6` is READY at `9c0287c`;
  unauthenticated Preview requests reach protection HTML, not application proof.
- Neon project `patient-fire-15490270` / main `br-noisy-king-b14pmt91` exists.
  Existing local credentials matched the main endpoint/database; explicit
  `BEGIN READ ONLY; SELECT 1; ROLLBACK` passed at `2026-09-27T05:54:08.716Z`.
  This does not prove current Vercel role configuration. Former isolated Preview
  `br-lucky-wind-b1oc35t6` and rollback `br-gentle-recipe-b1hql4zh` both return
  404 and are absent from the branch listing including deleted branches.
  Their recorded September 15 expiries have passed; deletion times are unknown.
- Vercel Blob metadata lists both existing Buildy stores as available in fra1:
  Production `store_dHQJVVge0sUQ7rmJ`, Preview `store_LAdtJpmW9VUnYFEm`.
  No fresh object upload/read or privacy proof is claimed. Automatic approval
  review rejected bulk Preview/Production secret export; none was downloaded.
  Subsequent metadata-only checks succeeded without obtaining secret values.
- One Computer Use inventory found no reachable Peecho browser tab. The owner
  was given one Settings → API handoff. Vercel environment-name/scope inventory
  contains no Peecho or Stripe configuration. No server Merchant API key exists
  in the checked local environment. Stripe connector metadata is reachable but
  shows HiggsCat contexts; selection of the intended Buildy account is unconfirmed.
- Official [v3 reference](https://www.peecho.com/print-api-documentation),
  [first-order guide](https://www.peecho.com/blog/how-to-place-your-first-peecho-api-order)
  and [hardcover guide](https://support.peecho.com/hc/en-us/articles/19730953142428-Hardcover-books-File-set-up-guideline)
  were checked. Product list uses `merchantApiKey`; read-only quote uses `apiKey`
  and `offeringId`. The public reference does not establish quote money units
  and nonzero tax inclusion sufficiently to approve consumer pricing.
- Added a server-only [preflight CLI](../../scripts/setup/peecho.ts):
  `node --import tsx scripts/setup/peecho.ts --products`, then set the actual
  environment-specific `PEECHO_PRODUCT_ID` and use `--pages=24,40,80` only if
  those counts fit that offering. Credentials enter through process environment
  or a private `node --env-file` file, never arguments. The helper reads only
  products/quotes, rejects redirects and changed quote identity/pages/quantity/
  currency/destination, bounds responses, and excludes raw errors/credentials.
  Output retains raw costs, tax and shipping with unconfirmed units/tax basis;
  it is not connected to the consumer-price matrix or checkout.
- Local uncommitted F0 validation: 25 focused preflight/launch tests, typecheck,
  lint, build, bundle budget, all nine static launch checks and 76 relative
  documentation links PASS. The outdated blanket Peecho ban now allows only the
  two read-only setup files; regressions still reject runtime imports, other
  retired providers and Peecho webhook routes. Review also found and fixed
  credential-echo redaction for JSON-escaped keys. Actual CLI without credentials exits safely with
  `PEECHO_MERCHANT_API_KEY_MISSING`; this is BLOCKED provider evidence, not a
  successful API call. Test/live product IDs, three real quotes, approved margin,
  new PDF proof, current hosted F1–F6, Stripe payment and sandbox print: NOT_RUN.

The former missing-key action is superseded by the dashboard/key evidence above.
Restore isolated Preview and fresh rollback resources before later hosted
verification/release; no old expiry is accepted.

## Release continuation — operator details still missing, 2026-09-09

F7 / U,H,C,A,D,P,M,S,B,L: the owner authorized completing PR #4, normal
merge, Production deployment, the public signup/photo/relogin/Bouwboek/share
revocation smoke and cleanup of only this run's synthetic data. The supplied
operator name, public address and contact/privacy email are all still literal
`[invullen]`; actual values were requested. No legal identity or approval was
inferred, and no merge or deployment was performed.

- Initial worktree clean; branch `release/free-mvp-20260908`, HEAD and PR #4
  head both `9c0287c15ca4ccba5a5bc3e741626ec10935cda6`. PR open and mergeable.
  [CI 34221666179](https://github.com/meestierolff/buildy/actions/runs/34221666179)
  has all 12 automatic jobs, including CI gate, PASS on this head; the two
  optional protected jobs are skipped. This is existing CI evidence, not a
  newly completed legal change or public smoke.
- Fresh read-only provider/runtime verification at `2026-09-09T14:46:00Z`:
  public alias and `/api/health` still agree on deployment
  `dpl_69yfxtocmLFXVRY3eVxx9tKupiSi`, SHA
  `162be48ee3c494c821d3ffe0cb19e9cbda0a4af4`; `/api/product-profile` reports
  `public_demo`. That previous Production deployment remains READY for rollback.
- Production settings still match `feedback_beta`, `BETA_MODE=false`,
  `CHECKOUT_MODE=off` and the public origins. The Sensitive trusted-origin
  record is unchanged since the previously proved staged F0; its value was
  not exported or represented as newly runtime-tested. Preserved PII/lifecycle
  records are unchanged, operator credentials remain outside ordinary runtime,
  and the existing private fra1 Blob store is connected only to Production.
- All three prepared Production database connections passed fresh read-only
  identity/role checks: login permitted, no superuser, BYPASSRLS, inheritance
  or role memberships. The normal `runMigrations({mode: 'dry-run'})` verified
  all 51 applied migrations/checksums with zero pending and zero executed.
  No database was created and no migration was reapplied.
- Existing full-data rollback branch `br-gentle-recipe-b1hql4zh` is READY,
  retains parent LSN `0/2660608`, has no compute endpoint and expires
  `2026-09-15T10:52:06Z`. Staged deployment
  `dpl_9CqP2mQc9Q9kYsUbDSzmwvgtTSeB` remains READY at `b11413d`.
- Safe preflight evidence: `/private/tmp/buildy-release-preflight-20260909.json`.
  The private public-smoke runner was prepared for the requested Bouwboek and
  share/revocation checks and passed syntax/import checks only. Public smoke:
  **NOT_RUN**. This run created no synthetic accounts or media, so no test-data
  cleanup was required.

Next action: receive the actual approved public operator name, address and
contact/privacy email, then finish their minimal existing-page edit and required
CI before merging PR #4 and proving the final public deployment. Public release
remains **BLOCKED on those missing values**; the preparation above is current
evidence, not a claim that the public account app has launched.

## Current slice — Preview proved, Production staged, 2026-09-08

The owner authorized restoring the existing hosted candidate through CLI/API,
proving the genuine owner/viewer journey and then releasing through PR #4.
Username/password auth is fixed scope: no Google, email, commerce or redesign.
The owner confirmed personal hobby use; no purchase or upgrade was made.

- Branch: `release/free-mvp-20260908`; [PR #4](https://github.com/meestierolff/buildy/pull/4).
- Last passing app candidate: `b11413d4261fccabc504c1ab6d77a3bf3d02ed4a`.
  [CI 34220543578](https://github.com/meestierolff/buildy/actions/runs/34220543578):
  12 automatic jobs PASS, 1,039 unit/server tests, 126 migration tests,
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
| Tested Preview | `dpl_AJZM3DQgSVktEjK2qMygJbj9fRBo`, exact source `b11413d4261fccabc504c1ab6d77a3bf3d02ed4a`, READY. Fresh F0 PASS; complete earlier journey keeps its actual phase SHAs. [Stable Preview](https://buildy-git-release-free-mvp-20260908-clarios-projects-05f6a57e.vercel.app) |
| Public Production | [buildy-gamma.vercel.app](https://buildy-gamma.vercel.app/), still demo source `162be48ee3c494c821d3ffe0cb19e9cbda0a4af4`, deployment `dpl_69yfxtocmLFXVRY3eVxx9tKupiSi`. No merge or public account-MVP release |
| Production Neon prepared | Full-data rollback branch `br-gentle-recipe-b1hql4zh` from main at LSN `0/2660608`, no compute endpoint, expires `2026-09-15T10:52:06Z`. Existing migration role applied the 27 missing migrations: ledger/checksums, all 51 migrations, no-op replay, canonical grants/RLS and new restricted runtime connections PASS. All 48 existing table counts compared: no decreases; only three canonical outbox events added. Existing passwords/ownership unchanged |
| Production Vercel prepared | `feedback_beta`, BETA_MODE false, checkout off, exact public origins and the three verified restricted runtime connections installed. Own private fra1 Blob store `store_dHQJVVge0sUQ7rmJ` connected only to Production. Existing PII/lifecycle records preserved; verified operator credentials backed up privately and removed from ordinary runtime |
| Protected Production build | `dpl_9CqP2mQc9Q9kYsUbDSzmwvgtTSeB`, exact app source `b11413d4261fccabc504c1ab6d77a3bf3d02ed4a`, READY/STAGED, autoAssignCustomDomains false. Actual F0 PASS at 11:35 UTC: readiness 200, configuration/database/account/media pass, inactive payment/proof workers not_checked; password signin enabled, feedback_beta, checkout off. Trusted public origin reaches input validation (400 BAD_REQUEST); an untrusted origin is denied (403 FORBIDDEN). No account created. Both generated hosts require Vercel authentication; only a temporary deployment share was used. The sole configured public domain still serves demo162 |

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
| Corrected F0 | On `b11413d`, exact READY Preview health/profile/readiness all PASS: feedback_beta, BETA_MODE false, checkout off, required configuration/database/account/media checks pass; inactive payment/proof workers not_checked. An empty signup body gets 400 BAD_REQUEST from the trusted origin and 403 FORBIDDEN from an untrusted origin, without creating an account or invoking the limiter. This fresh proof explicitly references the prior 66d0 journey and final three-account cleanup |

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

One owner action remains: supply the actual public operator name, address and
direct contact/privacy email for the existing legal pages. Then publish those
details, finish the required checks for that final change, normally merge PR #4
and verify the actual public Production commit with real signup/photo/relogin
and cleanup. The app candidate already passed required CI and fresh actual
Preview/staged Production F0; the earlier complete user journey retains its
original per-phase evidence.

Production preparation is executed and its actual mutation evidence is retained
privately. Public-domain signup/photo/relogin smoke has not run. Real public
operator/contact details still await one owner response; no identity, policy
approval or retention date was invented. Production auto-deploys main, so PR #4
must remain unmerged until those details are supplied.
Verdict: **the complete real Preview journey and its cleanup PASS; Production
database/storage/configuration and corrected staged F0 PASS; public release and
its real signup/photo/relogin smoke remain pending the operator details**.
