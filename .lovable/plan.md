# Buildy → MVP-klaar

Doel: een app die *perfect werkt, veilig is en duidelijk waarde toevoegt*, met een professionele Polarsteps-achtige uitstraling. Hieronder de audit + voorstel in vier blokken. Branding-naam Buildy houden we (jij hebt nog input over slogan).

---

## 1. Issues uit de huidige app — fix vóór nieuwe testers

**Bugs**
- *Bevestigingsmail* heet nog "Trip-Tales" → mailtemplates aanpassen naar Buildy (kan zonder eigen domein, alleen template & from-name in Cloud auth-instellingen).
- *Onboarding-dialog* triggert ook op publieke routes / soms blank → alleen tonen op eigen dashboards & na 1 sec delay.
- *FollowButton / volgknoppen* staan soms dubbel (project volgen vs gebruiker volgen) — labels duidelijker maken ("Volg project" / "Volg gebruiker") en consistente styling.
- *Plattegrond-tab* toont een lege state als er geen plattegrond is — vervangen door upload-CTA i.p.v. lege witte ruimte.
- *Mobile spacing* op `TripDetail` header: titel + badges + knoppen lopen op smal scherm strak tegen elkaar (extra `gap` + line-height).
- *Notificatiebel* mist real-time refresh — Supabase realtime subscription op `notifications` toevoegen.
- *Lege staten* (geen vrienden, geen favorieten, geen updates) zijn nu kale tekst → uniforme empty-state component met illustratie + actie-CTA.

**Veiligheid & data**
- Linter draaien (`supabase--linter`) en alle warnings dichten.
- Storage bucket `trip-media` is public — OK voor publieke trips, maar privé-trips lekken hun media-URL's. Voorstel: bucket privé maken en signed URLs (1 uur) genereren voor privé-trips. Voor publieke trips blijven public URLs.
- Edge function `floorplan-blueprint` heeft nu geen rate-limit → simpele per-user throttle (max 10/uur) via een `ai_usage` tabel.
- Profiel-zoekfunctie laat alle e-mail-achtige `display_name`s zien — bij signup `display_name` ontdoen van e-mail fallback (vragen om naam tijdens onboarding, niet email als default).
- `is_private` profiel respecteren in álle views (timeline-auteurs, comment-auteurs, follower-lijsten).

**Performance**
- `Index.tsx` doet N+1 queries per project (3 per kaart). Vervangen door één RPC `get_discover_feed()` die counts en profielen meeneemt.
- Fotoboek laadt alle media in één keer → lazy-render per pagina (al gepland in `.lovable/plan.md`, nu uitvoeren).
- Images via `loading="lazy"` + `decoding="async"` overal in grids.

---

## 2. Nieuwe features die de MVP "af" maken

**A. Begroting vs realisatie (afmaken)**
Je had het idee al gegeven: per project een totaalbudget, per update kosten. Toevoegen:
- Doel-budget per fase (optioneel) → balk per fase met "binnen / over budget".
- Achteraf-reflectie: bij afsluiten van project één veld "waarom ben je eroverheen gegaan?" → toont als badge op de publieke begroting.

**B. PDF & document-vault per project**
Nu kun je PDF's per update uploaden. Voor verbouwingen heb je vaak losse documenten (offertes, vergunningen, garanties). Nieuwe tab "Documenten" met simpele lijst, tags, en optie "alleen voor mij" of "publiek".

**C. Aannemer/leverancier-register**
Klein veld bij elke update: "Wie deed dit werk?" (vrij tekstveld + optioneel link). Op projectpagina een sectie "Betrokken partijen" die deze auto-aggregeert. Heel waardevol voor andere verbouwers — Polarsteps-effect.

**D. Voor/na slider**
Per update of per ruimte: twee foto's, één slider om voor/na te vergelijken. Heel deelbaar.

**E. Deel-/embed-link**
Publieke deel-URL met OG-image (cover + titel) zodat het er op WhatsApp/IG goed uitziet. Vereist een edge-function die een dynamische OG-image maakt of een cached snapshot.

**F. Sociaal — minimale verbeteringen**
- Op profielpagina tabbladen "Projecten / Volgers / Volgend".
- In zoekresultaten: indicator "volgt jou", "wederzijds".
- Notificatie bij nieuwe volger.

---

## 3. Designrichting — Polarsteps-niveau

Polarsteps voelt rustig, redactioneel, foto-first. Onze huidige stijl is té "blueprint-thema" (oranje accent + gridlijnen). Voor een professionelere indruk:

```text
- Kalmer kleurenpalet:
   bg #FAFAF7 (warm wit), card #FFFFFF
   primary #0E1B2C (diepblauw-zwart, vervangt huidige navy)
   accent #D97757 (zachte terracotta i.p.v. fel oranje)
   muted-foreground #6B7280
- Typografie:
   headings: Fraunces (warmer dan Playfair, modern serif)
   body: Inter (cleaner dan DM Sans voor UI)
- Spacing & dichtheid:
   container max-w 1120px, generous whitespace, 24px grid
   card radius 16px, schaduwen heel subtiel (0 1px 2px /4%)
- Hero:
   foto-first hero (groot cover van uitgelichte projecten), geen blueprint-pattern op de homepage
- Cards:
   16:9 cover, titel groot, ondertitel ingetogen, één meta-rij; geen oranje badge bovenop
- Detailpagina:
   sticky breadcrumb-bar, grotere foto-rendering, redactionele tijdlijn (datum klein in marge, content groot)
- Iconen:
   lucide light variants, 1.5px stroke voor lichtere indruk
- Micro-interacties:
   hover-lift max 2px, image-zoom subtiel, page-transitions met fade
```

De huidige `blueprint-grid` blijven we gebruiken, maar alleen op placeholders en de plattegrond-tab — niet meer overal als achtergrond. De Buildy-identiteit blijft via de hammer-logo en het terracotta-accent.

Ik genereer hierna **3 design-richtingen** (rendered previews) voor de hero + projectkaart-grid, jij kiest er één en die rol ik door over alle pagina's.

---

## 4. Uitvoeringsvolgorde (sprints)

**Sprint 1 — Stabiliteit (geen nieuwe features)**
- Mail-branding fix · linter zero · storage signed URLs · N+1 fix · realtime notifs · empty states · mobile spacing.

**Sprint 2 — Design herziening**
- 3 design-directions tonen → keuze → tokens + typografie + Index/TripDetail/Photobook herstijlen.

**Sprint 3 — Featurewaarde**
- Budget-uitbreidingen · Documenten-vault · Aannemerregister.

**Sprint 4 — Sociaal & deelbaarheid**
- Voor/na slider · OG-image deel-link · profieltabs · zoek-indicatoren.

Na sprint 1+2 is de app klaar voor een nieuwe testronde; sprint 3+4 op basis van feedback.

---

## Vragen aan jou voordat ik begin

1. Akkoord met **deze volgorde** (eerst stabiliteit + design, dan features)?
2. Mag ik bij sprint 2 direct **3 design-richtingen** genereren in Polarsteps-stijl, of wil je eerst een palet/typografie kiezen?
3. Voor de begroting/aannemer/documenten-features: alle drie in sprint 3, of wil je er één eerst?
4. Eigen e-maildomein koppelen (echte from-adres `noreply@buildy.app` o.i.d.)? Anders blijft het Lovable-default, maar wel met titel "Buildy".
