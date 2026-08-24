# Launch readiness

> **SUPERSEDED.** Dit is de checkout-off snapshot van 14 augustus 2026. Gebruik
> de actuele [`LAUNCH_READINESS.md`](../../LAUNCH_READINESS.md).

Peildatum: 14 augustus 2026
Besluit: NO-GO voor publieke feedbackbèta en productie.

De lokale repository- en databasegates zijn groen, maar Preview, Google OIDC,
Vercel Blob en operatorbewijs ontbreken nog.

## Groene lokale gates

- `bun run typecheck`
- `bun run lint`
- `bun run test` met de CI-unitomgeving
- `bun run build`
- `bun run check:bundle`
- `bun run test:e2e`
- `bun run check:launch -- --static`
- volledige lokale PostgreSQL migration/RLS-replay op een tijdelijke database

## Open releasegates

- Google OIDC is nog niet op Preview of productie bewezen.
- Private Vercel Blob-upload en private media-read zijn nog niet op Preview bewezen.
- De Previewdeployment zelf is nog niet aangemaakt en gevalideerd.
- De production targetdatabase, backup/recovery point en rollout zijn nog niet bevestigd.
- Privacy-, terms-, support- en account-delete-operatorbewijs ontbreken nog.

## Feedback-beta GO-criteria

Een publieke feedbackbèta kan pas naar GO wanneer:

- de kernflow op Preview end-to-end is bewezen
- Google-only sign-in werkt
- media privé wordt opgeslagen en privé blijft
- het eerste bouwmoment na reload blijft bestaan
- deel-links read-only zijn en herroepbaar werken
- feedback en accountverwijdering werken
- `CHECKOUT_MODE=off` bevestigd is
- privacy en terms alleen echte providers noemen

## Productie

Productie blijft NO-GO totdat alle Preview-gates groen zijn en de operatorstappen
uit [de actuele productieprocedure](../../PRODUCTION_RELEASE.md) aantoonbaar zijn uitgevoerd.
