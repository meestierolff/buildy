# Buildy feedback beta

## Doel

Buildy wordt de kleinste mooie, veilige en coherente feedbackbèta rond één
belofte:

`Maak van je verbouwing een verhaal om te bewaren.`

## Kernflow

1. Bezoeker begrijpt binnen tien seconden wat Buildy is.
2. Bezoeker probeert één lokale verbouwfoto.
3. Die foto wordt zichtbaar als bouwmoment, Verhaal en Bouwboek-spread.
4. Bezoeker meldt zich aan met Google.
5. Buildy bewaart de eerste verbouwing en het eerste bouwmoment.
6. De gebruiker deelt optioneel een read-only link, geeft feedback en kan het account verwijderen.

## Niet de MVP

- sociaal netwerk als primaire ervaring
- wachtwoord- of e-maillogin
- budget, floorplans en brede admin als kernnavigatie
- checkout, Stripe of Peecho in publieke runtime
- kritieke cronjobs, queues of fulfilmentworkers

## Huidige status

- lokale repository-gates voor typecheck, lint, unit/servertests, build,
  bundelbudget, public Playwright en statische launchcheck zijn groen
- de volledige lokale PostgreSQL migration/RLS-workflow is groen op een tijdelijke testdatabase
- de repository-instructies zijn omgezet naar de feedbackbèta-richting
- externe releaseblokkades blijven bestaan voor Google OIDC, Vercel Blob,
  Vercel Preview, productie-Neon en operatorbewijs

## Nog open buiten code

- Previewdeployment met echte Vercel-environmentconfiguratie
- Google OIDC-client en redirect-URI's
- private Vercel Blob-configuratie
- productie- en previewdatabases bevestigen
- operatorproof voor privacy, support en accountverwijdering

Zie [docs/MVP_RELEASE_REPORT.md](docs/MVP_RELEASE_REPORT.md) voor de actuele
uitvoeringstoestand.
