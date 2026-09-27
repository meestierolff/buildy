# Buildy — keep the core small

Read [GRAPH](docs/architecture/GRAPH.md) and [STATE](docs/architecture/STATE.md),
then only the affected flow in [FLOWS](docs/architecture/FLOWS.md).

**Maak van je verbouwing een verhaal om te bewaren.**
Account → private renovation → photo/date/text Bouwmoment → chronological story
→ share/follow/react/comment → digital Bouwboek/PDF.
Preserve React/Vite, Vercel, Neon, private Blob and the existing design.
Budget, floorplans, broad discovery, invitations, OAuth, demo modes and physical
ordering are removed. Do not rebuild them as part of a core change.

## Working loop

1. Inspect git status first; preserve local work. No reset/clean/force-push.
2. Name the affected flow and trace UI → API → access → persisted data.
3. Reuse the existing implementation; remove unused code instead of adding abstractions.
4. Verify proportionately. No CI, GitHub Actions, browser matrices, coverage or
   database integration suites. Do not recreate release gates. Unit tests,
   typecheck and lint are optional manual tools; Vercel runs only the app build.
5. Update graph/flows only for changed contracts, STATE for actual evidence.

## Runtime boundaries

- Identity, ownership and access remain server-side. Keep RLS and restricted roles.
- Keep scrypt hashes, hashed sessions, HttpOnly cookies, same-origin mutation
  checks, rate limiting and safe redirects. No shared/guest identities.
- New username accounts collect no email; password recovery is not implemented.
- Private media requires authorization, including after link revocation or blocking.
  Direct Blob uploads use server-issued scoped authorization.
- One canonical chronological document drives preview, page count and PDF.
- Preserve retry-safe mutations, account export/deletion and bounded cleanup.
  Keep historical database records and applied migrations; no schema reset or
  encryption-key rotation. Migration changes are append-only when necessary.
- Never expose secrets, session cookies, private URLs or personal content in Git,
  logs, screenshots or evidence. No paid plans, payments or print orders.

Computer Use and normal non-destructive commit/push/merge/deploy are authorized.
The owner performs personal login/MFA or secret entry that tools cannot keep private.
Keep the prior deployment for rollback and confirm the published SHA/profile.
Finish concisely with what changed, actual evidence and any remaining limitation.
