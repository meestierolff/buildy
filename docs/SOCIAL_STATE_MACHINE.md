# Sociaal state machine

Status: canoniek zichtbaar model. Autorisatie blijft server-side en de database
is beslissend.

## Eén relatie

Profile following is de enige zichtbare volgrelatie tussen personen. De actieve
API heeft geen project-follow- of project-accessrequestroutes. Historische
tabellen zoals `project_followers` en `project_access_requests` blijven voor
append-only data-integriteit bestaan, maar verlenen geen zichtbare nieuwe
capability en geven geen toegang tot een privéverbouwing.

De relatie is gericht: de requester/follower is `source_user_id`, de eigenaar
van het gevolgde profiel is `target_user_id`.

## Followtransities

| Actie | Voorwaarde | Nieuwe duurzame status | API-resultaat |
|---|---|---|---|
| Volg openbaar profiel | geen actieve block in beide richtingen | `active` | `following` |
| Volg privéprofiel | geen actieve block in beide richtingen | `pending` | `pending` |
| Herhaal dezelfde follow | relatie heeft gewenste status | ongewijzigd | zelfde state, `replayed=true` |
| Requester annuleert verzoek | eigen status `pending` | `revoked` | `cancelled` |
| Volger ontvolgt | eigen status `active` | `revoked` | `none` |
| Eigenaar accepteert | inkomend verzoek `pending` | `active` | `following` |
| Eigenaar wijst af | inkomend verzoek `pending` | `rejected` | `rejected` |
| Eigenaar verwijdert volger | inkomende status `active` | `revoked` | `revoked` |

Een afwijzing of intrekking kan later door een nieuwe expliciete followactie
worden vervangen. Self-follow is ongeldig. Mutaties zijn actor-scoped en
herhaalde gelijkwaardige verzoeken zijn idempotent.

## Blocking

| Actie | Effect |
|---|---|
| Blokkeren | maakt of activeert de gerichte blockrelatie en trekt actieve of pending follows in beide richtingen direct in |
| Opnieuw blokkeren | laat dezelfde block staan en retourneert een replay |
| Deblokkeren | trekt alleen de blockrelatie in |
| Opnieuw deblokkeren | verandert niets en retourneert een replay |

Deblokkeren herstelt nooit oude follows, requests of historische projecttoegang.
Een gebruiker moet daarna opnieuw een bewuste followactie starten.

Een actieve block heeft voorrang op:

- profielzoekresultaat en volledige profielinhoud;
- follow-, follower- en requeststatus;
- Verbouwing- en Bouwmomentreads;
- comments, reacties en mentions;
- media- en Bouwboekreads;
- notificatiedoelen.

## Connecties

`/connecties` is de enige beheerplek voor relaties. De server biedt vijf
gepaginaeerde relatieviews plus zoeken:

| UI | API-view | Inhoud |
|---|---|---|
| Zoeken | profielsearch | openbare profielen en minimale vindbare identiteit van privéprofielen |
| Volgend | `following` | profielen die de actor actief volgt |
| Volgers | `followers` | actieve volgers van de actor |
| Inkomende verzoeken | `incoming` | pending requests naar de actor |
| Uitgaande verzoeken | `outgoing` | pending requests van de actor |
| Geblokkeerd | `blocked` | door de actor actief geblokkeerde profielen |

`total` komt uit dezelfde canonieke databasequery als de lijst; de UI mag geen
gedeeltelijk geladen paginalengte als totaal presenteren. Notificaties mogen
naar de juiste Connecties-view deep-linken, maar zijn niet de beheerbron.

## Profielprivacy

- Openbaar profiel: zichtbaar voor iedereen; een follow wordt direct actief.
- Privéprofiel: volledig zichtbaar voor eigenaar en actieve volgers; anderen
  zien bij expliciet zoeken alleen genoeg identiteit om een verzoek te sturen.
- Pending is geen leesrecht.
- Blocking en account/moderatiestatus gaan vóór profielprivacy.

## Zichtbaarheid van een Verbouwing

| Optie in UI | Databasewaarde | Wie kan lezen? | Discovery |
|---|---|---|---|
| Alleen ik | `private` | alleen de eigenaar | nooit |
| Mijn volgers | `followers` | eigenaar en actieve profielvolgers van de eigenaar | niet voor anderen |
| Iedereen met de link | `unlisted` | eigenaar en ontvanger met een geldige, niet verlopen/ingetrokken owner-issued share capability | niet als openbaar resultaat aanbieden |
| Openbaar | `public` | iedereen | toegestaan |

Niet-private Verbouwingen moeten gepubliceerd zijn. De eigenaar kan daarnaast
eigen drafts zien; andere viewers zien alleen gepubliceerde Bouwmomenten.
`unlisted` is een read-only vindbaarheidsmodus, geen editgrant en geen aparte
projectrelatie. De gewone project-URL verleent geen toegang. De eigenaar maakt
een high-entropy tijdelijke deellink, kan die roteren/intrekken, of trekt alle
linktoegang in door de zichtbaarheid te wijzigen. De raw token wordt vóór React
uit het fragment verwijderd, uitsluitend in een POST-body ingewisseld en daarna
vervangen door een signed HttpOnly link-ID-cookie; PostgreSQL bewaart alleen de
keyed hash. De capability geeft geen budget-, Bouwboek-, original-media- of
schrijfrechten.

Een actieve profile-follow geeft alleen leesrecht voor de optie Mijn volgers.
Hij geeft geen toegang tot Alleen ik en nooit schrijf- of beheerrechten. Een
historisch geaccepteerd project-accessrequest geeft evenmin toegang tot Alleen
ik.

## Autorisatievolgorde

Voor iedere profiel-, Verbouwing-, Bouwmoment-, engagement-, media- en
Bouwboekread controleert de server in essentie:

1. bestaat het object en is eigenaar/account actief;
2. is het object niet verwijderd of door moderatie verborgen;
3. bestaat er geen block in een van beide richtingen;
4. is de actor eigenaar, of staat de actuele visibility de read toe;
5. is het Bouwmoment voor een niet-eigenaar gepubliceerd;
6. valt de specifieke media- of engagementread onder exact dezelfde toegang.

Een wijziging van Openbaar naar Mijn volgers, van Mijn volgers naar Alleen ik,
van Iedereen met de link naar Alleen ik, share-link expiry/rotate/revoke, een
unfollow, follower removal of block
moet daarom bij de eerstvolgende read project, update, comment, reactie, gallery,
media en Bouwboek afschermen. De client invalideert betrokken caches na mutaties;
de server vertrouwt nooit alleen op die invalidatie.

## Volgend, engagement en notificaties

- Volgend is chronologisch en gebaseerd op gevolgde profielen, niet op een
  tweede project-follow of engagementranking.
- Alleen zichtbare, gepubliceerde Bouwmomenten mogen in de feed staan.
- Comments en reacties vereisen actuele leesrechten; de auteur of
  Verbouwingseigenaar kan een comment verwijderen volgens de serverregels.
- Mentions worden server-side beperkt tot gebruikers die het doel nog mogen
  zien.
- Notificaties worden niet getoond wanneer het doel voor de ontvanger niet meer
  toegankelijk is.
- E-mailnotificaties zijn geen onderdeel van de MVP.

## Actieve HTTP-grens

De sociale runtime registreert alleen profielroutes voor search/detail,
connections, follow/unfollow, accept/reject, follower removal en block/unblock.
Voormalige `/api/social/projects/:id/follow`, `state`, `access` en
`access-requests` routes zijn niet actief. Historische SQL is geen publiek
API-contract.

## Bewijs en resterende releasegate

Server-, contract- en clean-room PostgreSQL-tests bewijzen de centrale
transities, de vier visibilitymodi, blokkades en onmiddellijke revoke op
databasegrenzen. De volledige multi-actor browserjourneys blijven een harde
releasegate: de verplichte Playwright MCP-runtime was op 23 augustus 2026 door
de huidige Codex-gebruikslimiet geblokkeerd en kon geen interactieve state
verifiëren.
