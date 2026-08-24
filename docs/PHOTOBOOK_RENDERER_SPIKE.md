# Bouwboek renderer spike

> **HISTORISCHE TECHNISCHE SPIKE.** De PDFKit/canonical-documentkeuze blijft
> relevante renderercontext. De onderstaande Peecho-submit-, worker- en
> checkout-“vervolgstappen” zijn superseded: proof/checkout bestaat, fulfilment
> is uitsluitend handmatig en heeft geen Peecho API/env/callback/worker. Zie
> [`STRIPE_SETUP.md`](STRIPE_SETUP.md) en
> [`MANUAL_PEECHO_FULFILMENT.md`](MANUAL_PEECHO_FULFILMENT.md).

Datum van spike: 4 augustus 2026
Status: historische renderer-evidence; een fysieke proefdruk bij de nog te
selecteren handmatige drukker blijft een launchgate

## Besluit

Buildy rendert printproofs server-side met PDFKit vanuit één versioned `PhotobookDocument`. De editor toont exact dit opgeslagen paginamodel; hij maakt geen zelfstandig PDF-layoutmodel meer. Het bestaande client-side jsPDF-pad en de Peecho Print Button zijn uitsluitend legacy en mogen niet in de nieuwe checkout worden gebruikt.

De launch-SKU is hard begrensd tot `a4-landscape-hardcover-v1`: 297 × 210 mm,
RGB, 12 mm safe area, 300-DPI-doel en minimaal 24 even pagina's. De actuele
server-owned price matrix begrenst de toegestane maximum-pagecount per land/
approval en accepteert nooit een clientaanname of Peecho `offeringId`.

## Beoordeelde opties

| Optie | Uitkomst | Reden |
|---|---|---|
| Bestaande jsPDF-browserrenderer | Afgevallen | Browsergeheugen, twee onafhankelijke layouts, tijdelijke media-URL's en geen betrouwbare server-side approvalgrens. |
| `pdf-lib` + fontkit | Geschikt alternatief | Goede pure-JS API en custom-fontembedding, maar vereist extra fontconversie/registratie en meer eigen tekst-/streaminfrastructuur. |
| PDFKit | Gekozen | Node/Vercel-geschikt, ingebedde WOFF/WOFF2-fonts, exacte fontmetrics, RGB-vectoroutput en beheersbare streaming. |
| Chromium print-to-PDF | Afgevallen voor launch | Zwaardere runtime, grotere cold starts en meer CSS-/browservariatie dan nodig voor één gecontroleerde SKU. |

De keuze volgt de officiële PDFKit-mogelijkheden voor embedded TrueType/OpenType/WOFF/WOFF2-fonts. PDFKit en pdf-lib blijven adapterdetails: het canonical document en de immutable approvalgrens zijn providerneutraal.

## Gebouwde waarborgen

- Het document bevat versie, projectrevision, format, cover, hoofdstukken, pagina's, tekst- en fotoblokken, crop/focus, bronassetmanifest, printafmetingen, pagecount, waarschuwingen en een SHA-256 over canonical JSON.
- Tekstregels worden gemeten met exact dezelfde embedded Inter- en Instrument Serif-fontbytes als de PDF-renderer en daarna in het document vastgelegd.
- Elke originele foto wordt vóór render opnieuw op SHA-256, magic bytes, MIME en pixelafmetingen gecontroleerd.
- Sharp maakt per fotoblok een gecontroleerde RGB-crop op de werkelijk benodigde 300-DPI-afmetingen. GPS/EXIF is al verwijderd door de mediaworker.
- Lage effectieve DPI en extreme crops worden zichtbaar gemeld. Ontbrekende assets, ongeldige metadata, tekstoverflow en page-limitoverschrijding blokkeren de proof.
- PDF-metadata heeft vaste datums; twee renders van hetzelfde document, dezelfde fonts en dezelfde assets zijn in de huidige test byte-identiek.
- De renderuitkomst bevat afzonderlijke hashes voor document, PDF, fontset en geordende assetset.
- Alleen een revision die met precies deze waarden `ready` en daarna `approved` is geworden, mag later worden gelockt voor checkout.

## Gemeten lokale spike

De provider-vrije test genereert een 24-pagina A4-landscape-PDF met zes embedded fontvarianten. De synthetische 1200 × 800-bronfoto wordt opnieuw gehasht, gecropt, naar RGB-JPEG gerenderd en ingebed. De tweede render levert dezelfde PDF-SHA-256 en exact dezelfde bytes. Checks voor gewijzigde documentbytes, gewijzigde assetbytes en blokkerende preflightwaarschuwingen falen gesloten.

Dit is historisch technisch rendererbewijs, geen bewijs van printkwaliteit. Een
fysieke proefdruk bij de vooraf goedgekeurde, handmatig gebruikte drukker moet
nog bevestigen:

- gekozen productreferentie en daadwerkelijke min/max pagecount;
- cover-/rug-/bleedinterpretatie;
- kleur- en fontresultaat op papier;
- effectieve crops en leesbaarheid;
- maximale bestandsgrootte en ophaalduur;
- productie-, shipping- en herdrukflow.

## Huidige productionboundary

De actieve runtime maakt en lockt private proofs en bindt checkout aan de
document-/PDF-hash, assetset, goedkeuring en serverquote. Een admin leest na
geverifieerde betaling exact die private PDF opnieuw met size/SHA-controle en
plaatst hem daarna handmatig bij de gekozen drukker.

Een proofrequest verwerkt request-driven exact de aangevraagde revisie onder de
geïsoleerde photobookworkerrol. Zolang de revisie `rendering` is, kan de
owner-editorpoll dezelfde leased/idempotente verwerking begrensd hervatten. Er
is geen photobookcron of `CRON_SECRET`-afhankelijkheid voor deze capability.

Live checkout blijft uit totdat providerproduct, fysieke proefdruk, commerciële
prijs/seller/tax/terms en handmatige operationele flow zijn goedgekeurd en op
Preview bewezen. Er is geen Peecho-submit of andere automatische printcall.
