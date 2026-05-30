# Buildy — Copilot Agent Instructions

## Project
Buildy is the "Polarsteps for renovations" — a social platform where homeowners document their renovation projects step by step. Key analogies:

| Polarsteps concept | Buildy equivalent |
|---|---|
| Trip | Project (verbouwing) |
| Step | Update/post |
| Travel Book | Bouwboek (fysiek fotoboek via Peecho) |
| Followers | Followers |

## Stack
- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend:** Supabase (PostgreSQL + Auth + Storage + Edge Functions)
- **Print:** Peecho print-on-demand (via `peechoExport.ts` + Peecho JS widget)
- **Maps:** Leaflet (react-leaflet)
- **State:** TanStack Query v5

## Naming conventions
- Components: PascalCase, files in `src/components/`
- Pages: PascalCase, files in `src/pages/`
- Hooks: camelCase prefixed with `use`, files in `src/hooks/`
- DB table names: snake_case (matching Supabase)
- "Trip" in code maps to "project" in the UI
- "Step" maps to "update" in the UI

## Key files
- `src/pages/Photobook.tsx` — Bouwboek editor + Peecho ordering
- `src/lib/peechoExport.ts` — PDF generation (jsPDF) for Peecho specs
- `src/pages/TripDetail.tsx` — Main project page with timeline
- `src/integrations/supabase/client.ts` — Supabase client

## Peecho integration model
1. User edits their Bouwboek in Photobook.tsx
2. Clicking "Bestel als boek" triggers PDF generation via `buildPeechoPdf()`
3. PDF is uploaded to Supabase public storage (`trip-media` bucket)
4. Peecho's Print Button JS widget is rendered with `data-src` = public PDF URL
5. User clicks the Peecho button → Peecho checkout handles payment + print + shipping
6. NO PDF download button exposed to users — ordering is direct through Peecho

## Environment variables
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_PEECHO_SCRIPT_URL=...  # Peecho account-specific JS URL
```

## Code style
- Dutch UI strings (nl-NL)
- English code (variable names, comments)
- `toast.error()` for user-facing errors, `console.error()` for dev
- No `any` types unless absolutely necessary (Supabase responses accepted)
- Prefer early returns over nested if-blocks

## Auth
- Supabase Auth with email/password + magic links
- `useAuth()` hook in `src/hooks/useAuth.tsx`
- Protected routes must check `user` from `useAuth()` and redirect to `/auth`

## Database (Supabase)
Main tables:
- `profiles` — user profiles (user_id, display_name, avatar_url, is_pro, is_private)
- `trips` — projects (id, user_id, title, project_type, progress_percentage, is_public)
- `steps` — updates (id, trip_id, user_id, step_date, location_name, phase, description)
- `step_media` — photos/videos per step
- `photobook_settings` — per-trip photobook config
- `photobook_excluded_media`, `photobook_excluded_steps` — exclusion lists
- `step_budget` — cost tracking per step

## Testing
- Playwright for E2E tests in `tests/`
- Vitest for unit tests in `src/test/`
- Run: `bun test` (Vitest), `bunx playwright test` (E2E)
