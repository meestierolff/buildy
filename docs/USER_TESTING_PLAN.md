# Private-bèta gebruikerstestplan

**Status:** testplan en repositoryruntime gereed; testerselectie, target-database-
grants, stagingbewijs en retentiebesluit zijn nog externe gates. Circa 120 Instagramvolgers zijn geen 120 gebruikers
of klanten en worden niet zo gerapporteerd.

## Doel en doelgroep

Onderzoek of particuliere verbouwers zonder begeleiding een privé project kunnen
starten, drie foto's veilig kunnen plaatsen, iemand gecontroleerd kunnen laten
meekijken en een printproof kunnen begrijpen. De eerste ronde bestaat bij
voorkeur uit 6–10 volwassen testers in verschillende verbouwingsfasen en met een
mix van mobiel/desktop en technische vaardigheid. Minderjarigen worden niet
uitgenodigd voordat het leeftijdsbesluit is goedgekeurd.

## Invite en privacy

- Iedere tester krijgt een unieke, korte geldige code met usage limit; codes
  worden alleen als hash opgeslagen en nooit uit de clientbundle afgeleid.
- Registratie blijft server-side invite-only. Login van bestaande testers blijft
  mogelijk wanneer nieuwe registratie is gesloten.
- De uitnodiging benoemt bèta-status, doel, wat wordt geobserveerd, vrijwilligheid,
  contactroute en relevante privacy-/voorwaardenversie.
- Gebruik uitsluitend synthetische of door de tester bewust gekozen foto's. Vraag
  toestemming van herkenbare derden en vermijd adressen/documenten in beeld.
- Neem scherm/audio alleen op na afzonderlijke expliciete toestemming. Deel
  sessielinks en exports niet buiten het onderzoeksteam.

## Sessieverloop en taken

De moderator geeft het doel, niet de klikroute. Vraag hardop te denken zonder
wachtwoorden, adressen of andere gevoelige invoer uit te spreken.

1. Maak via de uitnodiging een account en rond verificatie/onboarding af.
2. Start een project en kies bewust openbaar of privé.
3. Voeg een eerste update met drie foto's toe en controleer de volgorde.
4. Maak een toegankelijke voor/na-combinatie en wijzig één foto/focuspunt.
5. Nodig iemand uit of vraag/sta toegang toe; controleer de pending/accepted
   toestand vanuit beide rollen.
6. Bekijk een ander zichtbaar project, reageer en plaats een comment.
7. Open het Bouwboek en leg in eigen woorden uit hoe de automatische opmaak tot
   stand komt.
8. Wijzig cover of foto, genereer een echte proof en controleer pagina-aantal,
   uitsnede, ontbrekende beelden en tekst.

Geen testorder wordt live betaald of geprint zonder de afzonderlijke sandbox- en
proefdrukgate.

## Observatievragen

- Wat verwacht je dat deze knop doet, en wat veranderde er volgens jou?
- Welke informatie denk je dat anderen nu kunnen zien?
- Waar verwacht je een foto, update of toegang weer te kunnen verwijderen?
- Wat betekent “proof goedkeuren” en wat verwacht je daarna nog te kunnen wijzigen?
- Waar twijfel je of een actie definitief, betaald of openbaar is?
- Kun je een fout herstellen zonder hulp, en begrijp je de volgende stap?

## Meting en privacybewuste events

Registreer alleen eventnaam, UTC-tijd, environment, pseudonieme sessie-/actor-ID,
routeklasse, resultaatcode, duurklasse en productversie. Verboden: naam,
e-mailadres, adres, caption/comment, foto- of PDF-pad/URL, access token en vrije
tekst. De provider-neutrale eventset is:

`signup_started`, `signup_completed`, `onboarding_completed`, `project_created`,
`first_update_created`, `photo_upload_completed`, `project_shared`,
`follow_requested`, `follow_accepted`, `comment_created`, `photobook_opened`,
`photobook_draft_generated`, `proof_generated`, `proof_approved`,
`checkout_started`, `checkout_completed`, `feedback_submitted` en
`error_encountered`.

De repository schrijft deze events naar een provider-neutraal, append-only
first-party ledger met exacte properties. Er is geen third-party analytics-SDK.
Export/rapportage buiten Buildy blijft uit totdat retentie, toegang en doelbinding
zijn goedgekeurd; kwalitatieve observaties blijven met test-ID vastgelegd.

## Succescriteria

- minimaal 80% voltooit taken 1–3 zonder interventie;
- minimaal 70% voltooit toegang/reactie en Bouwboektaken zonder blokkerende hulp;
- 100% kan na taak 2 correct aangeven of het project openbaar of privé is;
- geen private-media-, IDOR-, prijs- of proof-integriteitsincident;
- geen onbehandelde P0/P1-bug, dode kernactie of ernstige axe-fout;
- mediane taakfrictie daalt of blijft verklaarbaar tussen wekelijkse rondes.

Deze drempels zijn productonderzoekscriteria, geen commerciële claim.

## Frictionlog en interviews

Log per taak: test-ID, device/viewport, start/einde, voltooid/hulp/mislukt, aantal
terugstappen, zichtbare foutcode, privacytwijfel, letterlijke korte observatie en
severity. Vrije tekst wordt vóór delen gecontroleerd op PII.

Afsluitvragen: wat voelde het meest waardevol, wat voelde onveilig of onzeker,
welke informatie ontbrak, wat zou je niet delen, hoe verhoudt de proof zich tot
je verwachting, en zou je terugkomen na een nieuwe verbouwingsstap?

Categoriseer feedback als blocker, privacy/security, begrip, navigatie,
toegankelijkheid, performance, content/copy, feature request of provider/external.
Een idee zonder reproductiepad wordt niet automatisch een bug.

## Wekelijkse cadence en go/no-go

Maandag triageert product/security alle bevindingen; dinsdag worden hoogste
risico's gereproduceerd; woensdag/donderdag volgt een kleine gevalideerde wijziging;
vrijdag worden kernscenario's en regressies opnieuw gedraaid. Beslissingen en
afwijzingen krijgen eigenaar en bewijs.

NO-GO bij privacy/securityincident, verlies/corruptie, openbare registratie buiten
invite, gebroken accountdelete, foutieve betaling/proof, onbehandelde P0/P1,
ernstige accessibilityfout of ontbrekende moderatie-/supportdekking. Opschalen
naar een volgende betagroep mag pas na groen technisch bewijs, getekende externe
gates en expliciet eigenaarbesluit.
