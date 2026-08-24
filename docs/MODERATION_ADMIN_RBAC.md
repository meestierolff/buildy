# Moderatiebeheer en RBAC

Buildy bepaalt moderator/admin uitsluitend server-side. `/beheer/moderatie`,
`/beheer/bestellingen` en `/beheer/feedback` geven pas data nadat de Google OIDC/server-session,
app-user mapping en een actieve, niet verlopen databasegrant zijn geverifieerd.
Headers, requestvelden, clientstate en profieldata kunnen geen rol verlenen.

## Rollen beheren

Alleen de migration-ownerverbinding mag grants muteren. Gebruik nooit web- of
workercredentials en zet geen database-URL in een commandargument of log.

```sh
DATABASE_MIGRATION_URL='<veilig geladen URL>' bun run moderation:role -- grant \
  --operation-id <uuid> \
  --app-user-id <app-user-uuid> \
  --role admin \
  --operator-ref ticket:SEC-123 \
  --reason-code access_approved \
  --confirm GRANT:<operation-id> \
  --execute
```

Gebruik `moderator` voor alleen de kleinere moderatieset; orderbeheer vereist
`admin`; feedback-/supportdetail met vrije tekst en contact-PII vereist eveneens
exact `admin`. Intrekken gebruikt `revoke`, `--grant-id` en
`--confirm REVOKE:<operation-id>`. Een exact gelijke operation-ID replay is
idempotent; afwijkende inhoud faalt. De laatste actieve admin kan niet worden
ingetrokken.

Audit bevat alleen rol, pseudonieme UUID's, gecontroleerde operatorreferentie/
reasoncode en timestamps; geen naam, e-mail, database-URL of vrije PII.

## Moderatie

Queueitems bevatten geen contact/vrije tekst. Alleen geautoriseerd detail
ontsleutelt melding en targetsnapshot. Acties vereisen reason,
idempotencykey en expected version. `suspend`/`block` zijn admin-only;
`restore` keert exact één geschikte eerdere actie terug.

Hide geldt ook voor eigenaar/volgers. Suspend trekt server-owned sessies in en
blokkeert de identity mapping voor writes. Support/appeal blijft publiek.

## Orders

Alleen admin kan betaalde orderqueue/detail, customer/shippingdecryptie, private
exact-PDF-download en handmatige fulfilmentacties gebruiken. Iedere mutatie is
versioned/idempotent/auditbaar. Een moderatorgrant geeft geen ordertoegang.

## Feedback en support

Alleen admin kan de metadatawachtrij en het ontsleutelde detail openen. De
queue bevat geen vrije tekst, contact, route, actor-ID, ciphertext of hashes.
Statusovergangen zijn versioned/idempotent en hun append-only auditmetadata
bevat alleen gecontroleerde statussen, rol, versie en technische UUID's. Een
moderatorgrant geeft geen feedback-/supporttoegang.

## Verificatie

Bewijs vóór release ordinary-user denial, moderator/adminscheiding,
expired/revoked grants, laatste-adminbescherming, queue/detail PII-grens, iedere
moderatieactie/sessionrevocation en iedere orderactie/PDF-hash. Gebruik een
tijdelijke PostgreSQL-database en daarna synthetic Previewfixtures.

De lokale geautomatiseerde grens is geen interactieve of Previewclaim. Browser
MCP was door de huidige Codex-gebruikslimiet geblokkeerd; admin role journeys en
productie blijven **NO-GO**.
