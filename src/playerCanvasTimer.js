// Feature: temporary player-attached canvas.
// Same attach as canvasImageUpload/the raw player-canvas manual route, but
// automatically calls removePlayerCanvas after durationMs — for a one-shot
// "show this for a few seconds then take it away" use case.
//
// GUARD AGAINST A REAL RACE: the plugin's own doc says "one set per player: a
// second POST replaces it" — so if this same player gets a NEW canvas
// attached (another temporary call, or any other feature that attaches to
// them) before this one's timer fires, a naive setTimeout would delete that
// NEWER canvas instead of the one it was actually meant to clean up. Fixed
// with a simple per-player generation counter: each attach bumps the
// counter, and the scheduled removal only actually fires if nothing newer
// has been attached to that same player since. This only protects against
// races within this app — it can't know about attaches made some other way
// entirely outside this codebase.

const rustApi = require("./rustPluginClient");

const generationByPlayer = new Map();

/**
 * @param {string} steamId
 * @param {object} canvasOpts same shape as rustPluginClient.attachPlayerCanvas's opts
 *   ({url, raw, distance, prefab, spinning, count, spinSpeed})
 * @param {number} durationMs how long to leave it up before auto-removing
 * @returns {Promise<{ok:true,attach:object}|{ok:false,reason:string}>} resolves as soon as
 *   the canvas is attached — does NOT wait for the later auto-removal
 */
async function attachTemporaryCanvas(steamId, canvasOpts, durationMs) {
  const myGeneration = (generationByPlayer.get(steamId) || 0) + 1;
  generationByPlayer.set(steamId, myGeneration);

  let attachResult;
  try {
    attachResult = await rustApi.attachPlayerCanvas(steamId, canvasOpts);
  } catch (err) {
    return { ok: false, reason: `attach failed: ${err.message}` };
  }

  setTimeout(async () => {
    if (generationByPlayer.get(steamId) !== myGeneration) {
      console.log(
        `[playerCanvas] skipped auto-remove for ${steamId} — a newer canvas was attached since`,
      );
      return;
    }
    try {
      await rustApi.removePlayerCanvas(steamId);
      console.log(
        `[playerCanvas] auto-removed canvas from ${steamId} after ${durationMs}ms`,
      );
    } catch (err) {
      console.warn(
        `[playerCanvas] auto-remove failed for ${steamId}:`,
        err.message,
      );
    }
  }, durationMs);

  return { ok: true, attach: attachResult };
}

module.exports = { attachTemporaryCanvas };
