# Codex Final Handoff Audit

Status: preserved handoff plus verified local regression fixes on `codex/buildy-production-finish`.

This document records what was actually present before any consolidation work beyond preservation, plus the first validated checks run on the preserved branch. It is intentionally conservative: anything not rerun on this exact SHA remains blocked.

## Current candidate

| Item | Value |
| --- | --- |
| Current branch | `codex/buildy-production-finish` |
| Current HEAD | `a0f6bdc65f04e2a62c7c878f73199d313dd71d2c` |
| Pull request | `https://github.com/meestierolff/buildy/pull/2` |
| Latest Preview | `https://buildy-6ounglig3-clarios-projects-05f6a57e.vercel.app` |
| Latest Preview deployment | `dpl_HnLepxw9TujtBYbHf9frN6iJa99x` |
| Hosted CI | latest `Buildy CI` run no longer shows failing checks; 11 successful and 2 pending at last check |

## Preservation snapshot

| Item | Value |
| --- | --- |
| Starting branch | `sol/buildy-production-mvp` |
| Starting HEAD | `452cc74fd352970e24a844ee5171804fa4970dac` |
| Starting worktree count | `git status --short` reported 506 entries |
| Starting tracked diff | `git diff --stat` reported 387 changed files, 16,982 insertions, 22,906 deletions |
| Starting untracked count | `git ls-files --others --exclude-standard` reported 189 files |
| Whitespace check | `git diff --check` returned clean |
| Safety branch | `codex/buildy-production-finish` |
| Safety commit | `7a6d62d00214799a32b0a794ab278da0a2452094` |
| Safety push | `origin/codex/buildy-production-finish` pushed successfully |
| Off-repo backups | `../buildy-sol-handoff.patch`, `../buildy-sol-untracked-files.txt` |

Notes:

- The initial untracked set included the new migration tail through `0050`, new docs, new client/server modules, new tests, and visual snapshot baselines.
- A local helper `parse.py` was present but intentionally excluded from the preservation commit because it referenced a Copilot temp file and was not repository source.

## First validated checks on the preserved tree

| Check | Result |
| --- | --- |
| `bun install --frozen-lockfile` | passing; no lockfile drift |
| `bun audit --audit-level=high` | passing; no vulnerabilities found |
| `bun run typecheck` | passing |
| `bun run lint` | passing |
| `bun run test` | passing; 147 files passed, 18 DB-only skips in the non-DB run |
| `bun run build` | passing |
| `bun run check:bundle` | passing |
| `bun run check:launch -- --static` | passing; 9/9 checks |
| Branch after preservation | `codex/buildy-production-finish` |
| HEAD after preservation | `7a6d62d00214799a32b0a794ab278da0a2452094` |
| Required audit file | missing at handoff; created by this audit |

## Migration ledger

| Item | Value |
| --- | --- |
| Migration count | 50 SQL migrations |
| First migration | `0001_production_foundation.sql` |
| Latest migration | `0050_product_event_key_privacy.sql` |

Current tail:

- `0041_request_driven_photobook_processing.sql`
- `0042_active_worker_retry_enum_casts.sql`
- `0043_vercel_blob_account_exports.sql`
- `0044_bounded_media_orphan_maintenance.sql`
- `0045_request_hash_privacy.sql`
- `0046_checkout_reservation_recovery.sql`
- `0047_project_share_links.sql`
- `0048_feedback_admin_review.sql`
- `0049_product_notifications.sql`
- `0050_product_event_key_privacy.sql`

Clean-room execution and no-op replay have now been rerun successfully against a disposable PostgreSQL 16 database.

## Package and toolchain inventory

| Item | Value |
| --- | --- |
| Package manager | `bun@1.3.3` |
| Node runtime | `v26.7.0` in this session; `package.json` requires `>=22` |
| Bun runtime | `1.3.3` |
| Auth dependency | `openid-client` `6.8.4` in both `package.json` and `bun.lock` |
| Storage dependency | `@vercel/blob` `^2.3.0` |
| Payment dependency | `stripe` `^22.4.0` |
| Database dependencies | `drizzle-orm` `^0.45.2`, `pg` `^8.22.0` |
| Frontend core | React 18, Vite 7, TanStack Query 5, Wouter 3 |

Important note:

- This session proved manifest and lockfile consistency only.
- External registry verification for whether `openid-client` `6.8.4` is still the desired stable pin has not yet been rerun here. Existing repo docs still call out a registry-backed confirmation or bump as an outstanding release task.

## Environment contract

The active environment contract is defined in `.env.example` and parsed in `server/config/runtime.ts`.

Required environment groups:

- Application and origin: `NODE_ENV`, `APP_ENV`, `APP_ORIGIN`, `PRIMARY_DOMAIN`, `TRUSTED_ORIGINS`, `VITE_SITE_URL`
- Product profile and checkout mode: `PRODUCT_PROFILE`, `BETA_MODE`, `CHECKOUT_MODE`
- Database and worker URLs: `DATABASE_URL`, `DATABASE_MIGRATION_URL`, `DATABASE_DIRECT_URL`, `DATABASE_ACCOUNT_WORKER_URL`, `DATABASE_MEDIA_WORKER_URL`, `DATABASE_PHOTOBOOK_WORKER_URL`, `DATABASE_PAYMENT_WORKER_URL`
- Data protection: `PII_ENCRYPTION_KEYS`, `PII_ENCRYPTION_CURRENT_VERSION`, `PII_BLIND_INDEX_KEY`
- Google OIDC: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- Private Blob: `BLOB_READ_WRITE_TOKEN`
- Maintenance cron: `CRON_SECRET`, retention-policy variables
- Stripe: `STRIPE_ENVIRONMENT`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_EXPECTED_ACCOUNT_ID`, `ORDER_PRICE_MATRIX_JSON`, `ORDER_SELLER_JSON`, `ORDER_TERMS_VERSION`
- Local adapter and launch evidence: `BUILDY_API_HOST`, `BUILDY_API_PORT`, `SITEMAP_SOURCE_URL`, `SITEMAP_SOURCE_TOKEN`, `LAUNCH_BASE_URL`, `LAUNCH_EXPECTED_GIT_SHA`

Explicitly absent from the active contract:

- `SESSION_SECRET`
- Better Auth settings
- password, magic-link, or e-mail auth settings
- Brevo or other e-mail provider settings
- Cloudflare R2 or AWS S3 settings
- Peecho API, callback, worker, or credential settings

## Frontend route inventory

The visible client route surface in `src/App.tsx` currently registers:

- `/`
- `/ontdekken`
- `/projecten`
- `/auth`
- `/account`
- `/project/nieuw`
- `/update/nieuw`
- `/project/:id`
- `/project/:id/budget`
- `/project/:id/bouwboek`
- `/volgend`
- `/connecties`
- `/profiel/:profileKey`
- `/notificaties`
- `/delen`
- `/bestelling/:orderId`
- `/bestellingen`
- `/bestellingen/:orderId`
- `/voorwaarden`
- `/privacy`
- `/herroeping`
- `/contentbeleid`
- `/huisregels`
- `/support`
- `/feedback`
- `/melden`
- `/beheer/moderatie`
- `/beheer/moderatie/:reportId`
- `/beheer/bestellingen`
- `/beheer/bestellingen/:orderId`
- `/beheer/feedback`
- `/beheer/feedback/:submissionId`
- `*`

Legacy redirects are still present for older `trip`, `favorieten`, `vrienden`, `profile`, and photobook/budget paths.

## API route inventory

The server route surface is registered in `server/http/router.ts`, with Vercel rewrite restoration in `api/router.ts`.

Key active route groups:

- Health and capability truth: `GET /api/health`, `GET /api/product-profile`, `GET /api/readiness`
- Google OIDC session lifecycle: session, callback, logout, sign-in start
- Beta access and product events
- Projects, discovery, following, updates, phases
- Share-link issue, rotate, revoke, redeem
- Private media upload, completion, grants, same-origin reads and HEADs
- Social profiles, follow requests, blocks, followers, connections
- Own profile and public profile lookup
- Session management, account export, account deletion
- Comments, reactions, notifications
- Floorplans and budgets
- Photobook settings, proof generation, approval, private PDF
- Quote and Stripe checkout
- Orders and Stripe webhook
- Public moderation/support/feedback intake
- Founder moderation admin, founder order admin, founder feedback admin
- Daily account-lifecycle cron

Commit identity exposure:

- `GET /api/health` returns `release: config.VERCEL_GIT_COMMIT_SHA || "development"`, which is sufficient to validate Preview SHA alignment when deployed.

## Database roles and worker inventory

Current least-privilege role model in CI and verification scripts:

- `buildy_migrator`
- `buildy_web`
- `buildy_account_worker`
- `buildy_media_worker`
- `buildy_payment_worker`
- `buildy_photobook_worker`

Current active worker/application boundaries:

- web API runtime
- account worker
- media worker
- payment worker
- photobook worker

Current scheduled runtime:

- only `GET /api/internal/cron/account-lifecycle`

Current database verification facts:

- `db/verify.ts` expects the public-table ledger plus RLS on every public table except the server-auth core tables.
- The verification contract includes privacy, social, share-link, notification, media, photobook, order, moderation, feedback, and account-lifecycle functions.

## Active providers

Active runtime providers and systems:

- Vercel Functions/web runtime
- Neon PostgreSQL
- Google OpenID Connect
- private Vercel Blob
- Stripe-hosted Checkout
- manual print fulfilment by human operator

Inactive in the active runtime:

- Better Auth
- password, magic-link, and e-mail login
- Brevo / transactional e-mail runtime
- Cloudflare R2
- AWS S3
- automated Peecho provider runtime
- Peecho callback/worker/cron/env

## Legacy-provider reference audit

Active runtime guardrails:

- `scripts/check-launch.mjs` statically fails if active runtime files import retired providers or retired route families such as `r2ObjectStorage`, `/email/`, `/fulfilment/`, `/print/`, `@aws-sdk`, `better-auth`, `BREVO_`, `PEECHO_`, or `R2_`.
- A repository-wide marker scan found zero active `.only`, `.skip`, `.fixme`, `TODO`, `FIXME`, or `placeholder` markers.

Current reference classification:

- Active and required: removal statements and operator guidance in docs such as `docs/PROVIDER_SETUP.md`, `docs/QA_FUNCTION_MATRIX.md`, `docs/STRIPE_SETUP.md`, and `docs/OPERATIONS_RUNBOOK.md` still mention retired providers to define the negative contract.
- Historical but safe: `docs/archive/**` preserves Better Auth, R2, Brevo, and automated Peecho history.
- Inactive and removable: none identified yet from the initial static scan.
- Release blocker: no active runtime import of retired providers has been proven in this audit, but provider-backed Preview and production evidence is still missing.

## CI inventory

Current CI workflow jobs in `.github/workflows/ci.yml`:

- `quality`
- `unit-tests`
- `build`
- `dependency-audit`
- `migration-sql`
- `database-integration`
- `public-e2e`
- `cross-browser-core`
- `ci-gate`
- `staging-auth-e2e`
- `staging-release-gate`

Important current CI facts from static inspection:

- The migration job provisions isolated roles and requires migration replay to be a no-op.
- The hard database job is intended to run active PostgreSQL integration files.
- Hosted CI results for this exact SHA have not yet been retrieved in this session.

## Verified local database proof

The clean-room PostgreSQL proof was rerun locally after the handoff was preserved.

| Item | Result |
| --- | --- |
| Disposable database | local Docker `postgres:16.4-alpine`, database `buildy_ci` |
| Migration bootstrap | passed from zero |
| Migration count | 50 |
| Public table count | 53 |
| RLS table count | 45 |
| Runtime roles | `buildy_migrator`, `buildy_web`, `buildy_account_worker`, `buildy_media_worker`, `buildy_payment_worker`, `buildy_photobook_worker` |
| Role/grant verification | passed via `scripts/setup/verify-database-roles.sql` |
| `db/verify.ts` | passed before and after replay |
| Migration replay | exact no-op |
| Active DB integration files | 18 |
| Active DB integration tests | 27 |
| Clean-room DB integration result | passing; 18 files, 27 tests |
| Cleanup | disposable container removed after proof |

The DB regressions found during the first clean-room runs were all test-alignment defects against the current schema contract on this branch; the final from-zero pass succeeded only after those regressions were corrected.

## Playwright inventory

Configured Playwright projects in `playwright.config.ts`:

- `chromium-desktop`
- `firefox-core`
- `webkit-core`
- `mobile-chromium`
- `tablet-chromium`
- `staging-real` when `PLAYWRIGHT_MODE=staging-real`

Current documented browser status on this tree:

- Existing docs record a configured 205-test matrix.
- Static scanning found zero `.only`, `.skip`, or `.fixme` markers.
- Interactive Browser MCP evidence is still absent.
- Current Preview or staging-real execution on the preserved SHA is still absent.

## Current blockers

Release-blocking work not yet re-proven on this exact SHA:

- hosted CI on `codex/buildy-production-finish`
- Preview deployment of the exact candidate SHA
- Preview SHA verification through `/api/health`
- Google OIDC round-trip on Preview
- private Vercel Blob authenticated upload and read round-trip on Preview
- Stripe test Checkout plus verified webhook on Preview
- founder/admin browser journeys on current Preview
- required Playwright MCP interaction on the actual Preview
- any production-live claim

Operational blockers already visible from repository truth:

- Production remains fail-closed until external commercial/legal/provider approvals are real and recorded.
- The integrated browser is available again, but the fresh Preview currently redirects to Vercel deployment protection and then to a GitHub sign-in form. That blocks the required interactive Preview audit unless an already-authenticated browser session is available or the founder changes preview protection.
- The local production-preview browser context was attempted, but without a fully working same-origin runtime in that context it remained on a loading state with `500`/`503` responses, so it does not count as an interactive-green local MCP pass.
- `openid-client` registry-latest verification has not yet been rerun in this session, even though the current manifest and Bun lock are internally consistent.

## Immediate next validation slices

1. Commit and push the current post-handoff fixes on top of the preservation commit.
2. Retrieve or trigger hosted CI for this exact branch and SHA.
3. Deploy the exact candidate SHA to Vercel Preview and verify `/api/health` reports the same commit.
4. Use the browser/Playwright MCP runtime against that Preview, or record the exact runtime blocker if it still cannot be invoked.