// Feature: Button activated stream frame grab
// Press button = grab steamID and paint stream to canvas — using the exact
// same face-detection algorithm as everywhere else in this codebase
// (facecamPipeline.updateFacecamOnCanvas), just invoked from a button press
// or a manual trigger instead of only the original example wiring.
//
// IMPORTANT: this file does NOT reimplement any face-detection logic. It
// only calls into facecamPipeline.js, which is untouched. If you're
// comparing against an older version of this file that grabbed a raw,
// undetected frame — that was wrong; this is the corrected version.
//
// Optional once-per-person gating: several planned features (a photo booth,
// a house security system) are both "the button face-detection tech" but
// each needs its OWN independent one-time-use-per-person limit — using the
// photo booth shouldn't use up someone's one shot at the security system.
// Pass a `gadgetName` to scope the limit; omit it for no limit at all.

const facecamPipeline = require('../facecamPipeline');
const gadgetUsage = require('../gadgetUsage');

/**
 * @param {string} steamId
 * @param {string} netId tracked canvas net ID to paint onto
 * @param {object} [opts]
 * @param {string} [opts.gadgetName] if given, this steamId may only trigger
 *   this specific gadget once — subsequent calls return {ok:false, alreadyUsed:true}
 *   without re-running the pipeline. Omit for no limit.
 * @returns {Promise<{ok:true,url:string}|{ok:false,reason:string,alreadyUsed?:true}>}
 */
async function triggerButtonFrameGrab(steamId, netId, opts = {}) {
  const { gadgetName } = opts;

  if (gadgetName && gadgetUsage.hasUsed(gadgetName, steamId)) {
    return { ok: false, reason: `${steamId} has already used "${gadgetName}"`, alreadyUsed: true };
  }

  const result = await facecamPipeline.updateFacecamOnCanvas(steamId, netId);

  // Only burn the one-time use on an actual successful capture — a failed
  // attempt (streamer offline, no facecam found, etc) shouldn't cost someone
  // their one shot. Flip this if you'd rather gate on "attempted" instead.
  if (result.ok && gadgetName) {
    gadgetUsage.markUsed(gadgetName, steamId);
  }

  return result;
}

module.exports = { triggerButtonFrameGrab };
