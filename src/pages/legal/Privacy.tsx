import LegalLayout from "./LegalLayout";
import LegalPendingNotice from "./LegalPendingNotice";

const Privacy = () => (
  <LegalLayout
    title="Privacyverklaring"
    description="Welke persoonsgegevens Buildy verwerkt, waarom, met wie, hoe lang en welke privacyrechten je hebt."
    updated="15 juli 2026"
  >
    <LegalPendingNotice title="Deze verklaring is nog niet gereed voor livegang">
      <p>
        De juridische identiteit en contactgegevens van de verwerkingsverantwoordelijke,
        de frontend-hosting, definitieve leveranciersrollen, verwerkingslocaties,
        doorgiftewaarborgen en enkele maximale bewaartermijnen zijn nog niet door de
        exploitant bevestigd. Registratie, AI-verwerking en verkoop moeten uitgeschakeld
        blijven totdat die gegevens hieronder concreet en controleerbaar zijn ingevuld.
      </p>
    </LegalPendingNotice>

    <p>
      Deze verklaring geldt voor bezoekers, accountgebruikers en kopers van een Bouwboek.
      Zij geldt ook als jouw persoonsgegevens voorkomen in inhoud die een Buildy-gebruiker
      heeft geplaatst, bijvoorbeeld op een foto of in een reactie. Buildy verwerkt alleen
      gegevens voor de hieronder beschreven doelen.
    </p>

    <h2>1. Wie is verantwoordelijk?</h2>
    <p>
      De onderneming die Buildy exploiteert is de verwerkingsverantwoordelijke voor de
      verwerking door het platform en de verkoop van Bouwboeken. Vóór livegang moeten hier
      de volledige juridische naam, het vestigingsadres en een rechtstreeks privacycontact
      worden gepubliceerd. Stripe en andere leveranciers kunnen voor sommige eigen
      wettelijke, beveiligings- of fraudedoelen daarnaast zelfstandig
      verwerkingsverantwoordelijke zijn.
    </p>

    <h2>2. Welke gegevens verwerkt Buildy?</h2>
    <ul>
      <li><strong>Account en profiel:</strong> gebruikers-id, e-mailadres, gekozen inlogmethode, weergavenaam, profielfoto, bio, globale locatie, privacykeuze en accountmomenten.</li>
      <li><strong>Projecten en updates:</strong> projecttitel en -omschrijving, type verbouwing, datums, voortgang, fases, ruimtes, update-tekst, foto's, video's, documenten, plattegronden, posities op een plattegrond en eventueel locatiegegevens.</li>
      <li><strong>Privé-projectinformatie:</strong> het ingevoerde projectadres, budgetten, kosten, uren en informatie of notities over uitvoerders. Deze velden hebben afzonderlijke toegangsbeperkingen.</li>
      <li><strong>Sociale gegevens:</strong> volgverzoeken en -relaties, favorieten, reacties, likes, emoji-reacties, vermeldingen en notificaties.</li>
      <li><strong>Bouwboek:</strong> opmaak- en selectievoorkeuren, uitgesloten media, titel en ondertitel, formaat, pagina-aantal en de tijdelijk gemaakte print-PDF.</li>
      <li><strong>Bestelling en betaling:</strong> order- en providerreferenties, e-mailadres, boekconfiguratie, bedragen, valuta, betaal- en fulfilmentstatus, trackinginformatie en klachtinformatie. Naam, telefoon-, factuur- en verzendgegevens worden in Stripe Checkout verzameld en voor productie en bezorging aan Peecho verstrekt. Buildy ontvangt geen volledige kaartgegevens.</li>
      <li><strong>Techniek en beveiliging:</strong> IP-adres, tijdstippen, aangevraagde pagina's, browser- en apparaatgegevens, sessie- en foutinformatie en beveiligingssignalen die Buildy of zijn infrastructuurleveranciers nodig hebben.</li>
      <li><strong>Contact:</strong> de inhoud en metadata van vragen, privacyverzoeken, meldingen over inhoud en klachten.</li>
    </ul>
    <p>
      Vermeld geen bijzondere of zeer gevoelige persoonsgegevens in openbare tekst of
      media als dat niet noodzakelijk is. Foto's en projectinformatie kunnen ook gegevens
      bevatten van gezinsleden, bezoekers, buren of uitvoerders. De gebruiker die deze
      inhoud plaatst, moet die personen waar nodig informeren en een geldige reden hebben
      om hun gegevens te delen.
    </p>

    <h2>3. Doelen en grondslagen</h2>
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
            <td>Account, projecten, editor en gekozen sociale functies leveren</td>
            <td>Account-, profiel-, project-, media- en sociale gegevens</td>
            <td>Uitvoering van de overeenkomst</td>
          </tr>
          <tr>
            <td>Bouwboek samenstellen, betalen, drukken, bezorgen en ondersteunen</td>
            <td>Bouwboek-, bestel-, contact-, betaal- en verzendgegevens</td>
            <td>Uitvoering van de koopovereenkomst</td>
          </tr>
          <tr>
            <td>Een plattegrond op jouw verzoek met AI omzetten naar een blauwdruk</td>
            <td>De gekozen plattegrond, afbeelding-URL en technische aanvraaggegevens</td>
            <td>Uitvoering van jouw uitdrukkelijke functieverzoek</td>
          </tr>
          <tr>
            <td>Dienst beveiligen, fraude en misbruik voorkomen, fouten onderzoeken en rechten verdedigen</td>
            <td>Technische, account-, betaal-, meldings- en relevante inhoudsgegevens</td>
            <td>Gerechtvaardigd belang in een veilige en betrouwbare dienst; waar nodig een wettelijke verplichting</td>
          </tr>
          <tr>
            <td>Financiële administratie, productveiligheid en bevoegde verzoeken uitvoeren</td>
            <td>Minimaal noodzakelijke order-, factuur-, klacht- en contactgegevens</td>
            <td>Wettelijke verplichting</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>
      Als Buildy later nieuwsbrieven, tracking of gepersonaliseerde reclame introduceert,
      wordt daarvoor vooraf een passende grondslag en, waar vereist, toestemming gevraagd.
      De huidige applicatiecode bevat geen advertentie- of analyticsintegratie.
    </p>

    <h2>4. Openbaar, privé en delen met andere gebruikers</h2>
    <p>
      Jij kiest of een profiel of project openbaar of privé is. Een openbaar project en de
      bijbehorende updates en media kunnen zonder login zichtbaar zijn, in zoekmachines
      verschijnen en buiten Buildy worden gedeeld of gecachet. Bij een privéproject kunnen
      alleen de eigenaar en geaccepteerde projectvolgers de projectinhoud bekijken. Het
      volgen van een profiel geeft niet automatisch toegang tot een privéproject.
    </p>
    <p>
      Een projectadres wordt afzonderlijk als privé-informatie opgeslagen. Let er wel op
      dat foto's, plattegronden, omschrijvingen, locatienamen of oudere coördinaten alsnog
      een woning of persoon herkenbaar kunnen maken. Controleer daarom vóór publicatie wat
      er in je media en teksten staat.
    </p>

    <h2>5. Dienstverleners en andere ontvangers</h2>
    <p>Buildy gebruikt of benadert op dit moment de volgende categorieën ontvangers:</p>
    <ul>
      <li><strong>Supabase:</strong> database, authenticatie, bestandsopslag en serverfuncties.</li>
      <li><strong>Google en de Lovable OAuth-broker:</strong> de gekozen Google-inlog, OAuth-doorverwijzing en uitgifte van sessietokens wanneer je zelf voor Google-login kiest.</li>
      <li><strong>Stripe:</strong> Checkout, betaling, betaalmethoden en fraudepreventie.</li>
      <li><strong>Peecho en zijn productie- en bezorgpartners:</strong> ontvangst van de tijdelijke print-PDF, ordergegevens, naam, e-mailadres en verzendadres voor druk en levering.</li>
      <li><strong>Lovable AI Gateway en de geconfigureerde Google Gemini-modeldienst:</strong> alleen wanneer je zelf de functie kiest om een plattegrond als AI-blauwdruk te laten genereren.</li>
      <li><strong>CARTO:</strong> kaarttegels wanneer je bewust de routekaart opent; daarbij ontvangt CARTO technische verbindingsgegevens en kan het bekeken kaartgebied blijken. De lettertypes en kaarticoontjes levert Buildy zelf.</li>
      <li><strong>Nog te benoemen hosting- en CDN-leverancier:</strong> levering van de frontend en bijbehorende technische logs.</li>
      <li><strong>Professionele adviseurs, toezichthouders of autoriteiten:</strong> alleen als dat noodzakelijk of wettelijk verplicht is.</li>
    </ul>
    <p>
      Buildy verkoopt persoonsgegevens niet en verstrekt ze niet aan derden voor hun eigen
      direct marketing. Vóór livegang moet per leverancier zijn vastgelegd welke rol die
      heeft, welke gegevens nodig zijn, welke subverwerkers worden gebruikt en welke
      contractuele privacyafspraken gelden.
    </p>

    <h2>6. Verwerking buiten de EER</h2>
    <p>
      Leveranciers of hun subverwerkers kunnen gegevens buiten de Europese Economische
      Ruimte verwerken. Vóór livegang moet Buildy de gekozen Supabase-regio, de werkelijke
      hostinglocatie en de locaties en doorgiftegronden van alle leveranciers controleren.
      Als gegevens naar een land zonder passend EU-beschermingsniveau gaan, moet Buildy een
      geldige doorgiftegrond gebruiken, zoals door de Europese Commissie vastgestelde
      standaardcontractbepalingen, en waar nodig aanvullende maatregelen treffen. Via het
      privacycontact kun je na publicatie informatie of een kopie van de toepasselijke
      waarborgen vragen.
    </p>

    <h2>7. Bewaartermijnen</h2>
    <ul>
      <li><strong>Account, profiel, projecten en sociale inhoud:</strong> zolang je account of de betreffende inhoud bestaat. Na een geldig verwijderverzoek verwijdert Buildy deze uit de actieve omgeving, behalve wat nog nodig is voor een lopende bestelling, een geschil of een wettelijke verplichting.</li>
      <li><strong>Tijdelijke Bouwboek-PDF:</strong> een geannuleerde of verlopen checkout wordt opgeruimd; na betaling wordt een verwijdermoment ingepland wanneer Peecho de bestelling als geleverd, geannuleerd of terugbetaald meldt. Vóór livegang moet de periodieke opruimtaak aantoonbaar zijn ingepland en daarnaast een maximale noodtermijn gelden als een providerstatus uitblijft.</li>
      <li><strong>Financiële basisgegevens:</strong> alleen de gegevens die onderdeel zijn van de fiscale administratie worden normaal zeven jaar bewaard. Een accountverwijdering wist deze wettelijke administratie niet.</li>
      <li><strong>Beveiligings-, back-up-, support- en klachtengegevens:</strong> de concrete maximale termijnen zijn nog niet vastgesteld en moeten vóór livegang per systeem en doel worden gepubliceerd.</li>
    </ul>
    <p>
      Gegevens die andere gebruikers buiten Buildy hebben opgeslagen en kopieën in caches
      van zoekmachines vallen niet onder de directe controle van Buildy. Buildy beperkt de
      verwerking tijdens verplichte bewaring tot het doel waarvoor bewaring nog nodig is.
    </p>

    <h2>8. Lokale opslag, cookies en externe onderdelen</h2>
    <p>
      Buildy bewaart de inlogsessie in de lokale opslag van je browser zodat je ingelogd
      kunt blijven. De huidige applicatiecode plaatst zelf geen advertentie- of
      analyticscookies. Externe pagina's en onderdelen, zoals Stripe Checkout en
      kaartdiensten, verwerken wel technische gegevens en kunnen onder hun eigen beleid
      noodzakelijke beveiligings- of voorkeurscookies gebruiken. Als Buildy later
      niet-noodzakelijke cookies of vergelijkbare tracking toevoegt, wordt vooraf een
      toestemmingskeuze aangeboden.
    </p>

    <h2>9. Beveiliging</h2>
    <p>
      Buildy gebruikt technische en organisatorische maatregelen die passen bij de risico's,
      waaronder toegangsregels in de database, afgeschermde opslag voor nieuwe projectmedia
      en tijdelijke ondertekende links voor print-PDF's. Alleen bevoegde dienstprocessen en
      gebruikers met de juiste toegang mogen gegevens benaderen. Geen enkele online dienst
      kan absolute veiligheid garanderen; meld een vermoeden van misbruik of een datalek
      direct via het nog te publiceren beveiligingscontact.
    </p>

    <h2>10. Jouw privacyrechten</h2>
    <p>
      Afhankelijk van de situatie heb je recht op inzage, correctie, verwijdering,
      beperking, overdraagbaarheid en bezwaar tegen verwerking op basis van een
      gerechtvaardigd belang. Als verwerking op toestemming berust, kun je die toestemming
      voor de toekomst intrekken. Buildy neemt zelf geen uitsluitend geautomatiseerde
      besluiten met juridische of vergelijkbaar ingrijpende gevolgen; Stripe kan voor
      betalingen wel eigen geautomatiseerde fraudepreventie gebruiken.
    </p>
    <ul>
      <li>Profiel- en projectgegevens kun je voor een groot deel zelf aanpassen.</li>
      <li>Je account kun je via <em>Account &rsaquo; Account verwijderen</em> verwijderen. Wettelijk te bewaren administratie en gegevens van een nog lopende bestelling kunnen daarvan zijn uitgezonderd.</li>
      <li>Andere verzoeken kun je indienen via het vóór livegang te publiceren privacycontact. Buildy reageert in beginsel binnen één maand en kan redelijke informatie vragen om je identiteit te controleren.</li>
      <li>Je kunt ook een klacht indienen bij de <a href="https://autoriteitpersoonsgegevens.nl/nl/over-privacy/wetten" target="_blank" rel="noreferrer">Autoriteit Persoonsgegevens</a> of naar de bevoegde rechter gaan.</li>
    </ul>

    <h2>11. Minderjarigen</h2>
    <p>
      Buildy richt zich op mensen die een woning verbouwen, maar de minimale leeftijd en
      bijbehorende verificatie zijn nog niet als productbeleid vastgesteld. Vóór livegang
      moet Buildy een leeftijdsgrens kiezen en technisch en operationeel regelen hoe met
      accounts of gegevens van minderjarigen wordt omgegaan. Tot die tijd mag de dienst niet
      gericht aan minderjarigen worden aangeboden.
    </p>

    <h2>12. Wijzigingen</h2>
    <p>
      Bij een wezenlijke wijziging in de verwerking informeert Buildy betrokken gebruikers
      vooraf via e-mail of in de app wanneer dat redelijkerwijs mogelijk is. Bovenaan staat
      altijd de datum van de actuele versie. Een nieuwe verwerking begint niet met
      terugwerkende kracht op basis van deze verklaring.
    </p>
  </LegalLayout>
);

export default Privacy;
