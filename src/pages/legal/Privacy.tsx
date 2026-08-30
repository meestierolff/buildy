import { Link } from "@/lib/router";
import LegalLayout from "./LegalLayout";
import LegalPendingNotice from "./LegalPendingNotice";

const Privacy = () => (
  <LegalLayout
    title="Privacyverklaring"
    description="Welke persoonsgegevens Buildy in de gratis MVP verwerkt, waarom en welke keuzes en rechten je hebt."
    updated="29 augustus 2026"
  >
    <LegalPendingNotice title="Verantwoordelijke en contactgegevens nog vereist">
      <p>
        De exploitant moet vóór publieke registratie de volledige juridische naam, het
        vestigingsadres en een rechtstreeks privacycontact publiceren. Die gegevens zijn
        nog niet aangeleverd. Privacyverzoeken kunnen nu via het publieke
        <Link to="/support"> supportformulier</Link> worden ingediend; dit formulier
        vervangt de ontbrekende identificatie- en contactgegevens niet.
      </p>
    </LegalPendingNotice>

    <p>
      Deze verklaring geldt voor bezoekers, accountgebruikers en mensen die via Support
      contact opnemen. Zij geldt ook als jouw persoonsgegevens voorkomen in inhoud die een
      Buildy-gebruiker heeft geplaatst, bijvoorbeeld op een foto of in een reactie.
    </p>

    <h2>1. Wie is verantwoordelijk?</h2>
    <p>
      De exploitant van Buildy is verantwoordelijk voor de verwerking door het platform.
      De concrete exploitantgegevens moeten op deze pagina worden ingevuld. Tot dat is
      gebeurd, is <Link to="/support">Support</Link> de beschikbare route voor vragen en
      privacyverzoeken.
    </p>

    <h2>2. Welke gegevens verwerkt Buildy?</h2>
    <ul>
      <li><strong>Account en profiel:</strong> je Google-identificatie, e-mailadres, weergavenaam, profielfoto, profieltekst, globale locatie, privacykeuze en accountmomenten.</li>
      <li><strong>Verbouwing en Bouwmomenten:</strong> titel, type verbouwing, datums, voortgang, verhalen, foto&apos;s, volgorde en zichtbaarheid.</li>
      <li><strong>Sociale gegevens:</strong> volgverzoeken en -relaties, reacties, emoji-reacties en meldingen.</li>
      <li><strong>Digitaal Bouwboek:</strong> titel, cover, geselecteerde Bouwmomenten, foto&apos;s, volgorde en opmaakvoorkeuren.</li>
      <li><strong>Feedback en printinteresse:</strong> je antwoorden en eventuele waardering. Printinteresse is alleen productonderzoek en legt jou of Buildy nergens op vast.</li>
      <li><strong>Support en meldingen:</strong> je bericht, antwoordadres, categorie, ontvangstcode en de informatie die nodig is om je verzoek te behandelen.</li>
      <li><strong>Techniek en beveiliging:</strong> IP-adres, tijdstip, aangevraagde route, browser- en apparaatgegevens, sessiegegevens, foutinformatie en beveiligingssignalen voor zover de dienst en infrastructuur die vastleggen.</li>
    </ul>
    <p>
      Foto&apos;s en verhalen kunnen ook gegevens bevatten van gezinsleden, bezoekers, buren
      of vakmensen. Deel geen gevoelige persoonsgegevens als dat niet nodig is en informeer
      herkenbare personen wanneer dat volgens de situatie nodig is.
    </p>

    <h2>3. Waarom verwerkt Buildy deze gegevens?</h2>
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th>Doel</th>
            <th>Gegevens</th>
            <th>Grondslag</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Google-login, profiel, verbouwingsverhaal en digitaal Bouwboek leveren</td>
            <td>Account-, profiel-, verbouwings-, media- en Bouwboekgegevens</td>
            <td>Uitvoering van de gebruikersovereenkomst</td>
          </tr>
          <tr>
            <td>Gekozen zichtbaarheid, delen, volgen, reacties en opmerkingen uitvoeren</td>
            <td>Profiel-, verbouwings-, deel- en sociale gegevens</td>
            <td>Uitvoering van de gebruikersovereenkomst</td>
          </tr>
          <tr>
            <td>Vrijwillige feedback en printinteresse onderzoeken</td>
            <td>Feedbackantwoorden en eventuele waardering</td>
            <td>Gerechtvaardigd belang om het product te verbeteren; deelname is optioneel</td>
          </tr>
          <tr>
            <td>Support, privacyverzoeken en meldingen behandelen</td>
            <td>Contact-, verzoek- en relevante inhoudsgegevens</td>
            <td>Uitvoering van je verzoek, gerechtvaardigd belang en waar nodig een wettelijke verplichting</td>
          </tr>
          <tr>
            <td>De dienst beveiligen, misbruik voorkomen en fouten onderzoeken</td>
            <td>Technische, account- en relevante inhoudsgegevens</td>
            <td>Gerechtvaardigd belang in een veilige en betrouwbare dienst</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2>4. Jouw zichtbaarheidskeuzes</h2>
    <p>
      Een verbouwing kan privé, alleen voor volgers, via een deel-link of openbaar zijn.
      Openbare inhoud kan zonder login zichtbaar zijn, door zoekmachines worden gevonden
      en buiten Buildy worden gedeeld of gecachet. Een deel-link is een toegangssleutel:
      iedereen die hem ontvangt kan hem doorsturen totdat de eigenaar hem intrekt. Een
      geaccepteerde volger krijgt alleen toegang binnen de zichtbaarheidskeuzes van de
      eigenaar.
    </p>
    <p>
      Let op wat op foto&apos;s en in verhalen herkenbaar is, zoals een huisnummer, document,
      sleutel of beveiligingsdetail. Een digitale toegangsregel kan niet voorkomen dat een
      toegelaten kijker zelf een kopie maakt.
    </p>

    <h2>5. Dienstverleners en ontvangers</h2>
    <p>Voor de actieve MVP zijn deze diensten voorzien:</p>
    <ul>
      <li><strong><a href="https://vercel.com/legal/dpa" target="_blank" rel="noreferrer">Vercel</a>:</strong> hosting van de webapp en serverfuncties, private Vercel Blob-opslag voor media en technische beveiligings- en requestlogs.</li>
      <li><strong><a href="https://neon.com/security" target="_blank" rel="noreferrer">Neon</a>:</strong> PostgreSQL-database voor accounts en productgegevens.</li>
      <li><strong>Google:</strong> OpenID Connect voor de Google-login die je zelf start.</li>
      <li><strong>Bevoegde adviseurs, toezichthouders of autoriteiten:</strong> alleen wanneer dat noodzakelijk of wettelijk verplicht is.</li>
    </ul>
    <p>
      Buildy verkoopt persoonsgegevens niet. De exploitant moet vóór publieke registratie
      de werkelijk gebruikte accounts, regio&apos;s, contracten, leveranciersrollen en
      subverwerkers controleren en documenteren.
    </p>

    <h2>6. Verwerking buiten de EER</h2>
    <p>
      Deze leveranciers of hun subverwerkers kunnen gegevens buiten de Europese
      Economische Ruimte verwerken. De exploitant moet de gekozen regio&apos;s en geldige
      doorgiftegronden vóór publieke registratie controleren. Waar een passend EU-
      beschermingsniveau ontbreekt, moeten passende waarborgen worden gebruikt, zoals
      standaardcontractbepalingen, en waar nodig aanvullende maatregelen.
    </p>

    <h2>7. Bewaartermijnen</h2>
    <ul>
      <li><strong>Account, profiel, verbouwing en sociale inhoud:</strong> zolang het account of de inhoud bestaat. Na een geldige verwijderaanvraag wordt verwijdering via de account-lifecycle verwerkt, behalve wat tijdelijk nodig is voor beveiliging, back-ups, een geschil of een wettelijke verplichting.</li>
      <li><strong>Feedback, support en meldingen:</strong> zolang dat nodig is om het bericht te behandelen, misbruik te voorkomen of aan een wettelijke verplichting te voldoen.</li>
      <li><strong>Sessies en technische logs:</strong> zolang dat nodig is voor login, beveiliging, foutonderzoek en misbruikpreventie.</li>
    </ul>
    <p>
      De exploitant moet de concrete maximale termijnen per systeem en doel nog bevestigen
      en publiceren. Kopieën die andere gebruikers zelf buiten Buildy hebben bewaard vallen
      niet onder de directe controle van Buildy.
    </p>

    <h2>8. Cookies en lokale opslag</h2>
    <p>
      Buildy gebruikt noodzakelijke HttpOnly-cookies voor de inlogsessie en, wanneer van
      toepassing, toegang via een deel-link. Deze cookies gebruiken SameSite=Lax en worden
      op HTTPS als Secure geplaatst. De actieve MVP gebruikt geen advertentie- of
      analyticscookies. De Google-inlogpagina valt ook onder het eigen privacy- en
      cookiebeleid van Google.
    </p>

    <h2>9. Beveiliging</h2>
    <p>
      Buildy gebruikt maatregelen die bij de risico&apos;s passen, waaronder server-side
      toegangscontrole, database-toegangsregels, private Blob-opslag en geautoriseerde
      levering van media. Het supportformulier slaat het antwoordadres en de berichtinhoud
      versleuteld op. Geen enkele online dienst kan absolute veiligheid garanderen. Meld
      een vermoeden van misbruik of een datalek via <Link to="/support">Support</Link>.
    </p>

    <h2>10. Jouw privacyrechten</h2>
    <p>
      Afhankelijk van de situatie heb je recht op inzage, correctie, verwijdering,
      beperking, overdraagbaarheid en bezwaar. Als verwerking op toestemming berust, kun
      je die voor de toekomst intrekken. Buildy neemt zelf geen uitsluitend
      geautomatiseerde besluiten met juridische of vergelijkbaar ingrijpende gevolgen.
    </p>
    <ul>
      <li>Je kunt profiel- en verbouwingsgegevens voor een groot deel zelf aanpassen.</li>
      <li>Je kunt via <em>Profiel &rsaquo; Account verwijderen</em> verwijdering van je account aanvragen.</li>
      <li>Andere verzoeken kun je via <Link to="/support">Support</Link> indienen. De wettelijke reactietermijn is in beginsel één maand; Buildy kan informatie vragen om je identiteit te controleren.</li>
      <li>Je kunt een klacht indienen bij de <a href="https://autoriteitpersoonsgegevens.nl" target="_blank" rel="noreferrer">Autoriteit Persoonsgegevens</a>.</li>
    </ul>

    <h2>11. Minderjarigen</h2>
    <p>
      Buildy is niet specifiek op kinderen gericht. Neem via Support contact op als je
      denkt dat zonder geldige reden persoonsgegevens van een minderjarige zijn verwerkt.
      De exploitant moet het definitieve leeftijdsbeleid vóór publieke registratie
      vaststellen.
    </p>

    <h2>12. Wijzigingen</h2>
    <p>
      Bovenaan staat de datum van deze versie. Bij een wezenlijke wijziging in de
      verwerking informeert Buildy betrokken gebruikers vooraf in de app wanneer dat
      redelijkerwijs mogelijk is.
    </p>
  </LegalLayout>
);

export default Privacy;
