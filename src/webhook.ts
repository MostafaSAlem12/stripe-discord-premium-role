import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { config } from './config.js';
import { addPremiumRole, removePremiumRole } from './discord.js';
import { log, logError } from './log.js';

const stripe = new Stripe(config.stripeSecretKey);

// Discord user IDs are snowflakes: 17–20 digit integers.
const DISCORD_ID = /^\d{17,20}$/;

// In-memory dedupe. Fine for a single-process demo; use a DB/Redis in production
// so it survives restarts and works across instances.
const MAX_REMEMBERED = 10_000;
const processed = new Set<string>();
const inFlight = new Set<string>();

function remember(eventId: string): void {
  processed.add(eventId);
  if (processed.size > MAX_REMEMBERED) {
    // Sets iterate in insertion order, so this drops the oldest ID.
    processed.delete(processed.values().next().value!);
  }
}

function isPremium(product: Stripe.Product | Stripe.DeletedProduct | string | null | undefined): boolean {
  return typeof product === 'object' && product !== null && !product.deleted && product.metadata.premium === 'true';
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.client_reference_id;
  if (!userId || !DISCORD_ID.test(userId)) {
    log(`[stripe] session ${session.id} has no valid client_reference_id (${userId ?? 'none'}); skipping`);
    return;
  }

  // Delayed payment methods complete checkout before the money arrives;
  // checkout.session.async_payment_succeeded follows once it does.
  if (session.payment_status === 'unpaid') {
    log(`[stripe] session ${session.id} is unpaid; waiting for async_payment_succeeded`);
    return;
  }

  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
    expand: ['data.price.product'],
  });
  if (!lineItems.data.some((item) => isPremium(item.price?.product))) {
    log(`[stripe] session ${session.id} has no product with metadata premium=true; skipping`);
    return;
  }

  await addPremiumRole(userId, `Stripe checkout ${session.id}`);
}

async function hasPremiumProduct(subscription: Stripe.Subscription): Promise<boolean> {
  const products = await Promise.all(
    subscription.items.data.map((item) => {
      const product = item.price.product;
      return typeof product === 'string' ? stripe.products.retrieve(product) : product;
    }),
  );
  return products.some(isPremium);
}

const STILL_ENTITLED: Stripe.Subscription.Status[] = ['active', 'trialing', 'past_due'];

async function hasOtherPremiumSubscription(subscription: Stripe.Subscription): Promise<boolean> {
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
  for await (const other of stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })) {
    if (other.id === subscription.id || !STILL_ENTITLED.includes(other.status)) continue;
    if (await hasPremiumProduct(other)) {
      log(`[stripe] customer ${customerId} still has premium subscription ${other.id} (${other.status})`);
      return true;
    }
  }
  return false;
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  if (!(await hasPremiumProduct(subscription))) {
    log(`[stripe] subscription ${subscription.id} has no premium product; skipping`);
    return;
  }

  // The subscription itself doesn't carry the Discord ID; the Checkout Session that created it does.
  const sessions = await stripe.checkout.sessions.list({ subscription: subscription.id, limit: 1 });
  const userId = sessions.data[0]?.client_reference_id;
  if (!userId || !DISCORD_ID.test(userId)) {
    log(`[stripe] no Discord user found for subscription ${subscription.id}; skipping`);
    return;
  }

  if (await hasOtherPremiumSubscription(subscription)) {
    log(`[stripe] role kept: another premium subscription is active (user ${userId})`);
    return;
  }

  await removePremiumRole(userId, `Stripe subscription ${subscription.id} deleted`);
}

export async function webhookHandler(req: Request, res: Response): Promise<void> {
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body as Buffer,
      req.headers['stripe-signature'] as string,
      config.stripeWebhookSecret,
    );
  } catch (err) {
    logError(`[stripe] signature verification failed: ${(err as Error).message}`);
    res.status(400).send('Invalid signature');
    return;
  }

  log(`[stripe] received ${event.type} ${event.id}`);

  if (processed.has(event.id) || inFlight.has(event.id)) {
    log(`[stripe] duplicate event ${event.id}; ignoring`);
    res.json({ received: true, duplicate: true });
    return;
  }

  inFlight.add(event.id);
  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await handleCheckoutCompleted(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      default:
        log(`[stripe] unhandled event type ${event.type}`);
    }
    remember(event.id);
    res.json({ received: true });
  } catch (err) {
    // Not marked as processed, so Stripe's retry will be handled.
    logError(`[stripe] failed to handle ${event.type} ${event.id}:`, err);
    res.status(500).send('Webhook handler failed');
  } finally {
    inFlight.delete(event.id);
  }
}
