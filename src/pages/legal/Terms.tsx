import { Link } from "@/lib/router";
import LegalLayout from "./LegalLayout";
import LegalPendingNotice from "./LegalPendingNotice";

const Terms = () => (
  <LegalLayout
    title="Algemene voorwaarden"
    description="De voorwaarden voor het gratis gebruik van Buildy en je digitale Bouwboek."
    updated="29 augustus 2026"
  >
    <LegalPendingNotice title="Exploitantgegevens nog vereist">
      <p>
        De exploitant moet vóór publieke registratie de juridische naam, het
        vestigingsadres, het KvK-nummer (als dat van toepassing is) en een rechtstreeks
        contactadres publiceren. Deze gegevens zijn nog niet aangeleverd. Tot die tijd is
        het publieke <Link to="/support">supportformulier</Link> de beschikbare
        contactroute; dit formulier vervangt de ontbrekende exploitantgegevens niet.
      </p>
    </LegalPendingNotice>

    <p>
      Deze voorwaarden gelden voor het gebruik van de gratis Buildy-MVP. Buildy helpt je
      een verbouwing vast te leggen in Bouwmomenten, het verhaal gecontroleerd te delen en
      daarvan een digitaal Bouwboek samen te stellen.
    </p>

    <h2>1. De dienst</h2>
    <p>
      Buildy is op dit moment een gratis digitale dienst. Een gedrukt Bouwboek kun je in
      deze versie niet kopen. Een vraag over interesse in een gedrukt Bouwboek is alleen
      productonderzoek: je reactie legt jou of Buildy nergens op vast.
    </p>

    <h2>2. Account en Google-login</h2>
    <ul>
      <li>Je logt uitsluitend in met Google. Buildy beheert geen eigen wachtwoord voor je.</li>
      <li>Je verstrekt juiste profielinformatie en beveiligt de toegang tot je Google-account.</li>
      <li>Je gebruikt geen account van een ander en probeert toegangscontroles niet te omzeilen.</li>
      <li>Je kunt via <em>Profiel &rsaquo; Account verwijderen</em> de verwijdering van je account aanvragen.</li>
    </ul>

    <h2>3. Jouw foto&apos;s, verhalen en reacties</h2>
    <p>
      Je behoudt de rechten op de foto&apos;s, tekst en andere inhoud die je plaatst. Je
      geeft Buildy alleen het niet-exclusieve en kosteloze gebruiksrecht dat technisch
      nodig is om die inhoud op te slaan, te beveiligen, volgens jouw keuzes te tonen en
      in jouw digitale Bouwboek te verwerken. Dit recht eindigt wanneer de inhoud wordt
      verwijderd, behalve voor tijdelijke back-ups of bewaring die wettelijk noodzakelijk
      is.
    </p>
    <p>
      Plaats alleen inhoud die je rechtmatig mag gebruiken en delen. Houd rekening met
      auteursrecht, portretrecht en de privacy van bewoners, buren, bezoekers en vakmensen.
    </p>

    <h2>4. Zichtbaarheid en delen</h2>
    <p>
      Een verbouwing kan <em>privé</em>, voor <em>volgers</em>, via een
      <em>deel-link</em> of <em>openbaar</em> zichtbaar zijn. Controleer deze keuze
      voordat je publiceert. Een deel-link werkt als toegangssleutel: iedereen die de link
      ontvangt kan hem doorsturen. Trek de link in als die niet meer gebruikt mag worden.
      Openbare inhoud kan buiten Buildy worden gedeeld, gecachet of door zoekmachines
      worden gevonden. Geen enkel online toegangsmechanisme kan voorkomen dat een
      toegelaten kijker zelf een kopie maakt.
    </p>

    <h2>5. Gedragsregels en meldingen</h2>
    <p>Het is niet toegestaan om:</p>
    <ul>
      <li>inbreuk te maken op auteursrecht, portretrecht, privacy of andere rechten;</li>
      <li>bedreigende, discriminerende, misleidende, strafbare of anderszins onrechtmatige inhoud te plaatsen;</li>
      <li>adresgegevens, toegangscodes of andere gevoelige informatie van anderen zonder geldige reden openbaar te maken;</li>
      <li>spam of schadelijke software te plaatsen of de werking en beveiliging van Buildy te verstoren.</li>
    </ul>
    <p>
      Buildy kan inhoud of een account beperken als dat redelijkerwijs nodig is voor de
      veiligheid, naleving van deze regels of een wettelijke verplichting. Als de situatie
      dat toelaat, krijgt de gebruiker uitleg en kan die via <Link to="/support">Support</Link>
      reageren. Bij direct gevaar bel je 112; Buildy is geen noodkanaal.
    </p>

    <h2>6. Digitaal Bouwboek en printinteresse</h2>
    <p>
      Het digitale Bouwboek wordt samengesteld uit de geselecteerde Bouwmomenten, foto&apos;s
      en instellingen. Controleer zelf de selectie, volgorde, uitsnede en tekst. Buildy
      belooft niet dat een digitale voorbeeldweergave zonder aanvullende controle geschikt
      is om professioneel te laten drukken. De optionele printinteressevragen zijn alleen
      feedback en leveren geen recht op een fysiek product, prijs of leverdatum op.
    </p>

    <h2>7. Beschikbaarheid en wijzigingen</h2>
    <p>
      Buildy is een MVP en kan worden verbeterd, gewijzigd of tijdelijk onderbroken. De
      dienst wordt zorgvuldig onderhouden, maar een ononderbroken of foutloze werking kan
      niet worden gegarandeerd. Bewaar daarom ook je oorspronkelijke foto&apos;s. Bij een
      wezenlijke nadelige wijziging informeert Buildy gebruikers vooraf in de app wanneer
      dat redelijkerwijs mogelijk is.
    </p>

    <h2>8. Aansprakelijkheid</h2>
    <p>
      Inhoud van andere gebruikers is een persoonlijke ervaring en geen professioneel
      bouwkundig, juridisch of financieel advies. Niets in deze voorwaarden sluit
      aansprakelijkheid uit die volgens dwingend recht niet mag worden uitgesloten. Voor
      het overige gelden de normale regels van het Nederlandse recht.
    </p>

    <h2>9. Contact, recht en geschillen</h2>
    <p>
      Vragen, privacyverzoeken en bezwaren kun je indienen via het publieke
      <Link to="/support"> supportformulier</Link>. Op deze voorwaarden is Nederlands
      recht van toepassing, zonder afbreuk te doen aan dwingende bescherming die volgens
      de wet voor jou geldt. Probeer een geschil eerst via Support op te lossen; daarna kan
      het worden voorgelegd aan de bevoegde rechter.
    </p>
  </LegalLayout>
);

export default Terms;
