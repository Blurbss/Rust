// Feature: Canvas image upload
// Give an image URL and paint it to a canvas. Deliberately trivial — this is
// mostly a thin, named wrapper so it's easy to call manually, but other
// features (death cam, button frame grab) call rustPluginClient.paintCanvas
// directly rather than going through this when they already have a URL from
// their own pipeline. This module is for the "I just have a URL" case.
//
// Trigger type: MANUAL primarily (see webhookServer.js's /manual/canvas-image
// route). Nothing about this needs an in-game event to make sense.

const rustApi = require('../rustPluginClient');

/**
 * @param {string} netId tracked canvas net ID
 * @param {string} imageUrl any URL the plugin's server can fetch
 * @returns {Promise<{ok:true}|{ok:false,reason:string}>}
 */
async function uploadImageToCanvas(netId, imageUrl) {
  if (!netId) return { ok: false, reason: 'no netId given' };

  try {
    new URL(imageUrl);
  } catch {
    return { ok: false, reason: `"${imageUrl}" is not a valid URL` };
  }

  try {
    await rustApi.paintCanvas(netId, imageUrl);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `painting canvas failed: ${err.message}` };
  }
}

module.exports = { uploadImageToCanvas };
