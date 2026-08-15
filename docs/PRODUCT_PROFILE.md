# Product profile

Buildy gebruikt precies één server-owned productprofiel:

`PRODUCT_PROFILE=feedback_beta`

## Doel

Het profiel voorkomt dat frontend en backend verschillen over wat Buildy in de
publieke feedbackbèta wel en niet kan.

## Canonieke capabilities

Voor `feedback_beta` geldt:

- Google sign-in: aan
- e-maillogin: uit
- verbouwing aanmaken: aan
- bouwmomenten: aan
- Verhaal: aan
- Bouwboek-preview: aan
- sharing: aan
- feedback: aan
- accountverwijdering: aan
- checkout: uit
- Stripe: uit
- Peecho: uit
- transactionele e-mail als kernflow: uit

## Gewenst API-shape

De frontend hoort een veilige serverroute te lezen, bijvoorbeeld:

```json
{
  "profile": "feedback_beta",
  "capabilities": {
    "googleSignIn": true,
    "emailAuth": false,
    "renovations": true,
    "updates": true,
    "story": true,
    "photobookPreview": true,
    "sharing": true,
    "feedback": true,
    "accountDeletion": true,
    "checkout": false
  }
}
```

## Regels

- geen `VITE_SIMPLE_APP_MODE`
- geen client-owned capability truth
- productie mag geen testauth of checkout activeren
