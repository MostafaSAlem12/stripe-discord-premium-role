# Stripe → Discord Premium Role (test-mode demo)

Pay through a Stripe payment link → Premium role granted automatically.
Cancel the subscription → role removed.

## How it works
- Stripe signed webhooks (signature verified, duplicate events ignored)
- Access follows the product (metadata premium=true), not the payment link
- discord.js bot assigns or removes the role

## Screenshots
[the 4–5 screenshots]

## Run it
1. Copy .env.example to .env and fill in your keys
2. npm install && npm run dev
3. stripe listen --forward-to localhost:3000/webhook
