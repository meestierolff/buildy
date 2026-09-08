# Current state and next action

This is the only mutable progress sheet for the small MVP. It is not an automatic monitor.
Replace stale entries; do not append a new release essay after every session.
Read [GRAPH](GRAPH.md) for boundaries and [FLOWS](FLOWS.md) for acceptance.

## Verified snapshot — 2026-09-07

| Fact | Observation / evidence |
| --- | --- |
| Inspected source | `main` at `162be48ee3c494c821d3ffe0cb19e9cbda0a4af4`; [source](https://github.com/meestierolff/buildy/tree/162be48ee3c494c821d3ffe0cb19e9cbda0a4af4) |
| Production identity | Same full SHA from [health](https://buildy-gamma.vercel.app/api/health), read 2026-09-07 07:09 UTC |
| Production profile | `public_demo`, checkout `off` from [product profile](https://buildy-gamma.vercel.app/api/product-profile), read 2026-09-07 07:08 UTC |
| Enabled vs disabled | Profile reports demo book preview and feedback enabled; Google sign-in, renovations, updates, media, sharing and account deletion disabled. Health reports database ready. |
| Meaning of that response | Configuration/status observation only. No fresh account, upload, feedback mutation or end-to-end browser journey was executed during this documentation task. |
| Candidate history | [PR #2](https://github.com/meestierolff/buildy/pull/2) merged the public demo. It is not an open activation PR. |
| Preview/provider readiness | Not reverified here. An earlier temporary Neon branch had expiry `2026-09-06T21:59:00Z`, now past. Check actual branch existence before reusing its URL or credentials. |

The core modules exist in source, but that is not evidence that the account-based hosted MVP works.
`public_demo` remains the known rollback option. `feedback_beta` is the existing target profile, not an instruction to flip production immediately.

## Current proof matrix

All hosted-user statuses below concern the target `feedback_beta`, not the static demo.

| Flow | Source anchor exists | Fresh targeted test in this task | Real hosted user proof |
| --- | --- | --- | --- |
| F0 Profile/configuration | Yes | NOT_RUN | NOT_RUN for target Preview; production metadata only was checked |
| F1 Account/session | Yes | NOT_RUN | BLOCKED: no active production auth; Preview/config unknown |
| F2 Save photo/moment | Yes | NOT_RUN | NOT_RUN |
| F3 Share/revoke | Yes | NOT_RUN | NOT_RUN |
| F4 Like/comment | Yes | NOT_RUN | NOT_RUN |
| F5 Personal Bouwboek | Yes | NOT_RUN | NOT_RUN; static example is not evidence |
| F6 Feedback/deletion | Yes | NOT_RUN | NOT_RUN; enabled flag is not persistence proof |
| F7 Release | Existing release tooling | NOT_RUN | NOT_RUN for target MVP |

## Next slice: F0 → F1, not another rewrite

1. Inspect local worktree and current HEAD; do not discard work. Recheck production SHA/profile and isolated Preview availability through authorized CLI/API.
2. Inspect required config names and readiness for the **existing** OIDC/Neon/Blob path, without printing secrets. See [.env.example](../../.env.example) and [composition](../../server/composition.ts).
3. If Google setup is still deferred by the owner, record that specific blocker and request one approval/configuration action. This documentation does not authorize OAuth setup, new auth, Computer Use, plan upgrades or production activation.
4. When authorized, prove F1 on the isolated Preview. Then follow F2 → F3 → F4, F5 and F6; release only after their combined real journey succeeds.

Do not label a free/closed beta non-commercial solely because payments are off. Hosting and data-handling conditions still need factual confirmation at release; never fabricate approval fields or dates.
Do not re-run unrelated commerce work or resurrect hidden UI while waiting for the owner action.

## Compact handoff — replace after each slice

- Active slice: F0 → F1.
- Changed node/edge: none; this task adds documentation/instructions only.
- Candidate: use `git rev-parse HEAD`; keep source SHA distinct from deployment SHA.
- Tests/action/evidence: read-only repository and production snapshot above; no runtime changes.
- Blocker: owner-approved identity configuration and current isolated Preview status are not proved.
- Next action: inspect safe config presence and ask only for the missing identity approval/setup, if still absent.
- Target verdict: account-based MVP NOT_VERIFIED. Public demo online does not satisfy F1–F7.
