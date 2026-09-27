# Moderatie, support en feedback

Status: actieve typed intake en server-side beheergrens.

## Gebruikersflows

- zichtbare profielen, Verbouwingen, Bouwmomenten, media en reacties hebben een
  contextuele **Melden**-actie;
- `/melden` biedt uitleg en een publiek pad voor derden;
- `/support` accepteert support, privacyverzoeken van derden en bezwaar;
- `/feedback` accepteert productfeedback van een ingelogde gebruiker;
- `/contentbeleid` en `/huisregels` leggen de gedrags- en fotoprivacygrenzen uit;
- `/beheer/moderatie` en `/beheer/moderatie/:reportId` bieden een
  server-geautoriseerde beheerqueue.
- `/beheer/feedback` en `/beheer/feedback/:submissionId` bieden uitsluitend
  aan `admin` een feedback-/supportqueue en expliciet PII-detail.

Na intake toont Buildy een niet-geheime ontvangstcode `MELD-…` of `HELP-…` in de
UI. Er wordt geen responstijd, verwijdertermijn of uitkomst beloofd. Het formulier
is geen noodkanaal.

Buildy verstuurt geen automatische ontvangst-, support- of moderatiemail.
Een opgegeven replyadres wordt versleuteld opgeslagen voor handmatige
afhandeling door een bevoegde operator. Dit staat los van registratie met
gebruikersnaam/wachtwoord, die geen e-mailadres verzamelt.

## HTTP- en trustgrenzen

| Route | Authenticatie | Doel |
| --- | --- | --- |
| `POST /api/moderation/reports` | optioneel | alleen content melden die deze actor mag zien |
| `POST /api/feedback` | vereist | productfeedback van de ingelogde actor |
| `POST /api/support` | optioneel, replyadres vereist | support, derdenverzoek of bezwaar |
| `GET /api/moderation/admin/session` | moderator/admin | server-owned rol teruggeven |
| `GET /api/moderation/admin/reports` | moderator/admin | begrensde cursorqueue |
| `GET /api/moderation/admin/reports/:id` | moderator/admin | ontsleuteld detail en audit |
| `POST /api/moderation/admin/reports/:id/actions` | volgens rol/actie | geversioneerde beheeractie |
| `GET /api/admin/feedback/session` | admin | server-owned beheerrol bevestigen |
| `GET /api/admin/feedback` | admin | gepagineerde metadatawachtrij |
| `GET /api/admin/feedback/:id` | admin | bericht/contact contextgebonden ontsleutelen |
| `POST /api/admin/feedback/:id/status` | admin | geversioneerde, idempotente statusovergang |

De intake accepteert uitsluitend JSON zonder queryparameters en begrenst de body
op 32 KiB; moderatie-adminmutaties op 16 KiB en feedback-adminmutaties op 8 KiB.
De server leidt de actor af uit de
wachtwoordsessie en hercontroleert targetvisibility in de database. Een
anonieme actor kan alleen publieke content melden. Support en bezwaar blijven
bereikbaar na accountschorsing; andere routes falen gesloten.

Origin/CSRF, veilige methoden en request-ID worden centraal door de API-router
afgedwongen. Alleen een geldig eerste `x-vercel-forwarded-for`-IP kan als
kortstondige rate-limitbron dienen; willekeurige forwarded headers worden niet
vertrouwd.

## Dataminimalisatie

Meldingstekst, replyadres, minimale targetsnapshot en support-/feedbacktekst
worden als contextgebonden AES-GCM-envelopes opgeslagen. Replyadressen krijgen
een keyed blind index. Plaintext, targets, berichttekst, IP, adres of e-mail hoort
niet in logs, idempotencykeys, URL's of auditmetadata.

Auditmetadata gebruikt alleen begrensde operationele labels zoals targettype,
reason/urgency, categorie, anonymous/contact booleans, actor-ID, actie en
request-ID. De UI-ontvangstcode is geen authenticatiemiddel en geeft geen
toegang tot meldingstekst.

Exacte replay wordt vóór rate limiting herkend. Clientkeys worden aan actor of
anonieme sourcefingerprint en requestinhoud gebonden; dezelfde key met andere
inhoud faalt met conflict. Honeypot, strikte enums en maximumlengtes zijn extra
abusegrenzen.

## Beheer en RBAC

De actuele rollen zijn `moderator` en `admin`, als tijdelijke/actieve
databasegrants die server-side aan de ingelogde app-user worden opgelost. Een
clientclaim, header of profielveld verleent geen beheerrecht. Beheerrechten
worden alleen met de gecontroleerde migration-owner-CLI verleend of ingetrokken;
de laatste actieve admin kan niet worden ingetrokken.

Rapportstatus is `open`, `triaged`, `investigating`, `resolved` of `dismissed`.
Acties zijn `hide`, `restore`, `warn`, `suspend`, `block`, `dismiss` en
`resolve`. `suspend` en `block` zijn admin-only. Iedere actie vereist reden,
idempotencykey en verwachte rapportversie. `restore` verwijst exact naar één
eerder niet-teruggedraaide actie.

Verborgen targets verdwijnen ook voor eigenaar en bestaande volgers. Schorsing
trekt server-owned sessies in en blokkeert writes. Een blokkade heeft voorrang
op profiel- en projectvisibility. Beheeractie en reverse-relatie blijven
append-only auditbaar.

Feedbackstatus gebruikt de bestaande enum `new`, `triaged`, `planned`,
`resolved` en `closed`; de UI noemt `triaged` **In behandeling**. Alleen admin
mag deze PII-bevattende supportstroom openen. Wachtrijresultaten bevatten geen
bericht, contact, ciphertext, actor-ID, route of hashes; het detail ontsleutelt
bericht/contact pas nadat HTTP, service én SQL de adminrol hebben bevestigd.

## Operationele afhandeling

Wijs iedere melding toe aan een verantwoordelijke en behandel urgente open
meldingen via het afgesproken escalatiepad. Bewaar voor opvolging ontvangstcode,
status, versie en veilige auditmetadata; kopieer geen inhoud naar logs of tickets.
Een ontvangstcode geeft nooit toegang tot meldingstekst en het formulier is geen
noodkanaal. Handmatige opvolging mag geen automatische e-mail of vaste
antwoordtermijn beloven.

Zie [MODERATION_ADMIN_RBAC](MODERATION_ADMIN_RBAC.md) voor rolbeheer,
[FEEDBACK_OPERATIONS](FEEDBACK_OPERATIONS.md) voor productfeedback en
[ACCOUNT_LIFECYCLE](ACCOUNT_LIFECYCLE.md) voor export/verwijdering. De huidige
deployment en uitgevoerd bewijs staan in [STATE](architecture/STATE.md).
