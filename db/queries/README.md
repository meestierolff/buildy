# Databasequeries

Deze map bevat uitsluitend herbruikbare, getypeerde Drizzle-queries en schermgerichte readmodels. Domeinwrites horen in services en mogen niet als losse queryhelpers vanuit routehandlers of React worden aangeroepen.

Regels:

- iedere query ontvangt een expliciete actorcontext;
- server-side autorisatie wordt vóór of binnen dezelfde transactie als de query uitgevoerd;
- bij defense-in-depth RLS zet de transactie `SET LOCAL app.actor_id` op de geauthenticeerde `app_users.id`;
- feeds, updates, comments en notificaties gebruiken stabiele cursorpagination met een unieke tie-breaker;
- publieke readmodels bevatten nooit adres-, contractor-, budget-, auth-, ordercontact- of private objectdata;
- geen query retourneert storagecredentials, sessietokens, providersecrets of persisted signed URLs;
- writequeries controleren `version` voor optimistic concurrency;
- voorkom N+1-query's door readmodels doelgericht te joinen of in een begrensde batch op te bouwen;
- querytests draaien tegen een geïsoleerde database met uitsluitend synthetische `@example.test`-data.

De SQL in `db/migrations/` is de schemawaarheid voor deployed databases. `db/schema/` is de getypeerde Drizzleweergave en moet bij iedere migration in dezelfde wijziging worden bijgewerkt.
