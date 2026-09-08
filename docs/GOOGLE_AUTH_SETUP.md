# Google auth setup

**Historisch — niet configureren.** De eigenaar heeft op 8 september 2026 de
vervanging door gebruikersnaam/wachtwoord geautoriseerd. Onderstaande OAuth-
instructies beschrijven de eerdere implementatie en zijn geen actief
releasecontract of blocker. Zie [FLOWS](architecture/FLOWS.md) en
[STATE](architecture/STATE.md) voor de huidige accountreis en bewijsstatus.

## Doel

Buildy gebruikt Google OpenID Connect Authorization Code met PKCE, state en
nonce als enige MVP-loginmethode. Buildy maakt daarna een opaque server-owned
sessie; alleen de tokenhash staat in Neon.

## Minimale env vars

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `APP_ORIGIN`
- `PRIMARY_DOMAIN` voor productie

## Vereiste redirect-URI's

- local: exacte lokale callback-URI
- Preview/staging: exacte stabiele HTTPS callback-URI; geen wildcard of
  willekeurige branch-URL
- production: exacte productiecallback-URI

## Vereiste scopes

- `openid`
- `profile`
- `email`

## Verificatie

- Google issuer, verified e-mail en identity mapping kloppen
- invite-only nieuwe user en bestaande user werken op Preview
- veilige `next`, state/nonce/PKCE en callbackfouten falen gesloten
- logout en session revoke trekken de juiste sessie in
- accountverwijdering trekt alle server-owned sessies in
- logs/artifacts bevatten geen code, token, cookie, subject of ruwe claims

## Niet doen

- geen e-maillogin
- geen wachtwoorden
- geen magic links
- geen extra Google scopes
- geen `SESSION_SECRET`; high-entropy opaque tokens worden gehasht opgeslagen

Een echte Preview-providerjourney is op de huidige release niet bewezen. De
verplichte Browser MCP-runtime was door de huidige Codex-gebruikslimiet
geblokkeerd; auth en productie blijven **NO-GO**.
