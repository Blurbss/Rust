const express = require('express');
const path = require('path');
const config = require('./config');
const { dispatch } = require('./webhookHandlers');
const { updateFacecamOnCanvas } = require('./facecamPipeline');
const buttonFrameGrab = require('./features/buttonFrameGrab');
const canvasImageUpload = require('./features/canvasImageUpload');
const canvasShield = require('./features/canvasShield');
const domeOfSilence = require('./features/domeOfSilence');
const deathCam = require('./features/deathCam');
const gadgetUsage = require('./gadgetUsage');
const { listenToStream } = require('./streamListen');

function createServer() {
  const app = express();
  app.use(express.json());

  // Generic: any feature's hosted images (facecam, framegrab, deathcam,
  // canvas-shield, ...) land under public/<subdir>/ via imageHost.writeAndHost
  // and are all served from here — no need to add a new static mount every
  // time a feature introduces a new subdir.
  app.use(express.static(path.join(__dirname, '..', 'public'), {
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

  // ---------------------------------------------------------------------
  // MANUAL TRIGGERS — all plain GET requests behind ?key=<WEBHOOK_SECRET>,
  // deliberately: a GET is the easiest possible thing to bind to a hotkey
  // tool or Stream Deck button (just "open this URL"), no request body,
  // no typing mid-game. Each one falls back to its configured default
  // canvas netId so you don't have to remember/type one every time — pass
  // ?netId=... to override.
  // ---------------------------------------------------------------------

  // Facecam pipeline (face-detected crop). Kept at its original path for
  // backward compatibility with the test command from earlier — everything
  // NEW lives under /manual/.
  app.post('/facecam/:steamId/:netId', verifySecret, async (req, res) => {
    const { steamId, netId } = req.params;
    const result = await updateFacecamOnCanvas(steamId, netId);
    res.status(result.ok ? 200 : 422).json(result);
  });

  // Button-activated frame grab — SAME face-detection pipeline as facecam,
  // just callable manually. No once-per-person limit on this generic route.
  //   GET /manual/frame-grab/76561198000000000?key=...
  //   GET /manual/frame-grab/76561198000000000?netId=224081304&key=...
  app.get('/manual/frame-grab/:steamId', verifySecret, async (req, res) => {
    const netId = req.query.netId || config.canvases.buttonFrameGrab;
    if (!netId) return res.status(400).json({ error: 'no netId given and CANVAS_NETID_BUTTON_FRAME_GRAB not set' });
    const result = await buttonFrameGrab.triggerButtonFrameGrab(req.params.steamId, netId);
    res.status(result.ok ? 200 : 422).json(result);
  });

  // Photo booth and security system: both use the exact same underlying
  // face-detection call as above, but each enforces its OWN independent
  // once-per-person limit via gadgetName.
  //   GET /manual/photo-booth/76561198000000000?key=...
  app.get('/manual/photo-booth/:steamId', verifySecret, async (req, res) => {
    const netId = req.query.netId || config.canvases.photoBooth;
    if (!netId) return res.status(400).json({ error: 'no netId given and CANVAS_NETID_PHOTO_BOOTH not set' });
    const result = await buttonFrameGrab.triggerButtonFrameGrab(req.params.steamId, netId, { gadgetName: 'photo-booth' });
    res.status(result.ok ? 200 : result.alreadyUsed ? 409 : 422).json(result);
  });
  //   GET /manual/security-system/76561198000000000?key=...
  app.get('/manual/security-system/:steamId', verifySecret, async (req, res) => {
    const netId = req.query.netId || config.canvases.securitySystem;
    if (!netId) return res.status(400).json({ error: 'no netId given and CANVAS_NETID_SECURITY_SYSTEM not set' });
    const result = await buttonFrameGrab.triggerButtonFrameGrab(req.params.steamId, netId, { gadgetName: 'security-system' });
    res.status(result.ok ? 200 : result.alreadyUsed ? 409 : 422).json(result);
  });

  // Check/reset a gadget's usage for a specific person — mainly for testing
  // so "already used" doesn't block you while you're setting things up.
  //   GET /manual/gadget-usage/photo-booth/76561198000000000?key=...
  //   GET /manual/gadget-usage/photo-booth/76561198000000000/reset?key=...
  app.get('/manual/gadget-usage/:gadgetName/:steamId', verifySecret, (req, res) => {
    res.json({ used: gadgetUsage.hasUsed(req.params.gadgetName, req.params.steamId) });
  });
  app.get('/manual/gadget-usage/:gadgetName/:steamId/reset', verifySecret, (req, res) => {
    gadgetUsage.resetUsage(req.params.gadgetName, req.params.steamId);
    res.json({ ok: true });
  });

  // Canvas image upload — paint an arbitrary URL.
  // Canvas image upload — paint an arbitrary URL to an arbitrary canvas.
  // Deliberately no default netId here: you always specify which canvas.
  //   GET /manual/canvas-image?netId=224081304&url=https://...&key=...
  app.get('/manual/canvas-image', verifySecret, async (req, res) => {
    if (!req.query.netId) return res.status(400).json({ error: 'missing ?netId=' });
    if (!req.query.url) return res.status(400).json({ error: 'missing ?url=' });
    const result = await canvasImageUpload.uploadImageToCanvas(req.query.netId, req.query.url);
    res.status(result.ok ? 200 : 422).json(result);
  });

  // Canvas shield.
  //   GET /manual/canvas-shield?key=...
  app.get('/manual/canvas-shield', verifySecret, async (req, res) => {
    const netId = req.query.netId || config.canvases.canvasShield;
    if (!netId) return res.status(400).json({ error: 'no netId given and CANVAS_NETID_CANVAS_SHIELD not set' });
    const result = await canvasShield.activateCanvasShield(netId);
    res.status(result.ok ? 200 : 422).json(result);
  });

  // Dome of Silence arm/disarm/status.
  //   GET /manual/dome/arm?key=...
  //   GET /manual/dome/disarm?key=...
  //   GET /manual/dome/status?key=...
  app.get('/manual/dome/arm', verifySecret, async (req, res) => {
    const result = await domeOfSilence.arm();
    res.status(result.ok ? 200 : 422).json(result);
  });
  app.get('/manual/dome/disarm', verifySecret, async (req, res) => {
    const result = await domeOfSilence.disarm();
    res.status(result.ok ? 200 : 422).json(result);
  });
  app.get('/manual/dome/status', verifySecret, (req, res) => {
    res.json({ armed: domeOfSilence.isArmed() });
  });

  // Stream listen — blocks up to maxDurationMs waiting for a transcript or
  // keyword match, so this is a slow manual call by design (only as fast as
  // however long you tell it to listen).
  //   GET /manual/stream-listen/76561198000000000?keyword=push&maxDurationMs=10000&key=...
  app.get('/manual/stream-listen/:steamId', verifySecret, async (req, res) => {
    const opts = {};
    if (req.query.keyword) opts.keyword = req.query.keyword;
    if (req.query.maxDurationMs) opts.maxDurationMs = Number(req.query.maxDurationMs);
    const result = await listenToStream(req.params.steamId, opts);
    res.status(result.ok ? 200 : 422).json(result);
  });

  // Death counter status (the counter itself increments automatically off
  // player_death events — see webhookHandlers.js — this just reads it).
  //   GET /manual/death-counter?key=...
  app.get('/manual/death-counter', verifySecret, (req, res) => {
    res.json({ landmineDeaths: deathCam.getLandmineDeathCount() });
  });

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  return app;
}

module.exports = { createServer };
