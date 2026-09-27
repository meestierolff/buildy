# Delen, volgen en profielconnecties

Een project volgen en een profielconnectie hebben verschillende functies.
Volgen abonneert de gebruiker op precies één verbouwing. Profielconnecties
bepalen wie een verbouwing met visibility `followers` mag lezen. Autorisatie
blijft server-side; volgen verleent geen extra lees- of schrijfrecht.

## Eén verbouwing volgen

De ingelogde kijker gebruikt idempotente `PUT`/`DELETE`
`/api/projects/:projectId/follow`. De server leidt de gebruiker en eventuele
deellinkcontext af uit vertrouwde sessiecookies. Follow vereist een actieve
gebruiker, actuele leesrechten en een andere eigenaar.

| Handeling | Duurzame status | Resultaat |
| --- | --- | --- |
| Volgen | `active` | `following` |
| Dezelfde follow herhalen | ongewijzigd | `following`, `replayed=true` |
| Een muted subscription opnieuw volgen | `active` | `following` |
| Ontvolgen | `revoked` | `none` |
| Ontvolgen terwijl al ingetrokken | ongewijzigd | `none`, `replayed=true` |

`viewerFollowStatus` in het projectoverzicht is `self`, `following` of `none`.
Zowel `active` als `muted` telt als following; alleen `active` ontvangt
publicatienotificaties. Een gebruiker kan zijn eigen subscription ook beëindigen
na verlies van leesrecht, zonder daarmee verborgen projectinformatie te krijgen.

`/volgend` gebruikt `/api/following` voor uitsluitend de gekozen, nog toegankelijke
verbouwingen en hun gepubliceerde Bouwmomenten. De andere projecten van dezelfde
eigenaar verschijnen niet automatisch. Er is geen brede discoveryfeed.

## Profielconnecties

De gerichte relatie loopt van `source_user_id` naar `target_user_id`.
`/connecties` beheert profielrelaties, verzoeken en blokkades; deze lijst staat
los van de projectfeed.

| Handeling | Voorwaarde | Nieuwe status |
| --- | --- | --- |
| Openbaar profiel volgen | geen block | `active` |
| Privéprofiel volgen | geen block | `pending` |
| Eigen verzoek annuleren | `pending` | `revoked` |
| Profiel ontvolgen | `active` | `revoked` |
| Inkomend verzoek accepteren | `pending` | `active` |
| Verzoek afwijzen | `pending` | `rejected` |
| Eigen volger verwijderen | `active` | `revoked` |

Gelijke verzoeken zijn idempotent. Self-follow is ongeldig. Een private
profielpagina is alleen volledig zichtbaar voor de eigenaar en actieve
profielconnecties; anderen kunnen bij expliciet zoeken de minimale identiteit
zien om een verzoek te doen. Pending is geen leesrecht.

De gepagineerde API-views zijn `following`, `followers`, `incoming`, `outgoing`
en `blocked`; `total` komt uit dezelfde databasequery als de lijst. Een
notificatie kan naar een view linken maar is niet de bron van relatiestatus.

## Blokkeren en intrekken

Blokkeren trekt actieve/pending profielrelaties en projectsubscriptions in beide
richtingen in. Het sluit ook betrokken historische accessrecords. Ontvolgen of
verwijderen van een profielconnectie trekt de projectsubscriptions in de
betrokken richting in. De database serialiseert mutaties voor hetzelfde paar.

Deblokkeren trekt alleen de block in; het herstelt geen eerdere follows,
verzoeken of toegang. Een actieve block gaat voor op profiel- en projectreads,
engagement, private media en notificatiedoelen. Een nieuwe relatie vraagt een
nieuwe expliciete handeling.

## Zichtbaarheid en deellinks

| Databasewaarde | Wie kan lezen? |
| --- | --- |
| `private` | alleen de eigenaar |
| `followers` | eigenaar en actieve profielconnecties van de eigenaar |
| `unlisted` | eigenaar en ontvanger met een geldige owner-issued deellink |
| `public` | iedereen, zolang publicatie/lifecycle/moderatie dit toestaat |

Niet-eigenaren zien alleen gepubliceerde inhoud. Een gewone project-URL geeft
geen recht op een private of unlisted verbouwing. De eigenaar maakt een
willekeurige tijdelijke deellink en kan deze roteren of intrekken. De raw token
wordt vóór React uit het URL-fragment verwijderd, via een POST-body ingewisseld
en vervangen door een signed HttpOnly cookie met link-ID. PostgreSQL bewaart
alleen de keyed tokenhash.

De capability geeft leesrecht op het gedeelde verhaal, geen edits, originele
media of owner-only Bouwboekdownload. Expiry, rotatie, intrekking en een
visibilitywijziging worden bij volgende reads gecontroleerd. Een profielconnectie
geeft geen recht op `private`; een projectsubscription of historisch geaccepteerd
accessrequest evenmin.

## Reads, reacties en notificaties

Iedere read controleert bestaan, actieve eigenaar/account, lifecycle,
moderatie, blocks en actuele visibility of deellink. Dezelfde grens geldt voor
Bouwmomenten, comments, reacties en media. Clientcache-invalidatie helpt de UI,
maar vervangt geen servercontrole.

Comments en reacties vereisen een ingelogde actor met actuele leesrechten.
Commentauteur en projecteigenaar hebben de bestaande verwijderrechten. Mentions
en notificaties zijn beperkt tot nog toegankelijke doelen. Er zijn geen
e-mailnotificaties.

Project ontvolgen verwijdert de verbouwing uit Volgend, maar maakt een verder
openbare of nog geldig gedeelde verbouwing niet privé. Verlies van de benodigde
profielconnectie, linkintrekking, block of verwijdering ontneemt wel het
bijbehorende leesrecht. Al gedownloade bytes zijn niet terug te roepen.

De profielroutes staan onder `/api/social`; project volgen staat onder
`/api/projects/:projectId/follow`. Voormalige `/api/social/projects/...`
follow-/accessrequestroutes zijn niet actief. Zie [F3/F4](architecture/FLOWS.md)
voor het gebruikersresultaat en [STATE](architecture/STATE.md) voor werkelijk
uitgevoerd bewijs.
