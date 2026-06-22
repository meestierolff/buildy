import LegalLayout from "./LegalLayout";

const Privacy = () => (
  <LegalLayout
    title="Privacyverklaring"
    description="Hoe Buildy persoonsgegevens verwerkt: welke gegevens, waarvoor, hoe lang en jouw rechten."
    updated="22 juni 2026"
  >
    <p>
      Buildy verwerkt persoonsgegevens om jou een veilig platform te bieden om je
      verbouwingsproject te documenteren en om Bouwboek-bestellingen af te wikkelen.
      In deze verklaring leggen we uit welke gegevens we verwerken en waarom.
    </p>

    <h2>1. Welke gegevens we verwerken</h2>
    <ul>
      <li><strong>Accountgegevens:</strong> e-mailadres, weergavenaam, optionele profielfoto.</li>
      <li><strong>Project-inhoud:</strong> foto's, tekst, locaties en data die je zelf plaatst.</li>
      <li><strong>Bestelgegevens:</strong> verzendadres, factuurbedrag en betalingsstatus (geen kaartgegevens — die verwerkt Stripe).</li>
      <li><strong>Technische gegevens:</strong> apparaat-, browser- en sessie-informatie om de dienst te beveiligen en te verbeteren.</li>
    </ul>

    <h2>2. Waarvoor we ze gebruiken</h2>
    <ul>
      <li>Het leveren van het platform: account, projecten, volgers, notificaties.</li>
      <li>Het afhandelen van Bouwboek-bestellingen (betaling, druk, verzending).</li>
      <li>Beveiliging, fraudepreventie en het oplossen van technische problemen.</li>
      <li>Wettelijke verplichtingen (zoals bewaarplicht voor financiële administratie).</li>
    </ul>

    <h2>3. Verwerkers en delen met derden</h2>
    <p>We schakelen de volgende partijen in als verwerker:</p>
    <ul>
      <li><strong>Supabase</strong> — hosting van database, authenticatie en opslag.</li>
      <li><strong>Stripe</strong> — betaalverwerking.</li>
      <li><strong>Peecho</strong> — druk en verzending van Bouwboeken.</li>
      <li><strong>Lovable</strong> — hosting van de webapplicatie.</li>
    </ul>
    <p>
      We verkopen je gegevens niet en delen ze alleen met deze partijen voor zover
      noodzakelijk voor de dienst, of wanneer de wet ons daartoe verplicht.
    </p>

    <h2>4. Bewaartermijnen</h2>
    <ul>
      <li>Accountgegevens en projectinhoud: zolang je account bestaat. Bij verwijdering wissen we alles direct, inclusief je bestanden in de opslag.</li>
      <li>Bestelgegevens: 7 jaar (fiscale bewaarplicht).</li>
    </ul>

    <h2>5. Jouw rechten</h2>
    <p>Je hebt het recht op inzage, correctie, verwijdering, beperking en dataportabiliteit.</p>
    <ul>
      <li>Inzage en correctie kun je direct in je profiel doen.</li>
      <li>Verwijdering kun je via <em>Account &rsaquo; Verwijderen</em> in gang zetten.</li>
      <li>Voor overige verzoeken of een klacht kun je contact opnemen via het ondersteuningskanaal. Je hebt ook het recht een klacht in te dienen bij de Autoriteit Persoonsgegevens.</li>
    </ul>

    <h2>6. Cookies</h2>
    <p>
      We gebruiken alleen functionele cookies die nodig zijn voor het inloggen en het
      laten werken van de site. We zetten geen trackingcookies van derden.
    </p>

    <h2>7. Beveiliging</h2>
    <p>
      Alle verbindingen verlopen via HTTPS. Wachtwoorden worden gehasht opgeslagen en
      toegang tot data wordt afgedwongen via row-level security in de database.
    </p>

    <h2>8. Wijzigingen</h2>
    <p>
      Bij wezenlijke wijzigingen in deze verklaring informeren we je via e-mail of in-app.
    </p>
  </LegalLayout>
);

export default Privacy;
