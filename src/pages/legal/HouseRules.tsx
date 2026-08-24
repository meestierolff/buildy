import LegalLayout from "./LegalLayout";

const HouseRules = () => (
  <LegalLayout
    title="Huisregels"
    description="Praktische afspraken voor een veilige, respectvolle Buildy-community."
    updated="4 augustus 2026"
  >
    <p>Buildy werkt het prettigst als iedereen dezelfde eenvoudige afspraken volgt.</p>
    <ol>
      <li><strong>Deel bewust.</strong> Controleer wat een bezoeker in tekst, foto&apos;s en plattegronden kan herkennen.</li>
      <li><strong>Respecteer mensen.</strong> Reageer op de verbouwing, niet op de persoon, en accepteer een grens of verwijderverzoek.</li>
      <li><strong>Houd privé echt privé.</strong> Deel geen adressen, codes, financiële details of contactgegevens in openbare inhoud.</li>
      <li><strong>Gebruik eigen materiaal.</strong> Plaats alleen media en tekst die je mag gebruiken.</li>
      <li><strong>Wees eerlijk.</strong> Geen nepaccounts, misleiding, verborgen reclame of spam.</li>
      <li><strong>Meld zorgvuldig.</strong> Kies een passende reden en stuur alleen relevante context mee.</li>
    </ol>
    <h2>Veilig verbouwen</h2>
    <p>
      Berichten van andere gebruikers zijn persoonlijke ervaringen, geen professioneel
      bouwkundig, juridisch of financieel advies. Schakel voor constructie, elektra, gas,
      asbest en andere risicovolle werkzaamheden een passende deskundige in.
    </p>
    <h2>Een probleem?</h2>
    <p>
      Meld specifieke inhoud via de meldknop. Gebruik <a href="/support">Support</a> voor
      accountvragen, een verzoek van een derde of bezwaar. Bij direct gevaar gebruik je de
      officiële hulpdiensten; Buildy is geen noodkanaal.
    </p>
  </LegalLayout>
);

export default HouseRules;
