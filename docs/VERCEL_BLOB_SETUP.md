# Vercel Blob setup

## Doel

Gebruik private Vercel Blob voor Buildy-media, avatars, exports en Bouwboekproofs.

## Minimale env var

- `BLOB_READ_WRITE_TOKEN`

## Vereisten

- private store
- server-gecontroleerde uploadautorisatie
- geen permanente publieke media-URL's
- iedere private read via Buildy-autorisatie
- delete of directe ontoegankelijkheid bij account- of projectverwijdering
- exacte private Blob-host/path, bytegrootte en SHA-256 controleren
- geen Cloudflare R2/AWS S3 runtime of providerfallback
- media-completion verwerkt direct alleen het exacte asset onder de
  mediaworkerrol; begrensde owner-polling kan dezelfde leased/idempotente claim
  hervatten
- Bouwboekproofrequests verwerken op dezelfde manier exact één revisie onder
  de photobookworkerrol
- media en Bouwboek vereisen hun worker-DB-URL plus Blob, niet `CRON_SECRET`;
  er zijn geen bijbehorende cronroutes of Vercel schedules

## Verificatie

- synthetische upload, exact-asset processing en begrensde owner-retry slagen
- anonieme read faalt
- owner-read slaagt via Buildy-route
- visibilitywijziging, unfollow of block trekt media-toegang direct in
- delete maakt media direct onbereikbaar

Bewijs daarnaast corrupte/mismatched bytes, retry/leaseverlies,
wrong-store/path, exact-revision proofprocessing, proof-/exportread en cleanup
op Preview. Een echte providerroundtrip is in de huidige release niet bewezen;
Browser MCP was door de huidige Codex-gebruikslimiet geblokkeerd en productie
blijft **NO-GO**.
