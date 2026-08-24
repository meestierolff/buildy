# Moderatiebeheer en RBAC

> **ARCHIEF — GEEN ACTIEVE AUTH-INSTRUCTIE.** Deze versie gebruikt Better Auth.
> Gebruik de actuele [`MODERATION_ADMIN_RBAC.md`](../../MODERATION_ADMIN_RBAC.md)
> voor Google OIDC en server-owned sessions.

Buildy bepaalt moderator- en adminrechten uitsluitend op de server. De route
`/beheer/moderatie` toont geen beheerdata voordat Better Auth-subject, gekoppelde
app-gebruiker en een actieve, niet verlopen roltoekenning alle drie zijn
geverifieerd. Headers, requestvelden en clientstate kunnen geen rol verlenen.

## Rollen beheren

Rolwijzigingen mogen alleen met de migration-ownerverbinding worden uitgevoerd.
Gebruik nooit de web- of workerverbinding en zet geen database-URL op de
commandoregel.

```bash
DATABASE_MIGRATION_URL=... bun run moderation:role -- grant \
  --operation-id <uuid> \
  --app-user-id <app-user-uuid> \
  --role moderator \
  --operator-ref ticket:SEC-123 \
  --reason-code access_approved \
  --confirm GRANT:<uuid> \
  --execute
```

Intrekken gebruikt dezelfde verplichte bevestiging met `revoke`, `--grant-id`
en `--confirm REVOKE:<operation-id>`. Herhalen met dezelfde operation-ID en
dezelfde invoer is idempotent; afwijkende invoer faalt. De CLI logt geen
database-URL, persoonsdata of vrije reden. PostgreSQL bewaart een append-only
audit-event met alleen de rol, pseudonieme UUID's en gecontroleerde referentie-
en redencodes. De laatste actieve admin kan niet worden ingetrokken.

## Beheeracties

De wachtrij is cursor-gebaseerd en bevat geen contactgegevens of vrije tekst.
Gevoelige melddetails en targetsnapshots worden alleen op de geautoriseerde
detailroute ontsleuteld. Acties vereisen een reden, idempotentiesleutel en de
verwachte rapportversie. `suspend` en `block` zijn admin-only. `restore` keert
exact één nog niet teruggedraaide `hide`, `suspend` of `block` terug.

Verborgen profielen, projecten, updates, media en reacties verdwijnen ook voor
eigenaren en bestaande privétoegang. Een schorsing verwijdert alle Better
Auth-sessies en maakt de auth-subjectkoppeling onbruikbaar voor applicatiewrites.
De publieke support- en bezwaarroute blijft beschikbaar.

## Controle

Voer vóór uitrol minimaal uit:

```bash
node --import tsx db/migrate.ts --check
bun run typecheck
bunx vitest run tests/db/moderation-admin-migration.test.ts \
  tests/server/moderation-admin.test.ts \
  tests/server/moderation-http.test.ts \
  src/test/moderationApi.test.ts \
  src/test/moderationAdmin.test.tsx
```

De conditionele PostgreSQL-test
`tests/db/moderation-admin.integration.test.ts` vereist uitsluitend een lokale,
tijdelijke database via `DATABASE_SECURITY_TEST_URL` en
`DATABASE_SECURITY_WEB_ROLE`. Hij controleert RLS-lekken, herstel, replay,
sessieverwijdering en PII-vrije auditmetadata.
