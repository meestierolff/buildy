# Google auth setup

## Doel

Buildy gebruikt Google OpenID Connect als enige MVP-loginmethode.

## Minimale env vars

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `APP_ORIGIN`
- `PRIMARY_DOMAIN` voor productie

## Vereiste redirect-URI's

- local: exacte lokale callback-URI
- Preview: exacte Vercel Preview callback-URI
- production: exacte productiecallback-URI

## Vereiste scopes

- `openid`
- `profile`
- `email`

## Verificatie

- login werkt op local of Preview
- logout trekt de sessie in
- accountverwijdering trekt alle sessies in
- logs bevatten geen code, token of ruwe claims

## Niet doen

- geen e-maillogin
- geen wachtwoorden
- geen magic links
- geen extra Google scopes
