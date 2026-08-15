# Production release

## Volgorde

1. Bevestig het bestaande Vercel-project.
2. Bevestig de doel-Neon-database.
3. Bevestig backup of recovery point.
4. Deploy eerst een Preview met `PRODUCT_PROFILE=feedback_beta` en `CHECKOUT_MODE=off`.
5. Voer de kernflow op Preview uit met synthetische data.
6. Pas append-only migrations toe via het goedgekeurde proces.
7. Valideer migration ledger, schema en RLS.
8. Voer productiesmoketests uit.
9. Verwijder synthetische data veilig.
10. Leg commit, deployment-URL en bewijs vast.

## Harde stopcriteria

- geen groene CI
- geen groene database/RLS-verificatie
- geen werkende Google sign-in
- geen private mediaflow
- geen werkende accountverwijdering
- checkout niet uitgeschakeld
- Preview niet bewezen

## Branching

- maak geen automatische merge naar `main`
- maak een draft PR wanneer merge naar `main` de enige resterende stap is
