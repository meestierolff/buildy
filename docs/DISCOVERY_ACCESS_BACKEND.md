# Discovery, volgen en projecttoegang

De actieve browserroutes gebruiken uitsluitend de same-origin, getypeerde API-laag:

- `/` leest openbare projecten via `GET /api/discovery` en eigen projecten via `GET /api/projects`.
- `/favorieten` is semantisch de volgfeed en leest `GET /api/following`.
- Een projectdetail leest de eigen volg-/toegangsstatus via de sociale API. Een eigenaar beheert verzoeken via de actieve projectdetaildialoog.

De productiedatabase bevat `project_followers`, geaccepteerde profielrelaties en
`project_access_requests`, maar geen aparte bookmark- of opgeslagen-projectentabel. Daarom betekent
“Volgend” hier daadwerkelijk volgen: expliciet gevolgde projecten plus openbare projecten van gevolgde
bouwers. Een los “opslaan zonder volgen” is niet gesimuleerd in browserstate en blijft verborgen totdat
er een duurzaam servercontract en databaseschema voor bestaat.

`ProjectSettingsSheet.tsx` is legacy en wordt nergens actief gemount. De sheet bevat instellingen die
nog geen volledig productiecontract hebben (onder andere omslagpositie, voortgangsmodus en
adresbewerkingen). De ondersteunde toegangsfunctie is daarom rechtstreeks en owner-only op
`TripDetail.tsx` geplaatst; de overige legacy-instellingen blijven buiten de actieve UI. Hiervoor is geen
nieuwe migratie toegevoegd, omdat migratienummers 0016 en 0017 gereserveerd zijn.

Privacygrenzen:

- discovery bevat alleen actieve, bewust gepubliceerde openbare projecten;
- de volgfeed bevat alleen gepubliceerde updates;
- een privéproject vereist nog steeds een geaccepteerd projecttoegangsverzoek;
- blokkades werken in beide richtingen en verwijderen projecten uit discovery en de volgfeed;
- een toegangsverzoekenlijst is alleen voor de projectowner; een door profielprivacy afgeschermde
  aanvrager krijgt in die beperkte lijst de neutrale naam “Buildy-gebruiker”.
