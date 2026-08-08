# Buildy — agent instructions

## Product

Buildy is een privacy-first sociaal verbouwingsdagboek. In code zijn historische
`trip`/`step` namen alleen nog compatibiliteitsnamen; nieuwe domeincode en UI
gebruiken `project` en `update`. Nederlandse gebruikerscopy, Engelse
variabelen/comments.

## Doelstack

- React 18 + TypeScript + Vite + Tailwind/shadcn;
- typed same-origin Vercel Functions API;
- Neon PostgreSQL + Drizzle;
- Better Auth met authoritative HttpOnly cookies;
- private Cloudflare R2;
- Brevo transactionele e-mail;
- Stripe Checkout en raw-signature webhooks;
- Peecho REST v3 via een durable fulfilmentworker;
- TanStack Query v5 en Wouter-compatibiliteitsrouter.

Voeg geen browserdatabaseclient, publieke objectbucket, permanente signed URL,
directe providerwrite vanuit React of afgeschafte prototypeprovider toe.

## Grenzen

- Browsercode gebruikt uitsluitend clients in `src/lib/*Api.ts`.
- Autorisatie gebeurt altijd opnieuw in de server/repository; clientrollen zijn
  geen bewijs.
- Database-, e-mail-, media-, account-, payment-, photobook- en fulfilmentworkers
  hebben ieder een afzonderlijke login en alleen begrensde function-execute.
- Gebruik outbox/inbox, lease, idempotency en monotone transitions voor externe
  side effects.
- PII nooit in logs, eventmetadata, idempotencykeys, URLs of artifacts. Gebruik
  envelope-encryptie, vaste AAD en blind indexes waar het datamodel dat vereist.
- Provideraccount en environment worden server-side gecontroleerd.
- Checkout blijft uit tenzij `CHECKOUT_ENABLED=true`; dat is een expliciet
  launchbesluit, niet het gevolg van aanwezige secrets.
- Verzin geen juridische identiteit, prijs, btw, retentie, provider-ID of
  succesvolle externe test.

## Codeconventies

- Componenten/pages PascalCase; hooks `use*`; databasevelden snake_case.
- Geen `any` zonder aantoonbare noodzaak; valideer externe input met Zod.
- Early returns boven diepe nesting.
- `toast.error()` voor gebruikersfouten en PII-veilige structured serverlogs.
- Gepubliceerde SQL-migrations zijn append-only en worden niet herschreven.
- Gebruik `apply_patch` voor handmatige file-edits en behoud niet-gerelateerde
  wijzigingen in een dirty worktree.

## Verificatie

```sh
bun run typecheck
bun run lint
bun run test
bun run build
node --import tsx db/migrate.ts --check
bun run test:e2e:preview
bun run check:launch -- --static
```

Gebruik `bun run test`, niet het kale `bun test`. Echte PostgreSQL-
integratietests, providerprobes en browserflows mogen nooit stil skippen wanneer
zij als launchbewijs worden aangevoerd. Zie `docs/LAUNCH_READINESS.md` voor het
verschil tussen codebewijs en externe gates.
