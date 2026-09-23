const config = require('./src/config');
const { createServer } = require('./src/webhookServer');
const rustplusClient = require('./src/rustplusClient');
const { sweepOldFiles } = require('./src/imageHost');
// const rustApi = require('./src/rustPluginClient'); // use this to call GET /players, POST /chests/move, etc.
// const speech = require('./src/speech');            // use this for TTS/STT

(async function main() {
  try {
    const app = createServer();
    app.listen(config.port, () => {
      console.log(`[webhook] listening on :${config.port} — give the devs:`);
      console.log(`          ${config.publicBaseUrl}/webhook?key=${config.webhookSecret}`);
    });

    // Safety-net cleanup: catches any images left behind by a crashed or
    // interrupted feature run, across every feature's subdir under public/.
    // Each feature already deletes its own previous file on every successful
    // run, so this is a backstop, not the primary cleanup — matters on a
    // disk-constrained droplet.
    setInterval(() => sweepOldFiles(), 10 * 60 * 1000);

    // Rust+ (electrical/smart-switch side). Comment out if not ready yet —
    // the webhook server above works independently of this.
    if (config.rustPlus.serverIp && config.rustPlus.playerToken) {
      rustplusClient.connect();
    } else {
      console.warn('[rustplus] skipping connect — RUSTPLUS_* env vars not set');
    }
  } catch (err) {
    console.error('Fatal startup error:', err);
    process.exit(1);
  }
})();
