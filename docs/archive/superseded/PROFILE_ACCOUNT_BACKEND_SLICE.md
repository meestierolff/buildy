# Profiel- en accountbackend

> **SUPERSEDED SLICE.** De beschreven “bewust resterende” accountflows zijn nu
> geïmplementeerd. Zie [`ACCOUNT_LIFECYCLE.md`](../../ACCOUNT_LIFECYCLE.md) en
> [`PRODUCT_MODEL.md`](../../PRODUCT_MODEL.md).

Deze slice levert een productiegrens voor profielgegevens en privacy-instellingen. De HTTP-runtime gebruikt uitsluitend de vertrouwde actorresolver; user-ID's uit request bodies worden niet geaccepteerd.

## Routes

- `GET /api/account/profile` leest het eigen profiel voor een ingelogde actor.
- `PATCH /api/account/profile` wijzigt `displayName`, `slug`, `bio`, `location`, `isPrivate` en de expliciete `avatarAssetId` met optimistic versioning en actor-scoped idempotency.
- `GET /api/profiles/:slug` leest een publiek toegankelijk profiel en antwoordt hetzelfde met `404` voor onbekende, verwijderde, geschorste, private of geblokkeerde profielen waarvoor de actor geen toegang heeft.

De standaardruntime is fail-closed totdat `configureDefaultProfileRuntime` wordt aangeroepen met een `ProjectActorResolver` en `ProfileService`. `server/composition.ts` koppelt die runtime aan dezelfde vertrouwde actorresolver als projecten; de centrale API-router registreert de drie routes expliciet.

De browser gebruikt `src/lib/profileApi.ts` en `src/hooks/useProfiles.ts`. Header, mobiele navigatie en accountinstellingen lezen daardoor nooit een Better Auth provider-ID als app-user-ID. Een eigen profiellink gebruikt de servergeleverde profielslug; de profielpagina resolveert slugs via het publieke profielcontract en gebruikt pas daarna het app-user-ID voor sociale interacties.

## Avatargrens

Een profiel verwijst expliciet naar één eigen `media_assets`-record met doel `avatar`. Koppelen kan alleen als het rootasset volledig verwerkt, actueel, EXIF-vrij en een gevalideerd beeld onder `originals/` is. Zolang het asset gekoppeld is, kan geen veiligheidsrelevant veld worden aangepast en kan het asset niet worden verwijderd. `/api/media/:id` past bij uitlezen opnieuw de actuele profiel-lifecycle-, privacy-, follow- en blockregels toe.

Het aanmaken en verwerken van een avatar-upload-intent hoort bij de mediaslice en is hier niet toegevoegd.

## Bewust resterend

Accountverwijdering, data-export/privacy-export en sessiebeheer of sessierevocation vallen buiten deze slice en moeten afzonderlijk worden ontworpen en op de actor-, audit- en retentiegrenzen worden aangesloten. De oude oude BaaS-provider-acties hiervoor zijn niet meer zichtbaar op de accountpagina. Ook bestelgeschiedenis blijft verborgen totdat de photobook-slice daarvoor een eigen typed readmodel levert. De legacy onboardingdialog is niet meer gemount: een vervanging vereist een afzonderlijk server-owned onboardingstatuscontract, zodat voltooiing niet via een provider-ID of directe databasewrite wordt afgeleid.
