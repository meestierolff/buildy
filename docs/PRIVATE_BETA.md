# Private beta operations

## Status and safety invariant

The repository has a server-owned private-beta registration boundary for e-mail
and Google. `BETA_MODE` defaults to `true`; only creation of a new auth user is
gated. Existing users keep normal e-mail, magic-link and Google login.

`BETA_MODE=false` deliberately removes the invite requirement and therefore
opens new registration. It is **not** an incident kill switch. During an access
incident, keep beta mode enabled, revoke affected invites and, if necessary,
disable the auth ingress at the deployment layer.

Production remains NO-GO until migration 0021, least-privilege grants, readiness,
Google callback and real staging registration are proven against the target
environment.

## Registration boundary

1. The browser posts a code once to `POST /api/beta/reservations`. E-mail signup
   includes the normalized address; Google does not know the provider address yet.
2. The server computes keyed blind indexes for code/e-mail and stores a hash of a
   ten-minute opaque reservation. Plain codes and reservation tokens never reach
   PostgreSQL, API bodies, audit metadata or application logs.
3. The opaque token is returned only as a short-lived `HttpOnly`, `SameSite=Lax`
   cookie scoped to `/api/auth`. Replays derive the same server-secret token from
   the idempotency key.
4. Better Auth inserts the auth user and provisions the Buildy app user, mapping,
   profile and recipient. Before that transaction can commit, the registration
   gate verifies provider, actual provider e-mail, invite expiry/status/allowlist
   and remaining usage, then consumes exactly one use.
5. Any failure rolls the auth user and domain identity back together. Invite rows
   are locked while usage is incremented, so concurrent completion cannot exceed
   `max_uses`.

Missing, unknown, expired, revoked, exhausted and e-mail-mismatched invites use
the same public error. Existing-user sign-in never calls the new-user authorizer.

## Endpoints

| Route | Authentication | Contract |
|---|---|---|
| `GET /api/beta/status` | public | beta label and whether new accounts need an invite |
| `POST /api/beta/reservations` | public + trusted browser Origin | strict code/provider/e-mail/idempotency body; no secret response fields |
| `POST /api/product-events` | optional session | one of four strict browser event shapes; server resolves the actor |

Reservation attempts are durably rate-limited by pseudonymous source and invite
hash. Product events have a separate per-subject limit. Query strings and
non-JSON/oversized bodies are rejected.

## Invite administration

Use a direct migration-owner connection and a fresh 32-byte blind-index key in
the environment. Never place a code in a shell argument, ticket, chat or log.

```bash
bun run beta:invites -- generate \
  --output ./artifacts/invites/tester-001.secret.json \
  --email tester@example.test \
  --max-uses 1 \
  --expires-days 14 \
  --cohort private-beta

bun run beta:invites -- revoke \
  --code-file ./artifacts/invites/tester-001.secret.json
```

`generate` refuses an existing output path, creates the secret file as mode
`0600`, writes the one-time code before committing the database transaction and
prints only a safe status/path. If commit outcome is uncertain, it preserves the
file for audit reconciliation. The admin functions are revoked from `PUBLIC` and
must never be granted to a runtime role.

## Product instrumentation

`product_events` is an RLS-enabled append-only first-party ledger. Browser input
is limited to `signup_started`, `project_shared`, `photobook_opened` and
`error_encountered`, with exact enum properties. Database triggers capture:

`signup_completed`, `onboarding_completed`, `project_created`,
`first_update_created`, `photo_upload_completed`, `follow_requested`,
`follow_accepted`, `comment_created`, `photobook_draft_generated`,
`proof_generated`, `proof_approved`, `checkout_started`, `checkout_completed`
and `feedback_submitted`.

The ledger stores event identity, UTC time, a one-way pseudonymous subject and
exact allow-listed properties. Addresses, names, e-mail values, captions,
comments, photo/signed URLs, access tokens and PDF paths are forbidden. There is
no third-party analytics SDK or provider identifier in this contract.

## Verification and rollout

Run before each beta expansion:

```bash
bun run typecheck
bunx vitest run \
  tests/server/beta.test.ts \
  tests/server/beta-http.test.ts \
  tests/server/auth-identity.test.ts \
  tests/server/auth-factory.test.ts \
  tests/db/private-beta-migration.test.ts
bun run db:migrate
bun run db:verify
```

Then prove on staging: invalid/expired/revoked/exhausted/e-mail-mismatch parity,
same-key replay, two concurrent completions of a one-use invite, existing e-mail
and Google login, new e-mail signup, new Google callback, no secret in responses
or logs, audit rows and all event producers. Expand cohorts only after the
criteria in `docs/USER_TESTING_PLAN.md` are met.
