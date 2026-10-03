# Buildy architecture

**Maak van je verbouwing een verhaal om te bewaren.**
Scope: account → private renovation → photo/date/text Bouwmoment → chronological
story → sharing and user/project following → reactions/comments → Bouwboek preview
→ manual book request → admin PDF. Owner-only budget, notes and work hours support
the renovation story.
[STATE](STATE.md) records deployments; [FLOWS](FLOWS.md) records behavior.

There is one account app. The 2026-10-03 feedback request reintroduces owner-only
budget and manual physical-book requests. Floorplans, broad discovery, invitations,
OAuth, demo profiles and automated checkout remain removed. Historical tables and
applied migrations stay intact; account export/deletion covers new records too.

```mermaid
flowchart LR
  U[React UI] --> H[Same-origin API]
  H --> A[Password sessions and access]
  H --> P[Renovations and Bouwmomenten]
  H --> S[Sharing and user/project following]
  H --> E[Reactions and comments]
  H --> B[Canonical Bouwboek and admin PDF]
  H --> O[Manual book requests]
  H --> L[Account, support and moderation]
  H --> M[Private media]
  A --> D[Neon with RLS]
  P --> D
  S --> D
  E --> D
  B --> D
  O --> D
  O --> B
  L --> D
  M --> D
  M --> V[Private Vercel Blob]
  B --> V
  L --> V
  U -. scoped upload authorization .-> V
```

| Node | Existing code |
| --- | --- |
| U | [App](../../src/App.tsx), [API clients](../../src/lib) |
| H | [Vercel entry](../../api/router.ts), [router](../../server/http/router.ts), [contracts](../../shared/contracts) |
| C | [Composition](../../server/composition.ts), [core configuration](../../server/config/runtime.ts) |
| A | [Password auth](../../server/auth), [actor resolution](../../server/projects/actor.ts) |
| P | [Projects](../../server/projects), [Bouwmoment UI](../../src/components/AddStepDialog.tsx) |
| S | [Share links](../../server/projectShares), [project repository](../../server/projects/repository.ts), [user following](../../server/social) |
| E | [Engagement](../../server/engagement) |
| B | [Book UI](../../src/pages/Photobook.tsx), [canonical document](../../server/photobooks/document.ts), [PDF renderer](../../server/photobooks/pdfRenderer.ts) |
| O | [Book requests](../../server/bookOrders), [admin UI](../../src/pages/BookOrdersAdmin.tsx) |
| M | [Media](../../server/media), [Blob adapter](../../server/storage/vercelBlobObjectStorage.ts) |
| L | [Accounts](../../server/account), [moderation/support](../../server/moderation), [feedback](../../server/feedbackAdmin) |
| D | [Schema](../../db/schema), [append-only migrations](../../db/migrations) |

## Boundaries

- UI → typed API → server-resolved identity/access → service/repository → data.
- Project following subscribes to one project and grants no access. Accepted
  user follows also feed accessible projects into the timeline and retain their
  existing followers-only visibility role. The two paths deduplicate; voluntary
  user-unfollow preserves independently selected projects while access remains
  valid. Owner removal, blocking and revocation apply to all content/media reads.
- Profile project lists use server-filtered public/followers projects; private
  projects and unlisted-link projects never become profile discovery results.
- Passwords use scrypt; sessions use hashed server tokens and HttpOnly cookies.
  Mutations retain origin checks, rate limits and retry-safe persistence.
- Browser uploads require scoped server authorization. Project covers and profile
  avatars reuse private media processing; avatars are scoped to the account.
  No public Blob URLs or database credentials in the browser.
- Private notes, costs and own/contractor minutes reuse forced-RLS budget records.
  They never appear in shared stories or book documents. Date progress is calculated
  server-side using the Amsterdam calendar; deleting a custom phase detaches moments.
- One globally chronological document controls preview, page count and PDF.
  Books contain actual content and covers, without print minimum/even padding.
  Book requests freeze that document; only admins render/download its PDF. Physical
  format, bleed, price and delivery are confirmed manually before print dispatch.
  Request-driven media workers retain their separate restricted database role.
- Accepted/printing book requests block account/project deletion until resolved.
  Once deletion is allowed, access revokes immediately; bounded cleanup and export
  retain their existing data handling. No schema reset or encryption-key rotation.
- `/api/product-profile` retains compatible response fields for existing clients;
  it always describes the account app with checkout and invitations disabled.
- No CI or automated test matrix. Vercel runs the app build; focused manual
  checks are available when useful. Do not recreate release gates.
