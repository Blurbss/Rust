const express = require('express');
const config = require('./config');
const { dispatch } = require('./webhookHandlers');

function createServer() {
  const app = express();
  app.use(express.json());

  // Simple shared-secret check. The webhook URL you hand out is
  // https://yourdomain.com/webhook?key=<WEBHOOK_SECRET>
  // This is YOUR invented secret, separate from RUST_API_KEY (which is what
  // you send THEM when calling their /players, /chests, etc. endpoints).
  function verifySecret(req, res, next) {
    const key = req.query.key || req.headers['x-webhook-key'];
    if (!config.webhookSecret || key !== config.webhookSecret) {
      return res.status(401).json({ error: 'invalid or missing webhook key' });
    }
    next();
  }

  app.post('/webhook', verifySecret, (req, res) => {
    const envelope = req.body;

    if (!envelope || typeof envelope.event !== 'string' || !envelope.data) {
      return res.status(400).json({ error: 'malformed webhook payload' });
    }

    // Ack immediately, handle after — don't make the plugin wait on your logic.
    res.status(200).json({ ok: true });

    try {
      dispatch(envelope);
    } catch (err) {
      console.error(`[webhook] handler error for "${envelope.event}":`, err);
    }
  });

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  return app;
}

module.exports = { createServer };
