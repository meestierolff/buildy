---
applyTo: "**"
---
# Buildy — GitHub Copilot Instructions

## App context
Buildy = "Polarsteps for renovations". Users document home renovations with photos, steps and phases. End product: a physical hardcover Bouwboek ordered via Peecho.

## Peecho ordering rules
- NEVER add a "Download PDF" button — all ordering goes through Peecho directly
- After PDF generation + Supabase upload, render the Peecho Print Button JS widget
- `data-src` = public Supabase storage URL of the generated PDF
- `data-locale="nl_NL"`, `data-currency="EUR"`

## UI language
- All user-facing strings in Dutch (nl-NL)
- Error messages: Dutch and friendly
- Code comments: English

## Do not modify
- `supabase/migrations/` — never edit existing migration files
- Supabase client configuration in `src/integrations/supabase/`

## Patterns to follow
- Use `toast.success()` / `toast.error()` from sonner for user feedback
- Use `useAuth()` for auth state, never access `supabase.auth` directly in components
- Fetch data in `useEffect` with `async` + `await`, set state after all fetches complete
- shadcn/ui components only (no external UI lib additions)

## Renovatie phases (canonical order)
Aankoop → Voorbereiding/Design → Sloop → Ruwbouw → Installatie → Afbouw → Afwerking → Inrichting → Oplevering
