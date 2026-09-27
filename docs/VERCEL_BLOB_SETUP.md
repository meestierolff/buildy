# Private Vercel Blob

Buildy bewaart media, avatars, exports en digitale Bouwboeken in een private
Blob-store. De browser uploadt alleen na server-issued, beperkte autorisatie;
reads lopen via Buildy en de actuele toegangscontrole.

## Configuratie en verwerking

Gebruik `BLOB_READ_WRITE_TOKEN` uitsluitend server-side voor de bedoelde private
store. De runtime gebruikt daarnaast de beperkte databaseverbindingen
`DATABASE_MEDIA_WORKER_URL`, `DATABASE_PHOTOBOOK_WORKER_URL` en voor
export/cleanup `DATABASE_ACCOUNT_WORKER_URL`. Zie [.env.example](../.env.example)
voor de volledige huidige configuratie zonder werkelijke secrets.

Media-completion verwerkt alleen het exacte asset onder de mediaworkerrol.
Bouwboekrequests verwerken alleen de exacte revisie onder de photobookworkerrol.
Begrensde owner-polling kan dezelfde geleasede, idempotente verwerking hervatten.
Beide kernflows zijn request-driven; ze hebben geen cron of afhankelijkheid van
`CRON_SECRET`. De account-lifecyclecron doet export, verwijdering en begrensd
orphan-mediaonderhoud, beschreven in [ACCOUNT_LIFECYCLE](ACCOUNT_LIFECYCLE.md).

## Grenzen bij gebruik en onderzoek

Controleer exact provider/store, objecthost/path, bytegrootte en SHA-256. Een
uploadcallback of object-URL is geen bewijs van eigenaarschap of leesrecht.
Publiceer geen permanente media-URL en log geen token, objectkey of privébeeld.

Autoriseer iedere read opnieuw volgens projectvisibility, linkstatus, blokkades,
moderatie en lifecycle. Een privéasset blijft onbereikbaar voor een actor zonder
leesrecht. Deellinkintrekking, verlies van een benodigde profielconnectie,
blokkeren en verwijdering werken door naar mediareads. Een project ontvolgen
beëindigt de subscription; het trekt op zichzelf geen apart leesrecht in.

Gebruik voor een gerichte operationele controle eigen synthetische content:
verifieer upload/verwerking, geautoriseerde read en de relevante weigering.
Bij checksum-, store- of leasefouten blijft het asset onbruikbaar tot de bestaande
retryflow slaagt. Een delete geldt pas als fysieke cleanup na bevestigde
Blob-afwezigheid. Bekend hosted bewijs staat in [STATE](architecture/STATE.md).
