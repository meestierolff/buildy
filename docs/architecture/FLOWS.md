# Core flows

Use the node IDs in [GRAPH](GRAPH.md). Actual deployment evidence belongs in
[STATE](STATE.md), not in this behavior description.

| Flow / nodes | Observable result | Boundary |
| --- | --- | --- |
| F1 / U,H,A,D | Register with username/password (minimum 10 characters), reload, log out and sign in to the same account. | No email, OAuth or invitations. An email entered as username offers an explicit username suggestion. Reject incorrect passwords, repeated abuse and cross-origin mutations. No promised password recovery. |
| F2 / U,H,A,P,M,D | Create a private renovation; set cover, visibility and planned dates; save/edit photo/date/text and owner-only notes/costs/hours. Set budget and remove custom phases. After saving, the owner sees the growing canonical Bouwboek preview. | Owner-only writes and private supplements; authorized private media. Retry preserves text without duplicate moments. Automatic progress reflects dates; phase removal retains moments. |
| F3 / U,H,A,S,P,M,D | Share a read-only link, open the story and revoke it. | Revoked links stop authorizing API and media reads; already downloaded bytes cannot be recalled. |
| F4 / U,H,A,S,E,D | A permitted signed-in viewer follows a project or a user and adds emoji reactions/comments from the story or Tijdlijn; content survives reload. Accepted user follows include accessible updates across that user’s projects, deduplicated with explicit project follows. Mobile navigation exposes Projecten, Tijdlijn, adding, Boeken and Profiel; the header exposes builder search and unread notifications. Opening an unread notification marks it read. Onboarding also supports viewers without an owned project. | Project following grants no access or edits. User follows use existing approval/privacy rules. Private/unlisted projects are excluded from profile lists. Blocking/removal/revocation still applies; explicit project mute suppresses publication notifications from both follow paths. |
| F5 / U,H,A,B,O,P,M,D | One chronological document drives live previews, saved settings and the frozen manual book request. Page turns select the corresponding editing controls; mobile editing keeps a compact preview visible. Customers request books; admins alone generate/download the requested version as PDF. | Date/order/id controls chronology; 2–400 actual pages without print padding. Known customer PDF/proof routes deny access. Requests are retry-safe, contact details are encrypted, and historical locked revisions remain immutable. No payment or automatic printer dispatch; print compatibility and price require manual confirmation. |
| F6 / U,H,A,L,D | Profile avatar and feedback persist; logout revokes the session; account export/deletion includes private budget and book-request records. | Immediate access revocation is distinct from physical cleanup. Never delete unrelated accounts/data. |
| F7 / all | Publish the core app and confirm its public commit and availability. | Preserve the previous deployment for rollback. No CI or slow-suite prerequisites; do not claim hosted behavior from mocks alone. |

## Code entry points

[Auth](../../server/auth) · [Projects](../../server/projects) ·
[Media](../../server/media) · [Sharing](../../server/projectShares) ·
[Engagement](../../server/engagement) · [Bouwboek](../../server/photobooks) ·
[Accounts](../../server/account) · [Manual commands](../../package.json)

Project following uses idempotent PUT/DELETE `/api/projects/:projectId/follow`.
The overview returns `viewerFollowStatus`; `/api/following` combines explicit
project subscriptions and accepted user follows, always filtered by current
access. Activity includes the owner’s profile identity and its follow source.
`GET /api/social/profiles/:profileId/projects` lists only public/followers projects
visible to the viewer; its cursor is scoped to that profile. Voluntary user
unfollow preserves independent project subscriptions; owner removal/blocking
still revokes them. First-publication notifications deduplicate both paths.

`/` opens their project overview for signed-in users; `/projecten` manages their
projects and `/volgend` opens the followed timeline.
`/profiel` shows their profile, `/account` edits settings, and `/bouwboeken`
opens a shelf of their project-based automatic books. Camera/library inputs,
photo ordering and milestone editing reuse the existing private upload flow.
Project settings are collapsible; the chronological story keeps photo lightbox,
before/after, document links and deep links to individual Bouwmomenten.

## Feedback contracts — 2026-10-03

- Own projects are the first mobile/desktop destination and the authenticated home.
  The followed timeline comes second. Media swipes close vertically and change photos
  horizontally; short/diagonal/multi-touch gestures do not dismiss content.
- `PATCH /api/projects/:projectId` accepts `plannedBudgetMinor`. Owner-only project
  overview returns `budget`; moment create/edit accepts `privateDetails` (notes,
  cost in cents, own/contractor minutes). Public and followed projections omit it.
- `DELETE /api/projects/:projectId/phases/:phaseId` requires the project version and
  idempotency key. Only custom phases can be deleted; moments are detached atomically.
- `POST /api/projects/:projectId/photobook/preview` generates an unsaved preview.
  `/photobook/orders` GET/POST lists/submits owner requests. `/api/admin/book-orders`
  lists the admin queue, `/:orderId` PATCH updates status/reply, and `/:orderId/pdf`
  POST renders the frozen canonical document. The admin UI is `/admin/boeken`.
  Old customer proof/PDF endpoints deny
  access. Customer exports retain original personal content but omit generated PDFs.
- New requests collect delivery/contact details only for fulfilment, encrypted with
  the existing keyring. No email is added to signup. Account deletion immediately
  denies access once allowed; accepted/printing requests first block account/project
  deletion. Unaccepted requests are cancelled, and existing project cleanup removes
  request records.

## Proportionate verification

Use one focused check for the changed behavior and the deployable build.
Existing fast unit checks are optional tools, not release gates. CI, browser
matrices, coverage and PostgreSQL integration suites were explicitly removed.
Do not repeat unaffected hosted journeys or create new audit/report frameworks.

When checking persistence/access, use actual hosted APIs/storage with dedicated
synthetic accounts; distinguish this from mocked unit evidence. Record flow,
result, source SHA, environment and action in STATE. Keep credentials, session
cookies and private content out of logs and reports. Computer Use is authorized;
the owner performs personal login/MFA or secret entry that cannot remain private.
