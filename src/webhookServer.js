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
const rustApi = require('./rustPluginClient');
const voiceMap = require('./voiceMap');
const { playTTS } = require('./features/ttsAudio');
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

  // Dome of Silence arm/disarm/status — now per named zone, so you can run
  // several independent VOIP detection zones at once.
  //   GET /manual/dome/arm/base?key=...
  //   GET /manual/dome/arm/outpost?radius=15&switchEntityId=99999&key=...
  //   GET /manual/dome/disarm/base?key=...
  //   GET /manual/dome/status?key=...          (lists all armed zones)
  //   GET /manual/dome/status/base?key=...      (checks one specific zone)
  app.get('/manual/dome/arm/:zoneName', verifySecret, async (req, res) => {
    const opts = {};
    if (req.query.radius) opts.radius = Number(req.query.radius);
    if (req.query.switchEntityId) opts.switchEntityId = req.query.switchEntityId;
    const result = await domeOfSilence.arm(req.params.zoneName, opts);
    res.status(result.ok ? 200 : 422).json(result);
  });
  app.get('/manual/dome/disarm/:zoneName', verifySecret, async (req, res) => {
    const result = await domeOfSilence.disarm(req.params.zoneName);
    res.status(result.ok ? 200 : 422).json(result);
  });
  app.get('/manual/dome/status', verifySecret, (req, res) => {
    res.json({ armedZones: domeOfSilence.listArmedZones() });
  });
  app.get('/manual/dome/status/:zoneName', verifySecret, (req, res) => {
    res.json({ armed: domeOfSilence.isArmed(req.params.zoneName) });
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

  // ---------------------------------------------------------------------
  // NEW API SURFACE (added via Discord announcement) — raw pass-throughs
  // to rustPluginClient, for testing rather than tied to a specific feature.
  // ---------------------------------------------------------------------

  // Richer player info. Response shape is UNCONFIRMED here — the
  // announcement linked a screenshot, not text. This route exists so you can
  // hit it and see the real fields for yourself.
  //   GET /manual/player-info/<steamId>?key=...
  app.get('/manual/player-info/:steamId', verifySecret, async (req, res) => {
    try {
      res.json(await rustApi.getPlayer(req.params.steamId));
    } catch (err) {
      res.status(422).json({ ok: false, reason: err.message });
    }
  });

  // Player-attached canvas (static or spinning) and its removal.
  //   GET /manual/player-canvas/<steamId>?url=...&key=...
  //   GET /manual/player-canvas/<steamId>?url=...&spinning=true&count=4&spinSpeed=45&distance=2&key=...
  //   GET /manual/player-canvas/<steamId>/remove?key=...
  app.get('/manual/player-canvas/:steamId', verifySecret, async (req, res) => {
    if (!req.query.url) return res.status(400).json({ error: 'missing ?url=' });

    const opts = { url: req.query.url };
    if (req.query.raw !== undefined) opts.raw = req.query.raw === 'true';
    if (req.query.distance !== undefined) opts.distance = Number(req.query.distance);
    if (req.query.prefab !== undefined) opts.prefab = req.query.prefab;
    if (req.query.spinning !== undefined) opts.spinning = req.query.spinning === 'true';
    if (req.query.count !== undefined) opts.count = Number(req.query.count);
    if (req.query.spinSpeed !== undefined) opts.spinSpeed = Number(req.query.spinSpeed);

    try {
      res.status(201).json(await rustApi.attachPlayerCanvas(req.params.steamId, opts));
    } catch (err) {
      res.status(422).json({ ok: false, reason: err.message });
    }
  });
  app.get('/manual/player-canvas/:steamId/remove', verifySecret, async (req, res) => {
    try {
      res.json(await rustApi.removePlayerCanvas(req.params.steamId));
    } catch (err) {
      res.status(422).json({ ok: false, reason: err.message });
    }
  });

  // One-time proximity audio. This is the one manual route that ISN'T GET —
  // it needs an actual audio file as the request body, so it can't be a bare
  // hotkey URL. express.raw() is scoped to just this route so the audio
  // bytes don't get mangled by the global express.json() parser.
  //   curl -X POST "https://.../manual/play-audio?x=0&y=0&z=0&range=50&key=..." --data-binary @clip.mp3
  app.post(
    '/manual/play-audio',
    verifySecret,
    express.raw({ type: '*/*', limit: '32mb' }),
    async (req, res) => {
      const { x, y, z, range } = req.query;
      if (x === undefined || y === undefined || z === undefined) {
        return res.status(400).json({ error: 'missing ?x=&y=&z=' });
      }
      if (!req.body || !req.body.length) {
        return res.status(400).json({ error: 'missing audio body' });
      }
      try {
        const result = await rustApi.playAudioAt(
          req.body,
          Number(x),
          Number(y),
          Number(z),
          range !== undefined ? Number(range) : undefined
        );
        res.status(202).json(result);
      } catch (err) {
        res.status(422).json({ ok: false, reason: err.message });
      }
    }
  );

  // Curse — genuinely undocumented beyond the endpoint existing. No known
  // request/response shape, so this is exploratory: hit it and see what
  // comes back before building anything on top of it.
  //   GET /manual/curse/<steamId>?key=...
  //   GET /manual/curse/<steamId>/remove?key=...
  app.get('/manual/curse/:steamId', verifySecret, async (req, res) => {
    try {
      res.json(await rustApi.curseSet(req.params.steamId, undefined));
    } catch (err) {
      res.status(422).json({ ok: false, reason: err.message });
    }
  });
  app.get('/manual/curse/:steamId/remove', verifySecret, async (req, res) => {
    try {
      res.json(await rustApi.curseClear(req.params.steamId));
    } catch (err) {
      res.status(422).json({ ok: false, reason: err.message });
    }
  });

  // One-shot TTS: generate speech, apply pitch-down/reverb, play it at a
  // coordinate OR at a player (movement-aware — projects ahead of them if
  // they're actually traveling; see config.js's tts section for why that
  // needs two position samples rather than trusting a single snapshot).
  //   GET /manual/tts?text=hello&x=100&y=0&z=200&key=...
  //   GET /manual/tts?text=hello&steamId=76561198000000000&key=...
  //   GET /manual/tts?text=hello&steamId=...&voice=pirate&key=...
  //   GET /manual/tts?text=hello&steamId=...&reverb=false&pitchDown=false&range=50&key=...
  app.get('/manual/tts', verifySecret, async (req, res) => {
    if (!req.query.text) return res.status(400).json({ error: 'missing ?text=' });

    let target;
    if (req.query.steamId) {
      target = { steamId: req.query.steamId };
    } else if (req.query.x !== undefined && req.query.y !== undefined && req.query.z !== undefined) {
      target = { x: Number(req.query.x), y: Number(req.query.y), z: Number(req.query.z) };
    } else {
      return res.status(400).json({ error: 'need either ?steamId= or ?x=&y=&z=' });
    }

    const opts = {};
    if (req.query.pitchDown !== undefined) opts.pitchDown = req.query.pitchDown === 'true';
    if (req.query.reverb !== undefined) opts.reverb = req.query.reverb === 'true';
    if (req.query.range !== undefined) opts.range = Number(req.query.range);
    if (req.query.voice) opts.voiceName = req.query.voice;
    if (req.query.voiceId) opts.voiceId = req.query.voiceId;

    const result = await playTTS(req.query.text, target, opts);
    res.status(result.ok ? 200 : 422).json(result);
  });

  //   GET /manual/voices?key=...
  app.get('/manual/voices', verifySecret, (req, res) => {
    res.json({ voices: voiceMap.listVoiceNames() });
  });

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  return app;
}

module.exports = { createServer };
