# Stripe → Discord Premium Role (test-mode demo)

Pay through a Stripe payment link → Premium role granted automatically.
Cancel the subscription → role removed.

## How it works
- Stripe signed webhooks (signature verified, duplicate events ignored)
- Access follows the product (metadata premium=true), not the payment link
- discord.js bot assigns or removes the role

## Screenshots
the images in the screenshots/ folder

## Setup
- **Stripe product:** add metadata `premium` = `true` to the product that grants access.
- **Payment link:** pass the buyer's Discord user ID as `client_reference_id`,
  e.g. `https://buy.stripe.com/test_xxx?client_reference_id=123456789012345678`.
- **Discord bot:** invite it with the `Manage Roles` permission, and drag the bot's
  role **above** the Premium role in Server Settings → Roles. No privileged intents needed.

## Run it
1. Copy .env.example to .env and fill in your keys
2. npm install && npm run dev
3. stripe listen --forward-to localhost:3000/webhook --events checkout.session.completed,checkout.session.async_payment_succeeded,customer.subscription.deleted
   (put the printed `whsec_...` into `STRIPE_WEBHOOK_SECRET`)

For production: `npm run build && npm start`.

## Notes
- Delayed payment methods (e.g. bank debits) grant the role on
  `checkout.session.async_payment_succeeded` instead of `checkout.session.completed`.
- `customer.subscription.deleted` finds the Discord user through the Checkout Session
  that created the subscription. The role is kept if the same Stripe customer still has
  another premium subscription that is active, trialing or past_due.
- Failed handlers return 500 and aren't marked as processed, so Stripe's retry gets handled.

## Known limitations
- **In-memory event store:** processed event IDs live in process memory (last 10,000).
  They're lost on restart and not shared between instances, so a redelivered event may be
  handled twice. It's harmless here because adding or removing a role is idempotent, but
  production should store them in a database or Redis.
- **Other-subscription check is per Stripe customer:** a buyer who pays again through a
  payment link may get a new Stripe customer, so their other premium subscription wouldn't
  be seen and cancelling one would remove the role.
