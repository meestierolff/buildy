# Vercel Blob setup

## Doel

Gebruik private Vercel Blob voor Buildy-media in de feedbackbèta.

## Minimale env var

- `BLOB_READ_WRITE_TOKEN`

## Vereisten

- private store
- server-gecontroleerde uploadautorisatie
- geen permanente publieke media-URL's
- iedere private read via Buildy-autorisatie
- delete of directe ontoegankelijkheid bij account- of projectverwijdering

## Verificatie

- synthetische upload slaagt
- anonieme read faalt
- owner-read slaagt via Buildy-route
- revoked viewer-link verliest media-toegang
- delete maakt media direct onbereikbaar
