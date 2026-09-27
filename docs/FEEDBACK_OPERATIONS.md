# Feedback operations

Productfeedback loopt via `/feedback` en `POST /api/feedback` voor een actieve,
ingelogde gebruiker. De accountapp gebruikt gebruikersnaam/wachtwoord.
Support en privacyverzoeken lopen via `/support`, contentmeldingen via `/melden`.

## Intake

De categorieën zijn `bug` (**Iets werkt niet**), `usability` (**Iets is
onduidelijk**), `idea` (**Ik heb een idee**) en `other` (**Andere feedback**).
Het getrimde bericht bevat 3–5.000 tekens. De client stuurt een veilige route,
privacyverklaringversie, gebruikersgebonden idempotencykey en lege honeypot mee.
Er is geen rating, screenshotupload of contactadres in dit feedbackcontract.

De UI vraagt gevoelige gegevens uit het bericht te houden. Succes geeft een
`HELP-XXXXXXXX`-ontvangstcode, zonder toezegging over antwoordtijd of uitkomst.
Buildy verstuurt geen automatische e-mail.

De server bepaalt de gebruiker, valideert schema/bodylimiet en behoudt
origin/CSRF, rate limiting en idempotencyconflicten. Exacte replay levert hetzelfde
ontvangstbewijs. Het bericht wordt contextgebonden versleuteld; overige metadata
is beperkt tot intake, status en abusecontrole. Berichttekst, IP, namen,
contactgegevens en media-URL's horen niet in logs of auditmetadata.

## Handmatige opvolging

Alleen een server-side geverifieerde `admin` opent `/beheer/feedback` of het
detail. Een moderatorgrant geeft geen toegang. De wachtrij toont ontvangstcode,
type/categorie, status/versie, contact-/authenticatiebooleans en timestamps.
Bericht en eventueel supportcontact worden alleen op de geautoriseerde
detailroute ontsleuteld. De ontvangstcode is geen authenticatiemiddel.

Statussen zijn `new`, `triaged` (**In behandeling**), `planned`, `resolved` en
`closed`. Iedere overgang vereist de verwachte versie en gebruikersgebonden
idempotencykey en krijgt een append-only auditrecord zonder PII. Gebruik alleen
de velden die voor afhandeling nodig zijn; publiceer geen feedbackinhoud.

Volg dataverzoeken via [ACCOUNT_LIFECYCLE](ACCOUNT_LIFECYCLE.md) en beheergrants
via [MODERATION_ADMIN_RBAC](MODERATION_ADMIN_RBAC.md). Wijzig records of
historische migrations niet ad hoc. Het runtimebewijs staat in
[STATE](architecture/STATE.md); dit runbook claimt geen uitgevoerde triage of
nieuwe releasecontrole.
