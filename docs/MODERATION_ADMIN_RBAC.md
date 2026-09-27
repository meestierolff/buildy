# Moderatiebeheer en RBAC

Buildy bepaalt `moderator` en `admin` uitsluitend server-side. Voor
`/beheer/moderatie` en `/beheer/feedback` controleert de server de actieve
wachtwoordsessie, app-userkoppeling en geldige databasegrant. Headers,
requestvelden, clientstate en profieldata kunnen geen rol verlenen.

## Rollen beheren

Alleen de migration-ownerverbinding mag grants muteren. Laad
`DATABASE_MIGRATION_URL` via veilige lokale configuratie; zet de waarde niet in
commandoregels, shellhistory of logs. Gebruik geen web- of workercredentials.
De bestaande [beheer-CLI](../scripts/moderation/manage-role.ts) gebruikt expliciete
operation-ID's en bevestiging:

```sh
bun run moderation:role -- grant \
  --operation-id <uuid> \
  --app-user-id <app-user-uuid> \
  --role admin \
  --operator-ref ticket:SEC-123 \
  --reason-code access_approved \
  --confirm GRANT:<operation-id> \
  --execute
```

Gebruik `moderator` voor de kleinere moderatieset. Feedback-/supportdetail met
vrije tekst en contact-PII vereist exact `admin`. Grants kunnen een begin- en
eindtijd hebben. Intrekken gebruikt `revoke`, `--grant-id` en
`--confirm REVOKE:<operation-id>`. Een gelijke operation-ID met gelijke inhoud
is idempotent; andere inhoud faalt. De laatste actieve admin kan niet worden
ingetrokken.

Audit bevat rol, pseudonieme UUID's, gecontroleerde operatorreferentie/reasoncode
en timestamps, geen naam, e-mail, database-URL of vrije tekst met PII.

## Moderatie

Queueitems bevatten geen contact of vrije meldingstekst. Alleen geautoriseerd
detail ontsleutelt melding en targetsnapshot. Acties vereisen reden,
idempotencykey en verwachte versie. `suspend`/`block` zijn admin-only;
`restore` keert exact één geschikte eerdere actie terug.

Hide geldt ook voor eigenaar en volgers. Suspend trekt server-owned sessies in
en blokkeert writes. Support en bezwaar blijven publiek bereikbaar.

## Feedback en support

Alleen admin kan de metadatawachtrij en het ontsleutelde detail openen. De queue
bevat geen vrije tekst, contact, route, actor-ID, ciphertext of hashes.
Statusovergangen zijn geversioneerd, idempotent en append-only auditbaar met
gecontroleerde statussen, rol, versie en technische UUID's. Een moderatorgrant
geeft geen feedback-/supporttoegang.

Zie [MODERATION_SUPPORT_FEEDBACK](MODERATION_SUPPORT_FEEDBACK.md) voor routes en
privacygrenzen en [STATE](architecture/STATE.md) voor bestaand runtimebewijs.
