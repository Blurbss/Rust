const config = require('./src/config');
const { createServer } = require('./src/webhookServer');
const rustplusClient = require('./src/rustplusClient');
// const rustApi = require('./src/rustPluginClient'); // use this to call GET /players, POST /chests/move, etc.
// const speech = require('./src/speech');            // use this for TTS/STT

(async function main() {
  try {
    const app = createServer();
    app.listen(config.port, () => {
      console.log(`[webhook] listening on :${config.port} — give the devs:`);
      console.log(`          https://YOUR_DOMAIN/webhook?key=${config.webhookSecret}`);
    });

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
