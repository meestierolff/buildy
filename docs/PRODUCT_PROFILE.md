# Server-owned productprofiel

Het accountgebaseerde Buildy-releaseprofiel is `PRODUCT_PROFILE=feedback_beta`,
met `BETA_MODE=false` en `CHECKOUT_MODE=off` voor de gratis MVP. Die naam
schakelt geen oude “simple app” in; zij groepeert de bestaande corecapabilities.
`public_demo` blijft een veilige rollbackoptie en bewijst geen werkende
accountgebaseerde MVP. De actuele scope en bewijsstatus staan in
[GRAPH](architecture/GRAPH.md) en [STATE](architecture/STATE.md).

## Publiek contract

`GET /api/product-profile` retourneert de serverwaarheid:

```json
{
  "profile": "feedback_beta",
  "checkoutMode": "off",
  "betaMode": false,
  "inviteRequiredForNewAccounts": false,
  "capabilities": {
    "passwordSignIn": false,
    "emailAuth": false,
    "renovations": false,
    "updates": false,
    "story": false,
    "media": false,
    "photobookPreview": false,
    "sharing": false,
    "feedback": false,
    "accountDeletion": false,
    "checkout": false
  }
}
```

De waarden hierboven illustreren het doelprofiel vóór providerconfiguratie;
alle corecapabilities moeten voor een release werkelijk beschikbaar en bewezen
zijn, terwijl checkout `false` blijft. De frontend toont functionaliteit alleen
wanneer de bijbehorende servercapability waar is. Er is geen
`VITE_SIMPLE_APP_MODE` of client-owned capability truth.

## Readiness-afleiding

- database maakt Verbouwingen, Bouwmomenten, Verhaal, sharing en feedback
  beschikbaar;
- database, PII-keyring/blind index en productionorigin maken
  `passwordSignIn` ready; er zijn geen OAuth-secrets of callbacks vereist;
- account lifecycle vereist database, accountworker, PII, retentie,
  private Blob én `CRON_SECRET`;
- media vereist de geïsoleerde mediaworker-DB-URL plus private Blob; het
  digitale Bouwboek vereist de webdatabase en private Blob, geen printworker;
  deze capabilities vereisen geen `CRON_SECRET`;
- `emailAuth` is altijd `false`;
- `off` maakt payments disabled. De bestaande beveiliging van dormant commerce
  blijft intact: `test|live` vereist volledige geldige Stripe-, paymentworker-,
  PII-, price-, seller- en termsconfig, maar valt buiten deze release.

Nieuwe accounts gebruiken een gebruikersnaam van 3–32 tekens en een wachtwoord
van 15–128 tekens; registratie vraagt geen e-mailadres. De server slaat een
gezouten scrypt-hash op en geeft de bestaande opaque HttpOnly-sessie af. Alleen
de sessiehash staat in de database. Herhaalde loginpogingen zijn begrensd en
mutaties controleren origin/CSRF. Wachtwoordherstel is niet geïmplementeerd;
bestaande Google-identiteiten worden niet automatisch aan nieuwe accounts gekoppeld.

`GET /api/health` toont de veilig samengevatte runtimecapabilities en
`GET /api/readiness` controleert database- en actieve workergrenzen. De health-
capabilities `payments=disabled`, `printFulfilment=disabled` en `email=disabled`
zijn bedoeld in de gratis MVP en betekenen geen ontbrekende coreprovider.

Na media-completion verwerkt de request het exacte asset; owner-geautoriseerde
polling kan verwerking veilig hervatten. Printproofverwerking is dormant en
geen afhankelijkheid van het digitale Bouwboek. Er zijn geen media- of
photobookcronroutes/schedules.

## Environmentregels

- lokaal, Preview, staging en Production gebruiken `feedback_beta`,
  `BETA_MODE=false` en `CHECKOUT_MODE=off` voor de gratis MVP;
- `public_demo` kan als rollback beschikbaar zijn, maar passeert geen
  accountgebaseerde MVP-releasecheck;
- eventueel later commercewerk behoudt de bestaande mode-, account- en
  approvalcontroles; deze release activeert geen hosted betaalpad of live checkout;
- capability output geeft nooit secrets, seller-PII of providerpayload terug.

De launchchecks toetsen het gratis doelprofiel en de actieve core-readiness.
Payment- en printproofworkers zijn geen vereiste. Een succesvolle configcheck
vervangt nooit de echte hosted owner-/kijkerreis uit
[FLOWS](architecture/FLOWS.md).

Gebruik [STATE](architecture/STATE.md) voor de huidige release-uitkomst;
historische releaseverslagen zijn geen actuele GO of nieuwe releasevereisten.
