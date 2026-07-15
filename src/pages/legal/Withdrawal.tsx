import LegalLayout from "./LegalLayout";
import LegalPendingNotice from "./LegalPendingNotice";

const Withdrawal = () => (
  <LegalLayout
    title="Herroepingsrecht Bouwboek"
    description="Waarom voor een persoonlijk samengesteld Bouwboek geen wettelijke bedenktijd geldt en welke rechten je bij een gebrek wel hebt."
    updated="15 juli 2026"
  >
    <LegalPendingNotice title="Nog niet gereed voor echte bestellingen">
      <p>
        De maatwerkuitzondering hieronder is inhoudelijk van toepassing op het persoonlijke
        Bouwboek, maar de verkoper- en klachtcontactgegevens en het vrijwillige beleid vóór
        productie zijn nog niet door de exploitant ingevuld. Houd echte betalingen uit totdat
        die informatie op deze pagina en in de checkout klopt.
      </p>
    </LegalPendingNotice>

    <h2>Geen wettelijke bedenktijd voor dit maatwerk</h2>
    <p>
      Ieder Bouwboek wordt pas na jouw bestelling gemaakt uit de foto's, teksten, opmaak,
      het formaat en het aantal pagina's dat jij hebt gekozen. Het is dus geen
      geprefabriceerd standaardboek. Voor zo'n volgens individuele specificaties
      vervaardigd product geldt de uitzondering van{" "}
      <a
        href="https://wetten.overheid.nl/BWBR0005289/Boek6/Titeldeel5/Afdeling2b/Paragraaf3/Artikel230p/"
        target="_blank"
        rel="noreferrer"
      >
        artikel 6:230p, onderdeel f, onder 1, Burgerlijk Wetboek
      </a>.
    </p>
    <p>
      Je hoeft daarom niet uitdrukkelijk “afstand te doen” van een herroepingsrecht. Buildy
      vraagt vóór de bestelling wel om te bevestigen dat je begrijpt dat het om maatwerk
      gaat en dat voor deze koop geen wettelijke bedenktijd geldt. Controleer vóór betaling
      zorgvuldig de voorbeeldweergave en je bestel- en adresgegevens.
    </p>

    <h2>Wat als je direct na het bestellen een fout ziet?</h2>
    <p>
      Neem onmiddellijk contact op via de contactgegevens in de algemene voorwaarden. Als
      de productie technisch nog kan worden gestopt, kan Buildy vrijwillig proberen de
      bestelling te annuleren of aan te passen. Dit is geen garantie en geen wettelijk
      herroepingsrecht; zodra de productie is gestart kan een persoonlijk boek normaal
      gesproken niet meer worden gewijzigd.
    </p>

    <h2>Gebrek of transportschade: je rechten blijven gelden</h2>
    <p>
      De maatwerkuitzondering gaat alleen over annuleren omdat je van gedachten verandert.
      Zij beperkt de wettelijke garantie niet. Komt het Bouwboek beschadigd, onvolledig,
      verkeerd uitgevoerd of anders dan overeengekomen aan, meld dit dan binnen bekwame tijd
      na ontdekking bij Buildy. Een melding binnen twee maanden na ontdekking is bij een
      consumentenkoop in ieder geval tijdig. Voeg waar mogelijk je ordernummer en duidelijke
      foto's van het boek en de verpakking toe.
    </p>
    <p>
      Bij een gegronde klacht zorgt Buildy zonder kosten voor de wettelijke oplossing,
      doorgaans herstel of vervanging. Als dat onmogelijk is, niet binnen een redelijke tijd
      gebeurt of de wet daar anderszins recht op geeft, kan prijsvermindering of ontbinding
      en terugbetaling aan de orde zijn. Je hoeft hiervoor niet zelf met Peecho of de
      vervoerder te onderhandelen: Buildy is jouw aanspreekpunt als verkoper.
    </p>

    <h2>Andere producten of diensten</h2>
    <p>
      Deze pagina beschrijft alleen het persoonlijke fysieke Bouwboek. Als Buildy later
      niet-gepersonaliseerde producten of andere betaalde diensten aanbiedt, kan daarvoor
      wel een wettelijke bedenktijd gelden. De informatie bij dat aanbod moet dan aangeven
      hoe je die kunt uitoefenen.
    </p>
  </LegalLayout>
);

export default Withdrawal;
