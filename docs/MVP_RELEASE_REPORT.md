# MVP release report

Peildatum: 14 augustus 2026

## Lokale status

- branch: `codex/buildy-simple-mvp`
- repo-instructies omgezet naar feedbackbèta
- CI-portabiliteitsfout rond `rg` in de unit-workflow hersteld
- 9 append-only migrations toegevoegd om lifecycle-, auth/e-mail-, moderation- en RLS-regressies te repareren
- lokale kern-gates groen: typecheck, lint, unit, build, bundle, public Playwright, statische launchcheck
- volledige lokale PostgreSQL migration/RLS-workflow groen op tijdelijke database

## Nog niet afgerond

- Previewdeployment niet aangemaakt in deze sessie
- productie niet gedeployed
- Google OIDC niet bewezen tegen echte providerconfiguratie
- Vercel Blob niet bewezen tegen echte providerconfiguratie
- actieve runtime bevat nog historische code buiten de founder-targetrichting

## Besluit

- local dogfood: GO voor de huidige lokale kwaliteitsgates
- Vercel Preview: NO-GO totdat environment en Previewflow zijn bewezen
- publieke feedbackbèta: NO-GO
- Stripe test: Later
- Stripe live: NO-GO
- manual Peecho fulfilment: Later
- Peecho API: niet geïmplementeerd voor de feedbackbèta
