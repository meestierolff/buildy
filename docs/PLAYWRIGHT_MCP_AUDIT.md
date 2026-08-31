# Buildy Playwright MCP interactive audit

Snapshot: 2026-08-24. **Interactive result: BLOCKED by protected Preview access.**

This document records the required in-app-browser audit separately from automated Playwright. It does not upgrade a listed, synthetic, headless, local, CI, or unit test into interactive verification.

## Runtime evidence

The integrated browser runtime is available in this session and was used.

Observed state:

- the fresh Preview `https://buildy-6ounglig3-clarios-projects-05f6a57e.vercel.app`
  redirects to `vercel.com/login`, then to a GitHub sign-in form in order to
  pass Vercel deployment protection;
- that GitHub page requires credentials that cannot be supplied or requested
  through the model, so the actual Preview route audit stopped before reaching
  Buildy itself;
- a local production-preview bundle was also opened in the integrated browser,
  but it remained on a loading state with `500`/`503` same-origin API failures,
  so it does not count as an interactive-green local context;
- no actual Buildy Preview page, route, control, dialog or flow was reached in
  the integrated browser;
- no automated browser evidence was promoted to interactive verification,
  because headless Playwright is not a substitute for the mandatory in-app-
  browser audit.

No screenshot path, trace path, observed result, request result or interactive-green claim in this document is fabricated.

## Status contract

Every status cell contains exactly one of the project’s four allowed values:

- `automated+passing`
- `interactively verified+regression`
- `intentionally removed`
- `BLOCKED`

There are no `interactively verified+regression` rows in this snapshot.

## Required four-context audit

| Context | Intended target | Required scope | Status | Actual evidence |
|---|---|---|---|---|
| 1. Current deployment | Deployment that existed before the final cutover | Full anonymous/authenticated/admin role and route audit | BLOCKED | The required browser request was quota-rejected; target was not opened. |
| 2. Local production build | Locally built app served in production-preview mode | Repeat the complete audit against the exact production bundle | BLOCKED | The browser opened `http://127.0.0.1:8090/`, but the page remained on a loading state with `500`/`503` same-origin API failures and therefore did not provide a usable interactive product surface. |
| 3. New Vercel Preview | Fresh Preview containing the integrated changes | Repeat every role/view/action and capture genuine defects/artifacts | BLOCKED | The browser reached the protected Preview origin, but Vercel deployment protection redirected to `vercel.com/login` and then to a GitHub sign-in form before Buildy itself could load. |
| 4. Final production deployment | Final production origin after release | Non-destructive smoke of critical public, auth, owner, follower, admin and order-read paths | BLOCKED | No production page was opened in the required runtime. |

The four contexts are independent gates. A later success in one context does not retroactively verify the other three.

## Role, view and action matrix

“Actual” remains “not executed” wherever the in-app browser could not run. Regression candidates are pointers, not proof of the interactive action.

| Role | View / route | Required action and expected result | Status | Actual / regression candidate |
|---|---|---|---|---|
| Anonymous visitor | `/` | Navigate header/anchors/footer, use local-photo demo without upload, open example and discovery | BLOCKED | Not executed. Candidates: [`tests/e2e/discovery.e2e.ts`](../tests/e2e/discovery.e2e.ts), [`src/test/LocalPhotoDemo.test.tsx`](../src/test/LocalPhotoDemo.test.tsx). |
| Anonymous visitor | `/ontdekken`, public `/profiel/:profileKey`, `/project/:id` | Search/filter/paginate, open profile/project/update/gallery, verify private data stays hidden | BLOCKED | Not executed. Candidates: [`tests/e2e/discovery.e2e.ts`](../tests/e2e/discovery.e2e.ts), [`tests/e2e/friends-follow.e2e.ts`](../tests/e2e/friends-follow.e2e.ts), [`tests/e2e/project-detail.e2e.ts`](../tests/e2e/project-detail.e2e.ts). |
| Anonymous visitor | legal, `/support`, `/melden`, `*` | Follow every legal/support/report link, validate and submit public forms, verify useful 404 | BLOCKED | Not executed. Targeted automated candidates: [`tests/e2e/public-support.e2e.ts`](../tests/e2e/public-support.e2e.ts), [`tests/e2e/discovery.e2e.ts`](../tests/e2e/discovery.e2e.ts). |
| Anonymous/private outsider | private profile/project and media routes | Receive a non-leaking denial; no media, reactions, comments or private metadata | BLOCKED | Not executed; profile/security unit/service regressions pass, but the current clean-room RLS and browser actor matrices did not run. |
| Anonymous/share recipient | `/delen` and an `unlisted` project | Redeem a high-entropy fragment token; verify pre-React scrubbing, signed cookie continuation, exact project/media access, expiry, revocation and tamper denial | BLOCKED | Not executed. Current UI/client/server regressions exist in [`tests/e2e/project-share-link.e2e.ts`](../tests/e2e/project-share-link.e2e.ts), but the current E2E and DB integration runs did not execute. |
| New user | `/auth` | Start Google sign-in/registration, preserve safe `next`, complete callback and server-owned session | BLOCKED | Not executed with a real provider/session. Candidate synthetic contract: [`tests/e2e/auth.e2e.ts`](../tests/e2e/auth.e2e.ts). |
| New user | onboarding, `/project/nieuw`, `/update/nieuw`, `/project/:id/bouwboek`, `/feedback` | Complete first profile, private-default project, photo, Bouwmoment, Verhaal, Bouwboek and feedback | BLOCKED | Not executed in the required browser. Unit/server regressions pass; real Google onboarding and live private media remain unverified. |
| Owner A | `/projecten`, `/project/nieuw`, `/project/:id` | Create/edit/delete project; exercise all four visibility modes; create/copy/rotate/revoke an `unlisted` share link; cover, phases/milestones; use camera/library/drop, multi-preview/reorder/remove, local duplicate warning, per-image progress/retry; gallery and before/after | BLOCKED | Not executed. Candidates: [`tests/e2e/project-detail.e2e.ts`](../tests/e2e/project-detail.e2e.ts), [`tests/e2e/project-registration-synthetic.e2e.ts`](../tests/e2e/project-registration-synthetic.e2e.ts), [`tests/e2e/project-share-link.e2e.ts`](../tests/e2e/project-share-link.e2e.ts). |
| Owner A | timeline/social controls | Moderate comments, react/comment and inspect notifications | BLOCKED | Not executed; no complete owner/follower actor fixtures ran. |
| Owner A | direct project follow/access controls | Follow a project directly or accept/reject/revoke a per-project access request | intentionally removed | Visible controls and the project-follow/project-access HTTP/client/service contracts are removed; append-only SQL history is not an active API. Owner-issued expiring share links are the active `unlisted` sharing path. |
| Owner A | budget and floorplan | Create/edit/delete budget/items/floorplans/pins and upload private floorplan media | BLOCKED | Not executed. Candidate: [`tests/e2e/account-budget.e2e.ts`](../tests/e2e/account-budget.e2e.ts); live media remains blocked. |
| Owner A | `/project/:id/bouwboek` | Change layout, reorder/exclude, request/download/approve exact proof | BLOCKED | Not executed. Candidate: [`tests/e2e/photobook.e2e.ts`](../tests/e2e/photobook.e2e.ts). |
| Owner A | `/account` | Edit profile, revoke session, export/download data and request deletion | BLOCKED | Not executed; current unit/server/migration regressions pass, while current DB integration does not. |
| User B, public follower | `/ontdekken`, `/connecties`, `/profiel/:key`, `/volgend`, `/notificaties` | Search, follow, see feed/profile/project/update, react/comment, follow first-publish/order notification target, unfollow | BLOCKED | Not executed. Candidate: [`tests/e2e/friends-follow.e2e.ts`](../tests/e2e/friends-follow.e2e.ts); current DB integration did not run. |
| User C, private-profile requester | `/profiel/:key`, `/connecties` | Send/cancel/resend profile follow request; owner accepts/rejects/removes follower; requester sees approved private profile | BLOCKED | Not executed. Existing E2E does not cover all actor states. |
| User C, project-specific requester | private `/project/:id` | Request connection-only project access | intentionally removed | Direct per-project access workflow is outside the active MVP. |
| Blocked user | profile/project/search/feed/media/notifications | Block causes immediate revocation and suppresses search/comment/reaction/media/notifications; unblock does not restore relationships | BLOCKED | Not executed. Service/security regressions pass, but no current clean-room or browser blocker/blocked fixture pair ran. |
| Founder/admin | `/beheer/moderatie`, `/beheer/moderatie/:reportId` | Verify ordinary-user denial; filter/list/detail; take/restore moderation actions and inspect audit | BLOCKED | Not executed. Current component/server/migration regressions pass; current DB integration does not. |
| Founder/admin | `/beheer/feedback`, `/beheer/feedback/:submissionId` | Verify moderator/ordinary-user denial; filter metadata-only queue; decrypt selected detail; apply versioned/idempotent review status | BLOCKED | Not executed. Current component/client/server/migration regressions pass; current DB integration does not. |
| Founder/admin | `/beheer/bestellingen`, `/beheer/bestellingen/:orderId` | Verify ordinary-user denial; list/detail; download PDF; set manual status/reference/tracking/notes; inspect audit | BLOCKED | Not executed interactively. Current UI/server/migration regressions cover the core states, but current E2E/DB execution and transition breadth remain absent. |
| Buyer | `/bestellingen`, `/bestellingen/:orderId` | List/read only own orders, retry, view tracking, terms, support and approved proof | BLOCKED | Not executed. Candidate unit regressions: [`src/test/Orders.test.tsx`](../src/test/Orders.test.tsx), [`src/test/OrderConfirmation.test.tsx`](../src/test/OrderConfirmation.test.tsx). |
| Buyer | Bouwboek checkout | Quote/address/terms, Stripe test checkout, cancel/success, duplicate webhook and refund journey | BLOCKED | Not executed in the required browser. Unit/server regressions cover `CHECKOUT_MODE=test`; current DB and real Preview Stripe runs are absent, and `live` remains NO-GO. |

## Required interaction dimensions in every context

| Dimension | Required observation | Status | Evidence |
|---|---|---|---|
| Accessibility snapshot | Use the browser accessibility tree to discover and verify each view before action | BLOCKED | No browser. |
| Navigation | Every header/footer/mobile link, CTA, project/profile/update/order/admin target and legacy redirect | BLOCKED | No browser. |
| Controls | Buttons, menus, dialogs, tabs, accordions, filters, pagination, lightbox, sliders and confirmation flows | BLOCKED | No browser. |
| Forms | Happy path, required fields, malformed/long/random input, cancel/retry/idempotent re-submit and server errors | BLOCKED | No browser. |
| History/routing | Back, forward, reload, query/hash preservation, deep links, protected `next`, 404 and stale IDs | BLOCKED | No browser. |
| Runtime diagnostics | Unexpected console errors, `pageerror`, failed requests, redirects and every HTTP 5xx | BLOCKED | No browser/runtime observation. |
| Loading/failure | Skeleton, empty, retry, offline/failed response, access denied and provider failure states | BLOCKED | No browser. |
| Keyboard/focus | Tab order, focus return/trap, Escape, Enter/Space and visible focus | BLOCKED | No browser. |
| Responsive behavior | 390×844 mobile, 768×1024 tablet and 1440×1000 desktop; overflow and touch targets | BLOCKED | No browser. |

## Automated Playwright inventory — not interactive evidence

The current production build passes. `PLAYWRIGHT_MODE=preview bunx playwright
test --list` enumerates the complete configured matrix: **205 tests**. The
tests did not execute: Vite could not bind `127.0.0.1:8090` inside the sandbox,
and the required escalation was rejected by the same Codex quota. Listing is
configuration evidence only and is **not** a passing browser result.

| Project | Browser / viewport | Selected scope | Listed tests | Status |
|---|---|---|---|---|
| `chromium-desktop` | Chromium, 1440×1000 | Complete configured desktop selection | 69 | BLOCKED |
| `firefox-core` | Firefox, 1440×1000 | Nine-spec cross-browser core | 34 | BLOCKED |
| `webkit-core` | WebKit, 1440×1000 | Nine-spec cross-browser core | 34 | BLOCKED |
| `mobile-chromium` | Chromium, 390×844 | Same nine-spec core | 34 | BLOCKED |
| `tablet-chromium` | Chromium, 768×1024 | Same nine-spec core | 34 | BLOCKED |

The harness configuration in [`playwright.config.ts`](../playwright.config.ts) requests trace on first retry, screenshot only on failure, and retained video on failure. [`tests/e2e/helpers.ts`](../tests/e2e/helpers.ts) installs an automatic fail-closed collector for unexpected console errors, `pageerror`, `requestfailed`, and HTTP 5xx, without a blanket failed-resource ignore. These are configuration facts, not generated artifacts or execution results.

No current project has a passing execution record. A prior 143-test run belongs
to an earlier, smaller tree and is not release evidence for the current SHA.
The complete matrix must run in hosted CI and against the fixed Preview.

### Filtering and skip audit

- Firefox/WebKit include `friends-follow`, `photobook` and `project-detail` in
  addition to the public core, including the current project-detail cases.
  Their selection remains narrower than Chromium and does not prove real
  Google, Blob, Stripe or complete admin actor/provider journeys.
- Mobile/tablet now use the same nine-spec cross-browser core as Firefox/WebKit,
  but still do not provide all desktop role/payment/admin coverage.
- Static inspection and `--list` found no `skip`, `fixme` or `only` marker. No
  execution occurred, so this is not a zero-skip runtime claim.
- The protected staging workflow is explicit/manual and rejects any skipped test, but it has not been executed in this audit. See [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).
- The automatic `public-e2e` job runs the complete `chromium-desktop` project
  without a file filter; it and every cross-browser project reject JUnit output
  containing skips and feed the central CI gate. No GitHub Actions run result
  was retrieved here. See [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
  (lines 372-558).
- `account-budget.e2e.ts` now asserts server-owned account data and Google-only login without a password fixture.
- `photobook.e2e.ts` distinguishes fail-closed `off` from exact server-quote/manual-fulfilment behavior in `test`; live Stripe remains outside local automation.

## Missing regressions and priority

### P0

1. Restore a non-empty in-app-browser runtime and run all four contexts; do not substitute headless Playwright.
2. Supply explicit non-PII real-Preview actor fixtures for new user, owner A, public follower B, private requester C, blocked pair, founder/admin and buyer/order reader. Fail closed if any identity is unavailable.
3. Require all automatic gate dependencies in hosted GitHub Actions; local
   Vitest/build/static checks do not establish the current 49-migration DB,
   dependency-audit or 205-test browser result.
4. Re-run all five projects in hosted CI and on the final Preview SHA; expand
   cross-browser/responsive coverage for auth, account/admin, failure states and
   genuine provider boundaries where the selected core remains narrower.
5. Execute and expand founder-admin coverage across feedback/moderation/order
   denial, queues, detail/PDF, every manual transition, external
   reference/tracking and audit state; current DB/browser execution is absent.

### P1

1. Preserve the new synthetic legal/support/third-party-report/feedback,
   account/session/export/deletion and notification coverage; add the remaining
   expired/stale-ID, private-denial and genuine same-origin private-media paths.
2. Preserve the new deterministic, zero-skip synthetic fixtures and require their CI JUnit zero-skip checks; add explicit real-environment fixtures only in separately selected protected suites.
3. Preserve Google-only auth assertions and cover `CHECKOUT_MODE=off` fail-closed, automated/Preview `test`, and live external gating as three distinct expectations.
4. Exercise genuine Vercel Blob upload/token/completion/integrity/download and proof-PDF/manual-order flows without logging PII or permanent URLs.

### P2

1. Add exhaustive keyboard/focus, history/deep-link, retry/offline, long/random input, and responsive-layout action sets.
2. Create deterministic visual/a11y baselines only after each target is reachable and stable; retain only real failure artifacts.

## Re-entry protocol and honest evidence record

When the browser runtime is available, execute contexts in order 1→4 and record each action with:

| Required field | Current value |
|---|---|
| Context and exact origin | Not executed |
| Role/fixture identifier | Not provisioned |
| Route/view/action | Not executed |
| Expected result | Defined in the matrices above |
| Actual result | Not observed |
| Console/page error | Not observed |
| Request/response/redirect | Not observed |
| Screenshot/trace/video | None |
| Regression path | Candidate paths only; see rows above |
| Status | BLOCKED |

Do not change a row to `interactively verified+regression` until both the in-app action and its cited regression have passed in the same product snapshot.
