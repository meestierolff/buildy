# Current state

Scope: [GRAPH](GRAPH.md). Behavior: [FLOWS](FLOWS.md).

## Tester feedback implementation — 2026-10-03

Implementation covers profile photo upload; project cover, visibility and
planned dates; automatic date-based progress; owner-only notes, costs and own/
contractor hours per Bouwmoment; project budget; and deletion of custom phases
without deleting moments. Project settings and sharing fit the mobile story.
Own projects are the first navigation destination, followed by the timeline.
Vertical lightbox swipes dismiss a moment; account deletion is less prominent.

The book editor follows the selected preview page, including desktop spreads,
and generates canonical unsaved previews while preserving explicit saving.
A compact live preview remains visible inside the mobile editor. Customers can
submit retry-safe manual book requests with a frozen document and encrypted
contact/delivery details. Admins use `/admin/boeken` to review requests, reply,
change status and download the stored version as PDF. Customer proof/PDF routes
are forbidden server-side, including known historical revision URLs. Account
exports retain personal source content and decrypt request details but omit
PDF bytes. Accepted/printing requests block account/project deletion; unaccepted
requests are cancelled before access revocation and existing cleanup erases them.

Local verification: 86 focused book UI, ordering, HTTP/access,
canonical-document, actual PDF-renderer and migration-discovery cases passed;
typecheck and changed-file lint passed. Separate focused navigation, gestures,
routing, budget/private-data and avatar/project-settings checks also passed.
The application build passed. These check groups overlap and are not a combined
coverage total. Append-only migrations 0056–0059 were applied on an isolated Neon
branch and production; all 59 migration hashes and the five restricted runtime
role configurations were verified. The isolated branch exercised actual persisted
budgets, private-field redaction, phase deletion/replay, previews, book requests,
administrator PDF rendering and accepted-order project-deletion blocking.

Published application SHA `f4c747853bb66f5c194d642017feb9699529d71e` is READY in
deployment `dpl_87Nbyquo17BiAM2tyncuJfpWLnJy` at
`https://buildy-gamma.vercel.app`. The live health response confirmed that SHA,
production and ready database/authentication/account/media/photobook capabilities.
Product profile is `feedback_beta`, checkout `off`; payments and automatic print
fulfilment remain disabled.

Hosted checks used one synthetic account and actual scoped private Blob uploads.
They confirmed avatar binding/removal and preserved login/profile names; fixed
covers surviving later moments/replacement; public-to-private media revocation;
date progress; budget/notes/hours persistence and retry totals; custom-phase
deletion preserving moments; and anonymous redaction. Customer PDF routes and
admin access returned 403. A real book request and retries preserved the frozen
document after later editor changes; its canonical document excluded private
notes, costs and hours. Computer Use at 390×844 confirmed project-first navigation,
no horizontal overflow, sharing beside the owner name, profile/settings/private
fields, synchronized book controls and saved live-preview edits. Swipe direction
handling is covered by focused tests, not a physical-device claim.

The hosted administrator PDF/status flow remains unverified: automatic approval
review rejected temporarily granting the synthetic account production admin.
Specific approval is pending. No production administrator was configured when
checked; the owner has been asked which existing username should receive that
role. No customer print order was sent to a printer.

The previous production application is retained for rollback: READY deployment
`dpl_EMjd3h45oCZDxWiwawD3URmn34np`, SHA
`f90f3a4e1c3f32d773df8101d254885bd268bd5c`.
Neon restore point `br-solitary-tooth-b1ljsacw` was created before these migrations,
without a compute endpoint. Applied migration files and historical records remain
unchanged.
Book requests do not take payment or automatically contact a printer. Buildy must
confirm price, print specifications (including bleed/page requirements) and
delivery with the customer before manually sending the PDF to a printer.

## Social mobile redesign — 2026-09-30

Local implementation now combines accepted user follows and explicit project
follows in the timeline, with owner profile links, deduplication and unchanged
server access checks. Profile project listing excludes private/unlisted projects.
Migration 0055 adds user followers to first-publication notifications; explicit
project mutes suppress both notification paths.

The mobile app uses photo-led cards, a compact chronological project story,
Tijdlijn/Projecten/Toevoegen/Boeken/Profiel navigation, builder search and actual
unread notification counts. Camera/library capture, photo ordering, milestone
editing, comments, emoji and automatic canonical books reuse the existing flows.
The landing and own/public profile screens share the new forest/white design.
Settings are at /account and the project book shelf at /bouwboeken.

Focused project/social/router/migration checks passed (125 cases); focused
profile, navigation/auth/photo-handoff, capture, timeline/card and engagement
checks also passed. Typecheck, changed-file lint and the app build passed.
These are local checks, not hosted evidence. Computer Use inspected a public
Polarsteps timeline and the actual local landing at 390×844 CSS pixels; no
horizontal overflow was present. Reference screenshots remain outside Git.

The previous deployed main release was confirmed as
`6251b1dae86994563f61d83907573cc1384093e4` in READY production deployment
`dpl_2exYu6rmLbhATr918srucwTUY4AP`. It remains the application rollback.
Initial redesign release `1a8e346b3dfc317579192e615c7cda981df09460` reached
READY as `dpl_317NLh8D5hGnBG7FGfH3B7PTJvb4` on the ordinary public domain.
Two synthetic accounts verified user-only following and first-publication
notifications, project+user deduplication, hidden drafts, comment/emoji persistence,
notification read state, voluntary unfollow preserving an accessible explicit
project, and private-profile request/acceptance. Owner removal and blocking denied
project, timeline, comment and media reads and removed feed content. Restoring the
synthetic relationship restored permitted access.

Two real private Blob photos produced a six-page PDF (2,132,809 bytes); both the
PDF bytes hash and canonical document hash matched the API checksums. Preview
and downloaded proof used the same page count. The first upload check uncovered
a Node test-script SDK header omission; explicit same-origin session headers fixed
the script without changing the app.

Computer Use logged into the synthetic owner account and displayed the live
project story, chronological cards, own profile and canonical book at mobile
widths. The real library picker selected two images; fixed composer actions and
photo reordering controls were visible. The browser picker was slow and a later
extension overlay interrupted the viewer-account check; API evidence is distinct
from browser evidence. No claim of physical-camera testing is made.

The visual pass found list cards without covers when only moment photos existed.
The follow-up uses the first authorized image of the latest published moment when
no explicit cover exists, with attachment/access/moderation filters. Fifty-four
focused project/router checks passed. Book controls now share the app palette;
16 book UI cases passed and the canonical renderer is unchanged.

Migration 0055 was applied on isolated `br-frosty-pond-b12edfbz` first. Exact
repository queries and access functions verified user-only/both/mute/pending/
revoked/blocked/project-only/unrelated cases, draft publication and independent
unfollow. This connector could not SET ROLE buildy_web_app; hosted ordinary API
checks above subsequently exercised runtime access. The isolated branch was
removed. Production application used buildy_migrator_app, an advisory transaction
lock and comparison of all 54 prior hashes before DDL+ledger insertion. All 55
hashes match; function owner/ACL/SECURITY DEFINER/search_path stayed unchanged.
Rollback branch `br-calm-hall-b1shoixi` at LSN `0/345BFB8` is READY without compute.
PR #6 merged as `a2b98c5395c95188f66ea99539e551e124e3b85d`. That app revision
is READY in production deployment `dpl_42qe6NWZUEQuCgAYg1GhE3KfeDzj` at
https://buildy-gamma.vercel.app. Ordinary public health returned the exact SHA;
configuration, database and all three workers passed readiness. Product profile
remains `feedback_beta` with beta mode, invitations and checkout disabled.

On this final app revision, dashboard, following and profile project lists each
returned a real automatic cover and its authorized private media read succeeded.
The viewer feed contained exactly the two published updates and no draft.
Both synthetic accounts then requested deletion with a fresh ordinary login and
immediately lost access. Physical background cleanup is not asserted.

Computer Use later became unavailable even after a runtime reset. The additional
book-palette change and final cover fix were checked through focused tests/build
and actual hosted APIs respectively; no final screenshot of those two follow-up
changes is claimed. Mobile camera hardware and offline-native behavior are not
verified. This app implements the requested Buildy social/book core, not full
Polarsteps feature parity (travel tracking/planning and physical orders remain
outside scope).

## Published mobile core — 2026-09-30

Production deployment `dpl_GEzPH8GpDx2MHXYDzjiigjeR9j7L` is READY at
https://buildy-gamma.vercel.app. Ordinary public HTTP returned release
`b0796d01890242ada80f8a0511ea5a1a6a012833`; configuration, database and
account/media/photobook workers passed readiness. The compatible profile label
is `feedback_beta`, with beta mode, invitations and checkout disabled.

Mobile navigation now exposes owned stories, following, adding a moment, the
Bouwboek and profile; the header exposes notifications. Viewer onboarding can
finish without creating a project. Following reuses existing authorized
reactions/comments. Opening a notification marks it read; replacing an active
share link requires an explicit in-app confirmation.

The owner sees a canonical book preview after saving a Bouwmoment. The book
editor puts the preview first and exposes subtitle, photo selection/restoration,
crop controls and per-moment layouts. Preview updates after saving settings;
the PDF uses that same document. Vertical mobile scrolling no longer turns pages.

Short-book backend changes reuse the existing `30cb14a` work. New books omit
blank padding and allow 2–400 pages, including odd counts. Historical document
checksums and locked revisions remain intact. Migration 0054 was applied before
the app release and is compatible with the previous deployed app.

Local evidence: 62 focused backend/migration cases, 48 navigation/composer/social
cases, 26 book UI cases and 6 share-link cases passed. Typecheck, changed-file
lint and app build passed. These checks do not claim hosted behavior.
Computer Use captured mobile references from Polarsteps' book landing and empty
trip form; no personal travel content or reference images are committed.

Before this release the public health returned `4ae7d71c9bb5031ebda47a14284cceffcffc6076`.
READY deployment `dpl_26HwmGVPjKwJYa4GR8egEeveMUqk` remains the app rollback.

Migration 0054 was first applied on isolated `br-red-pine-b1fz1qm2`, then on
production main `br-noisy-king-b14pmt91` using the existing Neon connection and
`buildy_migrator_app`. Each transaction held an advisory lock, checked all 53
prior migration hashes, applied DDL and inserted the ledger entry atomically.
All 54 applied hashes now match local files. Worker grants, finalizer ownership
and locked-revision guards are unchanged. Pre-migration rollback branch
`br-frosty-mode-b1869io9` is retained without compute at LSN `0/34138C0`.
No production credentials or personal records were retrieved.

Staged build `dpl_ARLWvmEv5R5LrhcfKYV2sa7XLX7X` reached READY for `48b10a0`.
Final review then fixed desktop-spread moment selection, with a regression test
that failed before the fix and passed after.

Hosted API evidence on `b0796d0`: two disposable accounts registered with exactly
10-character passwords. A private renovation saved two private Blob photos,
two dated Bouwmomenten and a milestone. Its canonical document had five pages
without blank padding. Subtitle, crop zoom 1.1, one-photo layout and photo
exclusion/restoration persisted after reload. The permitted second account's
following feed contained the Bouwmoment; one comment and two notifications were
confirmed through the ordinary APIs. Marking a notification read persisted its
`readAt`. Re-login with a 10-character password issued a new session and retained
the same project.

The downloaded five-page PDF was 2,195,418 bytes. Its PDF hash and canonical
document hash matched the recorded checksums. All five rendered pages were
visually inspected without clipping.

Separate UI evidence: the Chrome extension connection failed, but native Chrome
completed an actual synthetic-account login and displayed story and book at
390×844. Header, mobile navigation and preview were visible. An initially cropped view
was caused by browser zoom and corrected with Cmd+0; no code fix was needed.
This is not a claim that the entire hosted API journey was repeated through UI.
No credentials, private URLs or screenshots were added to Git.

Revoking the share link denied the follower's project and media reads
(401/403/404) and removed the project from the following feed. Both disposable
accounts requested deletion and immediately lost access. The follower's first
request correctly required a recent login; re-login then allowed
`deletion_pending` and immediate access denial. Physical cleanup is not asserted.
Final main publication was subsequently verified at `6251b1dae86994563f61d83907573cc1384093e4`, deployment `dpl_2exYu6rmLbhATr918srucwTUY4AP`, with public health/readiness/profile checks.

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
schema and stored historical data are preserved. The large cleanup required no
database change.

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

## Final digital-book simplification

Visual inspection exposed a remaining print rule: even a short digital book was
padded to 24 pages. The generator and shared contract now keep only covers and
actual story pages, allowing odd page counts. The physical-print interest button
is removed. Stored format identifiers and historical PDF records remain readable.
Append-only migration 0054 updates the matching PostgreSQL page-count constraint
and finalizer to 2–400 pages; PDF hashes, worker leases and access grants remain.

68 focused book/migration-discovery checks passed in 1.22s, including an actual
five-page PDF render. Typecheck and lint for the changed files passed.

This local work was incorporated and published by the later mobile-core release
recorded above.

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
