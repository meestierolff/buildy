# Moderation, support and feedback

## Status and scope

Buildy has a typed, server-owned intake path for content reports, product feedback,
support questions, third-party privacy requests and content appeals. The browser no
longer writes directly to the intake tables.

This slice deliberately does **not** expose a moderator queue or moderation actions.
The repository has no trustworthy server-side moderator/admin role or claim model.
Inventing one in the browser or inferring it from profile data would create a privilege
escalation path. Those capabilities stay fail-closed until an explicit RBAC design,
separation-of-duties review and database authorization tests exist.

Private-beta access is implemented separately by migration 0021 and
`server/beta`. New e-mail and Google accounts require an atomic invite redemption
when `BETA_MODE=true`; existing users can still sign in. See
`docs/PRIVATE_BETA.md` for operations and remaining environment gates.

## User journeys

- A visible profile, project, update, media item or comment has a **Melden** action.
- `/melden` explains contextual reporting and offers a no-account third-party request.
- `/support` accepts support, third-party and appeal requests without requiring an account.
- `/feedback` and the authenticated feedback launcher accept product feedback.
- `/contentbeleid` and `/huisregels` explain the rules and photo/privacy expectations.

The confirmation screen returns a non-secret receipt code (`MELD-…` or `HELP-…`).
No response-time, removal-time or legal-outcome promise is made. Direct danger is
explicitly routed to 112 because the support form is not an emergency channel.

## HTTP and trust boundaries

| Route | Authentication | Purpose |
|---|---|---|
| `POST /api/moderation/reports` | Optional | Report content that is visible to the current viewer |
| `POST /api/feedback` | Required | Product feedback from an authenticated beta user |
| `POST /api/support` | Optional; reply email required | Support, third-party request or appeal |

All routes require JSON, reject query parameters and cap the body at 32 KiB. Browser
origin/CSRF enforcement remains centralized in the API router. The intake handler uses
only the platform-normalized `x-vercel-forwarded-for` header as a possible network
identifier; arbitrary forwarded headers are ignored. Raw IP addresses and user agents
are never persisted by this slice.

The service resolves the actor from the server session boundary. It never accepts a
reporter/user ID from the request. Anonymous reporters can only report public content;
an authenticated reporter can report private content only when the existing project
visibility rules grant access. The database revalidates target visibility inside the
write transaction to close time-of-check/time-of-use gaps.

## Data minimization and encryption

Free text, reply addresses and the minimal target snapshot are AES-256-GCM envelopes:

| Value | Additional authenticated data (AAD) |
|---|---|
| Report details | `moderation-report:{reportId}:details` |
| Report reply address | `moderation-report:{reportId}:contact` |
| Report target snapshot | `moderation-report:{reportId}:target-snapshot` |
| Feedback/support message | `feedback-submission:{submissionId}:message` |
| Support reply address | `feedback-submission:{submissionId}:contact` |

Reply addresses also get a keyed blind index in the `email-recipient` namespace. The
email worker must decrypt with the exact AAD and recompute that blind index before use.
Neither plaintext nor reversible contact data belongs in logs, audit metadata,
idempotency hashes or outbox payloads.

Audit events contain only allow-listed operational labels: schema version, target type,
reason/urgency or support kind/category, whether the submission is anonymous, and
whether contact information exists. Target content and reporter messages are excluded.

## Database authorization and integrity

Migration `0018_moderation_support_feedback.sql`:

- removes direct `INSERT` RLS policies for browser roles;
- stores new intake free text in ciphertext columns;
- adds scoped idempotency/request hashes and receipt constraints;
- rechecks active actors and target visibility in fixed-search-path,
  `SECURITY DEFINER` functions;
- revokes every privileged function from `PUBLIC`;
- uses advisory transaction locks plus unique partial indexes for exact replay;
- derives report urgency on the server (`violence` urgent; privacy, sexual or illegal
  content high; other reasons normal);
- records PII-free audit and outbox metadata atomically with the intake row.

Only replay/submission functions are part of the web-role allow-list. The community
receipt loader is intended solely for the dedicated email-worker role and requires the
exact claimed, unexpired lease owner and exact versioned event payload.

## Receipt email event contracts

Report receipt:

```text
aggregate_type: moderation_report
event_type: moderation.report.received.requested.v1
idempotency_key: moderation-report:{reportId}:email:received:v1
payload: {"schemaVersion":1,"reportId":"…","receiptCode":"MELD-…"}
```

Support/appeal receipt:

```text
aggregate_type: feedback_submission
event_type: support.confirmation.requested.v1
idempotency_key: feedback-submission:{submissionId}:email:confirmation:v1
payload: {"schemaVersion":1,"submissionId":"…","kind":"support|third_party_request|appeal","receiptCode":"HELP-…"}
```

The payloads intentionally contain no email address, message, target content or other
reporter PII. `app_email_worker_load_community_receipt(eventId, leaseOwner)` returns one
uniform lease-bound row with aggregate identity, recipient ciphertext, contact hash,
receipt code, nullable kind, creation time and safe target/category labels.

## Abuse controls and idempotency

Exact idempotent replay is checked before consuming rate limits. Client keys are scoped
to the authenticated app-user ID or a keyed anonymous source fingerprint, then hashed
before persistence. Reusing a key with a different request hash fails with a conflict.

Current intake limits are deliberately conservative:

| Intake | Hour | 24 hours |
|---|---:|---:|
| Anonymous reports | 3 | 8 |
| Authenticated reports | 10 | 30 |
| Authenticated feedback | 10 | 30 |
| Support / third-party / appeal | 3 | 10 |

The forms also include a honeypot, strict allow-listed enums and maximum lengths. Rate
limits reduce automated abuse; they are not a substitute for a staffed moderation
process.

## Production gates

Before enabling broad public posting, Buildy still needs:

1. a named moderation/support owner and coverage schedule;
2. approved escalation, evidence-retention and law-enforcement procedures;
3. monitored delivery of receipt events through the dedicated email worker;
4. a real moderator/admin authorization model before any queue or enforcement action;
5. age/minor policy, privacy/legal review and launch-approved policy versions;
6. abuse and accessibility testing with synthetic data;
7. target-environment proof of the private-beta role grants and registration matrix.

Do not place real personal data in local fixtures, screenshots or test databases.

## Verification

Static and unit coverage lives in:

- `tests/server/moderation.test.ts`
- `tests/server/moderation-http.test.ts`
- `tests/db/moderation-migration.test.ts`
- `tests/db/moderation.integration.test.ts` (alleen met een tijdelijke lokale PostgreSQL-database)
- `src/test/moderationApi.test.ts`
- `src/test/moderationComponents.test.tsx`

Run:

```bash
node --import tsx db/migrate.ts --check
bun run typecheck
bunx vitest run tests/server/moderation.test.ts tests/server/moderation-http.test.ts tests/db/moderation-migration.test.ts tests/db/moderation.integration.test.ts src/test/moderationApi.test.ts src/test/moderationComponents.test.tsx
```

Database integration tests remain conditional on a disposable local PostgreSQL
database. Static migration validation is useful but does not replace applying all
migrations and running the authorization probes against that database.
