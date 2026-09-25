require("dotenv").config();

function required(name, fallback) {
  const raw = process.env[name];
  const val = raw === undefined || raw === "" ? fallback : raw;
  if (val === undefined || val === "") {
    console.warn(`[config] Warning: ${name} is not set`);
  }
  return val;
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  webhookSecret: required("WEBHOOK_SECRET"),

  rustApi: {
    baseUrl: required("RUST_API_BASE_URL"),
    apiKey: required("RUST_API_KEY"),
  },

  rustPlus: {
    serverIp: process.env.RUSTPLUS_SERVER_IP || "",
    serverPort: process.env.RUSTPLUS_SERVER_PORT || "",
    playerId: process.env.RUSTPLUS_PLAYER_ID || "",
    playerToken: process.env.RUSTPLUS_PLAYER_TOKEN || "",
  },

  azure: {
    key: process.env.AZURE_KEY || "",
    region: process.env.AZURE_REGION || "centralus",
  },

  // Public URL this app is reachable at (through nginx), used to build the
  // hosted image URL handed to /canvases/<netId>/image. Matches the /rust
  // location prefix from your nginx config.
  publicBaseUrl: required("PUBLIC_BASE_URL", "https://blurbsttv.com/rust"),

  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    // "low" is faster/cheaper but downsamples internally before analysis, which
    // can make coordinate accuracy worse. If clamped/rejected boxes are common
    // in your logs, try "high" — costs more latency for better spatial accuracy.
    imageDetail: process.env.OPENAI_IMAGE_DETAIL || "low",
  },

  stream: {
    // Comma-separated fallback chain streamlink will try in order. Lower
    // resolutions resolve/transfer faster but give the vision model less to
    // work with for finding a small facecam overlay — tune to taste.
    quality: process.env.STREAM_QUALITY || "480p,worst",
    resolveTimeoutMs: Number(process.env.STREAM_RESOLVE_TIMEOUT_MS) || 6000,
    ffmpegTimeoutMs: Number(process.env.STREAM_FFMPEG_TIMEOUT_MS) || 6000,
  },

  facecamCrop: {
    // Crop window = model's rough size estimate * this multiplier, then
    // bounded to [minFraction, maxFraction] of the frame's respective
    // dimension — absorbs both center-point error and a wrong size guess
    // without needing a precise box. Bumped generous by default since an
    // underestimated width/height is a common failure mode and extra
    // background in the crop is a cheap tradeoff for not cutting off the face.
    paddingMultiplier: Number(process.env.FACECAM_PADDING_MULTIPLIER) || 2.2,
    minFraction: Number(process.env.FACECAM_MIN_CROP_FRACTION) || 0.1,
    maxFraction: Number(process.env.FACECAM_MAX_CROP_FRACTION) || 0.5,

    // Sanity check, not a prompt instruction: real facecam overlays are
    // virtually always pinned near a screen edge. If the model reports a
    // center point that isn't close to ANY edge, that's the exact profile
    // of the in-game character's face (which can appear anywhere, including
    // dead center) — so we reject it as a likely misidentification rather
    // than trusting the model's own edge/center judgment on this one point.
    // A point within this fraction of any edge counts as "near an edge".
    // Set to 0 to disable this check entirely.
    edgeMarginFraction:
      Number(process.env.FACECAM_EDGE_MARGIN_FRACTION) ?? 0.15,
  },

  // Your own identity, used by features that need to know "where am I" /
  // "who is me" (Dome of Silence's origin point, Canvas Shield excluding
  // yourself from "nearest player").
  myPlayer: {
    steamId: process.env.MY_STEAM_ID || "",
  },

  // Canvas net IDs for each feature — set these to the tracked canvas you
  // want each feature painting to. Separate canvases per feature is simplest;
  // point two at the same netId if you want them sharing one physical sign.
  canvases: {
    buttonFrameGrab: process.env.CANVAS_NETID_BUTTON_FRAME_GRAB || "",
    deathCam: process.env.CANVAS_NETID_DEATH_CAM || "",
    canvasShield: process.env.CANVAS_NETID_CANVAS_SHIELD || "",
    photoBooth: process.env.CANVAS_NETID_PHOTO_BOOTH || "",
    securitySystem: process.env.CANVAS_NETID_SECURITY_SYSTEM || "",
  },

  domeOfSilence: {
    radius: Number(process.env.DOME_RADIUS) || 30,
    // Rust+ smart switch entity ID to trigger when voice is detected inside
    // the dome. See src/rustplusClient.js — the exact method name for toggling
    // a switch needs verifying against your installed rustplus.js version.
    switchEntityId: process.env.DOME_SWITCH_ENTITY_ID || "",
  },

  // Where the canvas shield's canvas returns to after CANVAS_SHIELD_RETURN_DELAY_MS —
  // some "parked"/home spot rather than left in front of your face indefinitely.
  // How far below the intended position the canvas stages while loading the
  // new image, so it's hidden rather than visible with a blank/stale texture
  // during the brief window between paint and actually rendering.
  canvasShieldStaging: {
    offsetY: Number(process.env.CANVAS_SHIELD_STAGING_OFFSET_Y) || 10,
  },

  canvasShieldReturn: {
    homePosition: {
      x: Number(process.env.CANVAS_SHIELD_HOME_X) || 408.301,
      y: Number(process.env.CANVAS_SHIELD_HOME_Y) || 123.664627,
      z: Number(process.env.CANVAS_SHIELD_HOME_Z) || 73.56391,
    },
    returnDelayMs: Number(process.env.CANVAS_SHIELD_RETURN_DELAY_MS) || 10000,
  },

  streamListen: {
    defaultMaxDurationMs:
      Number(process.env.STREAM_LISTEN_MAX_DURATION_MS) || 15000,
  },

  elevenLabs: {
    apiKey: process.env.ELEVENLABS_API_KEY || "",
    // Default from the provided example script — override per-call or via env.
    voiceId: process.env.ELEVENLABS_VOICE_ID || "oR4uRy4fHDUGGISL0Rev",
    // Used when a voice in voice-map.json doesn't set its own modelId.
    // eleven_v3 (the original hardcoded default) supports the [tag] bracket
    // syntax for emotional direction, but does NOT support the speed
    // parameter at all — a voice wanting custom speed needs a different
    // model (e.g. eleven_multilingual_v2, eleven_turbo_v2_5).
    defaultModelId: process.env.ELEVENLABS_MODEL_ID || "eleven_v3",
  },

  tts: {
    // < 1 lowers pitch. 0.92 is "slight" per the request; tune to taste.
    pitchFactor: Number(process.env.TTS_PITCH_FACTOR) || 0.92,

    // Movement-aware placement: the plugin's player data exposes LOOK
    // direction (paired with eyes), not movement direction or speed — a
    // player can strafe or walk backward while looking elsewhere. So
    // "are they moving, and how fast" is inferred by sampling position
    // twice, sampleIntervalMs apart, rather than trusted from a single
    // snapshot's direction field.
    sampleIntervalMs: Number(process.env.TTS_SAMPLE_INTERVAL_MS) || 300,
    // Below this horizontal speed (m/s), treated as "not really traveling" —
    // filters out idle jitter/noise between the two position samples.
    movementThresholdMps: Number(process.env.TTS_MOVEMENT_THRESHOLD_MPS) || 0.5,
    // How far ahead (in time) to project a moving player's position, using
    // their measured velocity, so the sound lands in front of them.
    leadTimeSeconds: Number(process.env.TTS_LEAD_TIME_SECONDS) || 1.5,

    defaultRange: Number(process.env.TTS_DEFAULT_RANGE) || 30,

    // How many units to lower the Y coordinate before spawning the hidden
    // voice source, so it ends up underground rather than at the target's
    // actual height. Applied uniformly to both {x,y,z} and steamId-based
    // targets, in resolvePosition() — a single place, so neither path can
    // drift out of sync with the other.
    undergroundOffset: Number(process.env.TTS_UNDERGROUND_OFFSET) || 10,
  },
};
