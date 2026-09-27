# Current state

Scope: [GRAPH](GRAPH.md). Behavior: [FLOWS](FLOWS.md).

## Published baseline — 2026-09-27

PR #4 merged as `3d5a60af8f1a41419b1e0512cbb12246a61953fc`.
Production deployment `dpl_Ho7DJcoeUF1QACw2Lnsc1xQbnkXh` is READY at
https://buildy-gamma.vercel.app. Public health returned that exact SHA;
configuration, database, account/media/photobook workers passed readiness.
Native Chrome displayed the actual landing and username/password form.
Checkout and invitations were off. This deployment remains available for rollback.

Main has 53 applied migrations. Only 0052/0053 were added this session;
canonical grants passed for the existing restricted runtime roles.
Rollback branch `br-damp-night-b1l5amxe` was created from main at LSN
`0/2EF2688`, without a compute endpoint. No credentials were rotated.

GitHub Actions is disabled repository-wide. Workflows, browser suites,
coverage and database integration suites are removed. Vercel runs only
`bun run build`; manual unit tests/typecheck/lint are optional.

## Core simplification — 2026-09-27

The owner requested a thorough removal of unused and non-core code, then
commit/push/deploy. This change removes budget/floorplans, discovery feeds,
checkout/Stripe/order administration, physical-print approval, Peecho setup,
OAuth repository remnants, beta invitations/product-event tracking, demo
profiles, old import tooling, unused UI and old release/audit documentation.
App starts authentication directly, without a preceding product-profile fetch.
One toast system remains. Sitemap generation no longer fetches an external feed.

Existing password/session security, private upload/read checks, sharing,
exact-project following, comments/reactions, canonical PDF generation,
moderation/support and account export/deletion remain. Applied migrations,
schema and stored historical data are preserved. No database change is needed.

F1–F7 focused verification: 149 selected unit checks passed, including password
sessions, core composition/routes, project sharing/following, canonical PDF and
client capability handling. Typecheck and lint passed. The build passed in 2.13s.
The first check caught a removed readiness helper and one stale test assertion;
both were corrected. A stale setup-tsconfig reference was removed from the build.
No full suite, browser matrix or PostgreSQL test infrastructure was reinstated.

Against the existing pre-cleanup local build, JavaScript changed from 77 to 66
chunks and from 358,727 to 320,512 summed gzip bytes (10.7% smaller). This is total
JavaScript output, not a measured page-load latency improvement. Book-preview
fonts now use Latin subsets matching the renderer's typefaces.

Cleanup commit `5597ea9e2a32a05afdd20ed83f230dfd6a176779` is live at the public
URL through READY deployment `dpl_rEQeKyBss6TSDp5AMQWNM82UUHqG`. A disposable
account completed actual UI signup, private photo/date/text persistence after
reload and logout/login, and a canonical PDF download with matching hashes.
Its account deletion request immediately revoked session/project/media access.
No browser errors or server 5xx occurred. Physical cleanup was not asserted.

## F1 signup usability fix — 2026-09-27

An email entered in the username field triggered local validation before any
signup request. The form now explains the username requirement, shows errors
beside the affected field and offers a button to use the email's valid name part.
The user must explicitly select that suggestion; no email is persisted.
The shared client/server signup minimum is now 10 characters. Recovery-availability
copy was removed from the signup form and terms; no recovery feature is promised.

38 focused authentication/copy checks passed in 4.26s, including a real scrypt
hash for a 10-character password and rejection of 9 characters before storage.
Typecheck, changed-file lint and the production build (3.21s) passed.
Next action: publish this fix and verify actual signup/re-login with a disposable
account and an exactly 10-character password on the resulting production SHA.

The unrelated short-book change remains preserved in commit `30cb14a` on
`pending/digital-book-pages`; migration 0054 was not applied or authorized.
This signup release is based on the deployed cleanup and requires no migration.

## Existing real hosted evidence

The prior isolated Preview proved registration, private photo/date/text saves,
reload and logout/login, then a second account following exactly one project,
reacting and commenting without edit rights. Revocation denied project,
update, comment and media access and removed the project from following.
Actual private Blob uploads and a downloaded 24-page PDF matched canonical
content/hashes, backdated A→B→A chronology and all long text; pages were visually
inspected. The patched renderer processed a fourth photo and updated PDF.
Both synthetic accounts requested deletion: immediate session/access denial
passed. Physical cleanup was not claimed. All issued share links were revoked.

Sources: `8d7f711bd58ca02800860d292a5416e476c0ed54` and
`775db05ccfc99de09eb2309bafa16a0536311ce6`. This is prior evidence, not a claim
that every removed/reworked surface has been retested on the new cleanup.

Physical ordering is outside the current app. The earlier live Peecho read
of product 7382413 succeeded; quotes required company details, explicitly
deferred by the owner. No payment, print order, margin or print compatibility
has been established. Retired implementation and older evidence remain in Git.
