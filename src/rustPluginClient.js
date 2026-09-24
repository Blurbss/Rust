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
// so callers get a consistent message either way. Also logs method/URL/status
// for every call — success or failure — so "what did the plugin actually
// return" is always visible in pm2 logs, not just inferable from whether the
// call threw.
async function call(promise) {
  try {
    const res = await promise;
    console.log(`[rustPluginClient] ${res.config.method.toUpperCase()} ${res.config.url} -> ${res.status}`);
    return res.data;
  } catch (err) {
    const status = err.response?.status ?? 'no response';
    const apiError = err.response?.data?.error;
    console.error(`[rustPluginClient] ${err.config?.method?.toUpperCase()} ${err.config?.url} -> ${status}: ${apiError || err.message}`);
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

  /**
   * Richer player info (added via Discord announcement).
   * @param {string} steamId
   * @returns {Promise<{
   *   steamId: string, name: string, online: boolean,
   *   health: number, maxHealth: number, calories: number, hydration: number,
   *   sleeping: boolean, wounded: boolean, dead: boolean,
   *   position: {x:number,y:number,z:number}, grid: string,
   *   eyes: {x:number,y:number,z:number}, direction: {x:number,y:number,z:number},
   *   mounted: object|null, activeItem: object|null,
   *   team: {id:string, leader:string, members:string[]} | null
   * }>}
   */
  getPlayer(steamId) {
    return call(client.get(`/players/${steamId}`));
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

  /**
   * Attaches 1-8 canvases to a player's view — static or spinning around
   * their eye height. Only that player sees it; not networked to others.
   * Appears ~3s after the request (loads the image out of sight first).
   * One set per player: a second call replaces the existing set.
   * @param {string} steamId
   * @param {object} opts
   * @param {string} opts.url image URL to show on every canvas in the set
   * @param {boolean} [opts.raw]
   * @param {number} [opts.distance] metres from their eyes, default 1 —
   *   use 2+ with the XL prefab (the default) to avoid clipping, more for higher counts
   * @param {string} [opts.prefab] defaults to the XL artist canvas sign prefab
   * @param {boolean} [opts.spinning] false = one static canvas at `distance`;
   *   true = `count` canvases evenly spaced, circling at `spinSpeed`
   * @param {number} [opts.count] 1-8, default 4 — ignored unless spinning
   * @param {number} [opts.spinSpeed] degrees/s, default 45, negative = reverse — ignored unless spinning
   * @returns {Promise<{netId:string, netIds:string[], steamId:string}>} netId is the first one;
   *   use netIds with paintCanvas() to repaint any of them (moveCanvas is overridden by the follow)
   */
  attachPlayerCanvas(steamId, opts) {
    return call(client.post(`/players/${steamId}/canvas`, opts));
  },

  /** Removes a player's attached canvas set (also happens automatically on disconnect/death). */
  removePlayerCanvas(steamId) {
    return call(client.delete(`/players/${steamId}/canvas`));
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
  },

  // ---- ONE-TIME AUDIO ----

  /**
   * Plays an audio clip ONCE at a spot as proximity voice — a hidden voice
   * source appears there, plays it, and disappears. Clips can overlap.
   * Requires the bridge running on their side.
   * @param {Buffer} audioBuffer raw file bytes (mp3 or anything ffmpeg reads), max 32 MiB
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} [range] metres, default 100 per their side
   * @returns {Promise<{id, netId, position, grid, range, bytes}>} 202 — plays a moment later, not instantly
   *   Possible errors: 400 (empty body / missing x,y,z / bad range), 413 (too big), 503 (BridgeUrl not configured on their end)
   */
  playAudioAt(audioBuffer, x, y, z, range) {
    const params = { x, y, z };
    if (range !== undefined) params.range = range;
    return call(
      client.post('/play', audioBuffer, {
        params,
        headers: { 'Content-Type': 'application/octet-stream' },
        maxBodyLength: 32 * 1024 * 1024 // 32 MiB, matches their stated limit
      })
    );
  },

  // ---- CURSE (undocumented beyond existence — no request/response shape given) ----
  // Announced with no further detail. These are bare method+path wrappers;
  // verify what they actually do and whether they need a body before relying
  // on them for anything.

  curseSet(steamId, body) {
    return call(client.post(`/players/${steamId}/curse`, body));
  },

  curseClear(steamId) {
    return call(client.delete(`/players/${steamId}/curse`));
  }

  // Note: POST /voice/<speakerId> (raw Steam voice packet bridge) is not
  // wrapped here since the doc says "the bridge calls this; you don't."
};
