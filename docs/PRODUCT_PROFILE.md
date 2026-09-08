# Server-owned productprofiel

Het enige Buildy-releaseprofiel is `PRODUCT_PROFILE=feedback_beta`. Die naam
schakelt geen oude “simple app” in; zij groepeert de production-MVP-capabilities.
`public_demo` bestaat uitsluitend als veilige statische fallback en is nooit
een Preview-, staging- of production-releaseprofiel.

## Publiek contract

`GET /api/product-profile` retourneert de serverwaarheid:

```json
{
  "profile": "feedback_beta",
  "checkoutMode": "off",
  "betaMode": true,
  "inviteRequiredForNewAccounts": true,
  "capabilities": {
    "googleSignIn": false,
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

De waarden hierboven illustreren een ongeconfigureerde fail-closed omgeving;
`feedback_beta` met checkout `off` is geen geldige releaseconfiguratie. De
frontend toont functionaliteit alleen wanneer de bijbehorende servercapability
waar is. Er is geen `VITE_SIMPLE_APP_MODE` of client-owned capability truth.

## Readiness-afleiding

- database maakt Verbouwingen, Bouwmomenten, Verhaal, sharing en feedback
  beschikbaar;
- Google plus database, PII-keyring/blind index en productionorigin maken
  `googleSignIn` ready;
- account lifecycle vereist database, accountworker, Google, PII, retentie,
  private Blob én `CRON_SECRET`;
- media en Bouwboek vereisen respectievelijk hun geïsoleerde worker-DB-URL plus
  private Blob; hun request-driven capabilities vereisen geen `CRON_SECRET`;
- `emailAuth` is altijd `false`;
- checkout is alleen `true` bij mode `test|live` én volledige geldige Stripe,
  paymentworker, PII, price, seller en termsconfig;
- `off` maakt payments disabled; incomplete `test|live` blijft unconfigured.

`GET /api/health` toont de veilig samengevatte runtimecapabilities en
`GET /api/readiness` controleert database- en actieve workergrenzen. De health-
capability `printFulfilment=disabled` betekent dat automatische fulfilment is
uitgeschakeld; de menselijke adminorderflow blijft actief. `email=disabled` is
bedoeld en geen ontbrekende provider.

Na media-completion verwerkt de request het exacte asset. Een proofrequest
verwerkt de exacte revisie; zolang die nog `rendering` is, kan de
owner-geautoriseerde editorpoll dezelfde leased/idempotente verwerking opnieuw
activeren. Er zijn geen media- of photobookcronroutes/schedules.

## Environmentregels

- `public_demo` en `CHECKOUT_MODE=off` mogen alleen als expliciete veilige
  statische fallback voor lokaal gebruik of incidentmitigatie worden ingezet;
  geen van beide kan een releasecheck passeren;
- automatische betaaltests en Vercel Preview gebruiken `test`;
- production commerce gebruikt alleen na formele GO `live`;
- keyprefix, Stripe environment/account, price/seller environment en approval-
  geldigheid moeten exact overeenkomen;
- capability output geeft nooit secrets, seller-PII of providerpayload terug.

De fail-closed launchchecks vereisen daarom `feedback_beta/test` voor Preview
en staging, en `feedback_beta/live` voor Production. Een statische fallback mag
beschikbaar blijven voor veilig herstel, maar geldt nooit als bewijs dat de
production-MVP klaar of uitgerold is.

De huidige release is geen production-GO. Zie
[MVP_RELEASE_REPORT.md](MVP_RELEASE_REPORT.md).
