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

Er is geen e-mailprovider. De actieve runtime verstuurt dus geen ontvangst-,
support- of moderatiemail; historische outbox/e-mailmigrations zijn geen
deliveryclaim. Een opgegeven replyadres wordt alleen versleuteld opgeslagen
zodat een bevoegde operator buiten deze automatische runtime kan reageren.

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
Google/server-session en hercontroleert targetvisibility in de database. Een
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

## Operationele gates

Vóór brede publieke posting zijn minimaal nodig:

1. benoemde moderatie-, support-, privacy- en escalatie-eigenaars;
2. goedgekeurd content-/minderjarigen-/privacy-/bezwaar-/evidencebeleid;
3. geteste rolgrants, ordinary-user denial, queuefilters/cursors en iedere actie;
4. complete targetvisibility-, block-, restore- en session-revocationprobes;
5. abuse-, lange/random-input-, keyboard-, mobile- en screenreaderreizen;
6. een handmatig supportproces dat geen automatische e-mail belooft;
7. alerting voor urgente open meldingen zonder meldingstekst te loggen.

Gebruik alleen synthetische data. Op deze release-snapshot ontbreekt Preview- en
role-journeybewijs en was de verplichte Browser MCP-runtime door de huidige
Codex-gebruikslimiet geblokkeerd. De publieke bèta en productie blijven daarom
**NO-GO**.
