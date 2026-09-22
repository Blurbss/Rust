const express = require('express');
const path = require('path');
const config = require('./config');
const { dispatch } = require('./webhookHandlers');
const { updateFacecamOnCanvas } = require('./facecamPipeline');

function createServer() {
  const app = express();
  app.use(express.json());

  // The Rust plugin fetches the cropped facecam image from this URL when you
  // call POST /canvases/<netId>/image with a "url" pointing here.
  app.use('/facecam', express.static(path.join(__dirname, '..', 'public', 'facecam'), {
    maxAge: 0 // these are short-lived, always serve the current file
  }));

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

  // Manual trigger for testing the facecam pipeline without waiting on a real
  // in-game event, e.g.:
  //   POST /facecam/76561198000000000/224081304?key=<WEBHOOK_SECRET>
  app.post('/facecam/:steamId/:netId', verifySecret, async (req, res) => {
    const { steamId, netId } = req.params;
    const result = await updateFacecamOnCanvas(steamId, netId);
    res.status(result.ok ? 200 : 422).json(result);
  });

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  return app;
}

module.exports = { createServer };
