import express from 'express';
import { config } from './config.js';
import { startDiscord } from './discord.js';
import { log } from './log.js';
import { webhookHandler } from './webhook.js';

const app = express();

// Stripe signature verification needs the exact raw bytes, so this route must not use express.json().
app.post('/webhook', express.raw({ type: 'application/json' }), webhookHandler);

await startDiscord();
app.listen(config.port, () => {
  log(`[server] listening on http://localhost:${config.port}`);
});
