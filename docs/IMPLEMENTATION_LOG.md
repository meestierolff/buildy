# Implementatielog Buildy production relaunch

Dit log bevat alleen daadwerkelijk uitgevoerde werkzaamheden en verificaties. Providerstappen worden pas als voltooid gemarkeerd na echte API-, CLI- of dashboardverificatie.

## 2026-08-04 — fase 0: veilige baseline

### Repository en scope

- Startstatus gecontroleerd: schone `main`, gelijklopend met `origin/main`.
- Werkbranch `codex/buildy-production-relaunch` aangemaakt.
- Duurzame voortgang in `GOAL.md` gestart.
- De volledige aangehechte specificatie van 1.996 regels gelezen.
- Frontend/product, database/security en tests/operations parallel read-only geïnventariseerd.

### Werkelijk uitgevoerde checks

| Commando | Exit | Werkelijke uitkomst |
|---|---:|---|
| `bun run typecheck` | 0 | TypeScriptbaseline slaagt onder de huidige niet-strikte configuratie. |
| `bun run lint` | 0 | 0 errors, 149 waarschuwingen voor expliciete `any`-types. |
| `bun test` | 0 | Buns eigen runner: 60/60 tests geslaagd. Dit is niet de canonieke Vitest-gate. |
| `bun run test` | 1 | Vitest: 54 geslaagd, 6 mislukt; vier `file:`-URL-problemen en twee jsdom-Blobproblemen. |
| `bun run build` | 0 | Build slaagt; sitemapfetch viel terug, Browserslist is verouderd en chunks van circa 598 kB en 467 kB overschrijden de waarschuwinggrens. |
| `bunx playwright test` (sandbox) | 1 | Lokale testserver kon door sandboxbeleid niet luisteren op `127.0.0.1:8090`. |
| `bunx playwright test` (vóór browserinstallatie) | 1 | Alle 32 cases konden niet starten doordat Chromium ontbrak. |
| `bunx playwright install chromium` | 0 | Officiële bijpassende Chromium- en headless-shellruntime geïnstalleerd. |
| `bunx playwright test` (na installatie) | 1 | 26 geslaagd, 5 auth-afhankelijk overgeslagen, 1 echte productfailure: publieke medialightbox opent niet. |
| `bun audit` | 1 | 53 advisories: 1 critical, 25 high, 22 moderate en 5 low. |
| `bun run check:launch` | 1 | 10/13 oude-stackchecks slagen; domein/Google zijn niet bereikbaar en order-schema geeft HTTP 400. |
| `bun run audit:private-assets` | 2 | Niet uitvoerbaar zonder afgeschermde legacy service-role credential. |
| `bun run audit:social` | 2 | Niet uitvoerbaar zonder afgeschermde legacy service-role credential. |
| `curl -I https://buildy-log.lovable.app/` | 0 | Publieke referentie antwoordt HTTP 200. |
| `vercel whoami` | 0 | Vercel CLI is geauthenticeerd; repository is nog niet aan een project gekoppeld. |

### Visuele baseline

- Chromium heeft 102 screenshots gemaakt in `artifacts/baseline/`:
  - lokaal en de publieke live referentie;
  - 17 scenario's;
  - 390×844, 768×1024 en 1440×1000;
  - 102/102 captures zonder capturefailure.
- Er was geen veilige synthetische bestaande auth-storage-state. Owner-only scenario's tonen daarom bewust hun uitgelogde/toegangsstatus; ze gelden niet als bewijs van een geslaagde ingelogde flow.
- De live referentie gaf HTTP 200 maar renderde headless alleen een lege pagina met Lovable-badge.

### Belangrijkste aangetroffen P0's

- Canonieke Vitest-gate is rood en wordt door `bun test` gemaskeerd.
- Hardcoded Supabase-URL en publishable token in Vite-config kunnen een build stil tegen de oude gedeelde backend laten praten.
- 53 dependencyadvisories, inclusief critical/high runtime- en toolchainissues.
- Privéprofieltoegang is effectief symmetrisch en kan zonder expliciete goedkeuring lekken.
- Publieke legacy media en langlevende bearer-URLs voorkomen onmiddellijke privacy-intrekking.
- Een gehashte Bouwboek-PDF blijft door de eigenaar overschrijfbaar of verwijderbaar vóór fulfilment; het geprinte bestand hoeft dus niet overeen te komen met het goedgekeurde bestand.
- Project-/update-/accountverwijdering en storagecleanup zijn niet overal transactioneel of hervatbaar.
- De editorpreview en PDF-export zijn twee onafhankelijke renderers.
- Geen enkele vertical slice draait nog op Neon, Vercel API, R2 of Brevo.

### Externe status

- Vercel CLI: lokaal geauthenticeerd.
- Neon/R2/Brevo/Stripe/Peecho/Google targetcredentials: niet aangetroffen in procesomgeving of repository-envcontract.
- Geen provideractie of transactie uitgevoerd.
