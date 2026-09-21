// Wraps @liamcottle/rustplus.js for the electrical/smart-switch side of things
// (separate from the custom plugin's HTTP API — this talks Rust+ directly).

const RustPlus = require('@liamcottle/rustplus.js');
const config = require('./config');

// Fill these in via .env once you've paired the app and grabbed a player token
// (liamcottle's rustplus.js CLI has a `pair` command that gets you playerId/playerToken).
const rustplus = new RustPlus(
  config.rustPlus.serverIp,
  config.rustPlus.serverPort,
  config.rustPlus.playerId,
  config.rustPlus.playerToken
);

function connect() {
  rustplus.on('connected', () => {
    console.log('[rustplus] connected');
  });

  rustplus.on('error', (err) => {
    console.error('[rustplus] error:', err);
  });

  rustplus.on('disconnected', () => {
    console.warn('[rustplus] disconnected');
  });

  rustplus.connect();
}

module.exports = { rustplus, connect };
