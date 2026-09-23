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

/**
 * Turns a smart switch on/off by its Rust+ entity ID. Confirmed against a
 * real working script — turnSmartSwitchOn/Off are real methods on the
 * rustplus.js instance, no lower-level fallback needed.
 * @param {string|number} entityId Rust+ smart switch entity ID
 * @param {boolean} on
 */
function setSwitch(entityId, on) {
  if (!entityId) throw new Error('setSwitch called with no entityId');
  const id = Number(entityId);
  return on ? rustplus.turnSmartSwitchOn(id) : rustplus.turnSmartSwitchOff(id);
}

module.exports = { rustplus, connect, setSwitch };
