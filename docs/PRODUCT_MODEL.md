# Productmodel

Buildy is een foto- en verhaaldagboek voor een verbouwing en de mensen die
meekijken. [MVP_SCOPE](MVP_SCOPE.md) bepaalt de kleine productgrens.

| Begrip | Betekenis | Interne naam |
| --- | --- | --- |
| Verbouwing | Dagboek en privacygrens van één verbouwing | project/trip |
| Bouwmoment | Foto's, datum en verhaaltekst | update/step |
| Verhaal | Globaal chronologische Bouwmomenten | timeline |
| Bouwboek | Hetzelfde bronmateriaal als persoonlijk boek en PDF | photobook |
| Volgend | Alleen de toegankelijke, specifiek gevolgde verbouwingen | project_followers |
| Profielconnecties | Relaties die bestaande zichtbaarheidsregels ondersteunen | friends/social |

De eigenaar beheert de inhoud. Een volger mag lezen en reageren binnen de
actuele toegang. Anonieme bezoekers lezen alleen openbare inhoud of inhoud
waarvoor ze een geldige deellink hebben. Een link of follow geeft nooit editrechten.
Blocking, verwijdering en ingetrokken toegang gelden ook voor media en reacties.

Een nieuwe verbouwing begint privé. Een Bouwmoment hoort bij één verbouwing;
foto's worden na een geautoriseerde upload direct onder de mediaworkerrol
verwerkt. Er is geen mediaqueue of aparte cron nodig.

Het Verhaal en Bouwboek gebruiken datum, sorteerpositie en ID als stabiele
volgorde. Bouwfasen mogen die volgorde niet veranderen. Preview, paginatelling
en PDF komen uit één document; lange tekst loopt door. PDF-generatie verwerkt
alleen de aangevraagde revisie onder een eigen workerrol. Historische vergrendelde
revisies blijven onveranderd. Er is geen bestel- of printgoedkeuringsactie.

De browser gebruikt typed same-origin API-clients. Identiteit en toestemming
komen van de server; Postgres/RLS en private Blob houden de inhoud afgeschermd.
Het capability-endpoint meldt beschikbare kerndiensten. Oude responsevelden
blijven compatibel, maar checkout, e-mail en uitnodigingen zijn altijd uit.
