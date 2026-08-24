# Future Stripe and manual Peecho

> **SUPERSEDED.** Stripe Checkout en handmatige fulfilment zijn nu vereiste
> production-MVP-scope, geen toekomstidee. Zie
> [`STRIPE_SETUP.md`](../../STRIPE_SETUP.md) en
> [`MANUAL_PEECHO_FULFILMENT.md`](../../MANUAL_PEECHO_FULFILMENT.md).

Niet onderdeel van de feedbackbèta.

## Gewenste latere flow

1. gebruiker wil een echt Bouwboek
2. Stripe-betaling
3. Buildy-order ontstaat
4. founder downloadt print-PDF handmatig
5. founder bestelt handmatig via Peecho
6. founder werkt orderstatus handmatig bij

## Nu bewust niet doen

- geen publieke checkout
- geen Stripe-runtime in de feedbackbèta
- geen Peecho-API-runtime in de feedbackbèta
- geen automatische fulfilment

## Wat nu wel mag

- printinteresse meten
- brede prijsverwachting vragen
- documenteren welke operatorstappen later nodig zijn
