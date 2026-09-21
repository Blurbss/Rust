// Thin wrapper around the Rust server plugin's HTTP API.
// Every call here is US calling THEM (the game server), authenticated with
// the X-Api-Key they gave you. This is separate from the webhook server,
// which is THEM calling US.

const axios = require('axios');
const config = require('./config');

const client = axios.create({
  baseURL: config.rustApi.baseUrl,
  timeout: 5000,
  headers: {
    'X-Api-Key': config.rustApi.apiKey,
    'Content-Type': 'application/json'
  }
});

// Unwrap axios errors into the plugin's own {error: "..."} shape when possible,
// so callers get a consistent message either way.
async function call(promise) {
  try {
    const res = await promise;
    return res.data;
  } catch (err) {
    const apiError = err.response?.data?.error;
    throw new Error(apiError || err.message);
  }
}

module.exports = {
  // ---- console-style tracking is done in-game / via rcon, not HTTP ----

  // ---- QUERIES ----

  /** Players in a grid square, e.g. getPlayersInGrid('D5') */
  getPlayersInGrid(grid) {
    return call(client.get('/players', { params: { grid } }));
  },

  /** Players within radius of a point. y is optional (adds vertical distance). */
  getPlayersNear(x, z, radius, y) {
    const params = { x, z, radius };
    if (y !== undefined) params.y = y;
    return call(client.get('/players', { params }));
  },

  /** Where a player is looking. Throws if they're offline (404). */
  getPlayerLook(steamId) {
    return call(client.get(`/players/${steamId}/look`));
  },

  /** Contents of a tracked chest. */
  getChest(netId) {
    return call(client.get(`/chests/${netId}`));
  },

  // ---- ACTIONS ----

  /** Move an item between two tracked chests. amount 0 = whole stack. */
  moveChestItem(fromNetId, toNetId, itemId, amount = 0) {
    return call(client.post('/chests/move', { from: fromNetId, to: toNetId, itemId, amount }));
  },

  /** Paint an image onto a tracked canvas/sign. 202 = queued, not painted yet. */
  paintCanvas(netId, imageUrl, { raw = false, textureIndex = 0 } = {}) {
    return call(client.post(`/canvases/${netId}/image`, { url: imageUrl, raw, textureIndex }));
  },

  /** Move/rotate a tracked canvas. Omitted fields keep their current value. */
  moveCanvas(netId, transform) {
    return call(client.post(`/canvases/${netId}/move`, transform));
  },

  // ---- VOICE SUBSCRIPTIONS ----

  listSubscriptions() {
    return call(client.get('/subscriptions'));
  },

  /** Circle: {url, x, z, radius}. Rectangle: {url, x1, z1, x2, z2}. */
  createSubscription(subscription) {
    return call(client.post('/subscriptions', subscription));
  },

  deleteSubscription(id) {
    return call(client.delete(`/subscriptions/${id}`));
  },

  // ---- SPEAKERS ----

  listSpeakers() {
    return call(client.get('/speakers'));
  },

  createSpeaker(name, x, y, z, range = 100) {
    return call(client.post('/speakers', { name, x, y, z, range }));
  },

  deleteSpeaker(id) {
    return call(client.delete(`/speakers/${id}`));
  }

  // Note: POST /voice/<speakerId> (raw Steam voice packet bridge) is not
  // wrapped here since the doc says "the bridge calls this; you don't."
};
