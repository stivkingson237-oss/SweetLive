# Sweet Live

Application web Sweet Live.

## Développement

`npm install`

`npm run dev`

## Production

`npm run build`

Le projet est prévu pour être déployé sur Vercel.

## Paiements Sweet Live — Notch Pay

Le flux cadeaux utilise deux Edge Functions Supabase :
- Création/charge Mobile Money : `notchpay-create-gift`
- Webhook : `notchpay-gift-webhook`

URL webhook à enregistrer dans Notch Pay :
`https://gylizczvegxatcjfhbse.supabase.co/functions/v1/notchpay-gift-webhook`

Secrets à ajouter dans Supabase Edge Functions :
- `NOTCHPAY_API_KEY`
- `NOTCHPAY_WEBHOOK_HASH`

Ne mets jamais ces secrets dans le code React ou dans GitHub.
