const config = require('./config');
const twitchMap = require('./twitchMap');
const streamerHints = require('./streamerHints');
const { grabFrameForUser } = require('./frameGrabber');
const { detectFacecam } = require('./facecamDetector');
const { cropImageBuffer } = require('./imageCrop');
const { getJpegDimensions, buildCropFromCenter } = require('./imageDimensions');
const { writeAndHost } = require('./imageHost');
const rustApi = require('./rustPluginClient');

function log(label, startedAt) {
  console.log(`[facecam] ${label}: ${Date.now() - startedAt}ms`);
}

/**
 * Full pipeline: steamId -> twitch username -> live frame -> facecam bbox ->
 * cropped image -> hosted URL -> painted onto the given tracked canvas.
 *
 * Never throws — returns {ok:false, reason} on any failure so a caller driven
 * off a webhook event doesn't need its own try/catch for every failure mode.
 */
async function updateFacecamOnCanvas(steamId, netId) {
  const t0 = Date.now();

  const twitchUsername = twitchMap.getTwitchUsername(steamId);
  if (!twitchUsername) {
    return { ok: false, reason: `no twitch username mapped for steamId ${steamId}` };
  }

  let frame;
  try {
    const t1 = Date.now();
    frame = await grabFrameForUser(twitchUsername);
    log('grab frame', t1);
  } catch (err) {
    return { ok: false, reason: `frame grab failed: ${err.message}` };
  }

  let dims;
  try {
    dims = getJpegDimensions(frame);
  } catch (err) {
    return { ok: false, reason: `could not read frame dimensions: ${err.message}` };
  }

  let bbox;
  const overrides = streamerHints.getOverrides(twitchUsername);
  try {
    const t2 = Date.now();
    bbox = await detectFacecam(frame, dims, overrides?.hint);
    log('detect facecam', t2);
  } catch (err) {
    return { ok: false, reason: `facecam detection failed: ${err.message}` };
  }

  if (!bbox.found) {
    return { ok: false, reason: `no facecam found for ${twitchUsername}` };
  }

  const margin = config.facecamCrop.edgeMarginFraction;
  if (margin > 0) {
    const nearEdge = bbox.cx <= margin || bbox.cx >= 1 - margin || bbox.cy <= margin || bbox.cy >= 1 - margin;
    if (!nearEdge) {
      return {
        ok: false,
        reason: `model reported a face far from any screen edge (cx=${bbox.cx}, cy=${bbox.cy}) for ${twitchUsername} — likely the in-game character's face rather than a real overlay, since facecams are virtually always edge-pinned`
      };
    }
  }

  // Edge-proximity check above deliberately used bbox.cx/cy UNMODIFIED — it's
  // judging whether the model's own detection is trustworthy, before any of
  // our own correction is applied. The per-streamer cxOffset/cyOffset (if
  // any) only shifts where we crop from here on, a separate concern from
  // whether we trust the detection at all.
  const adjustedBbox = {
    ...bbox,
    cx: bbox.cx + (overrides?.cxOffset || 0),
    cy: bbox.cy + (overrides?.cyOffset || 0)
  };

  const clamped = buildCropFromCenter(adjustedBbox, dims, config.facecamCrop);
  if (!clamped) {
    return {
      ok: false,
      reason: `model returned an out-of-bounds center point for ${twitchUsername} (frame ${dims.width}x${dims.height}, got cx=${bbox.cx},cy=${bbox.cy},width=${bbox.width},height=${bbox.height})`
    };
  }

  let cropped;
  try {
    const t3 = Date.now();
    cropped = await cropImageBuffer(frame, clamped);
    log('crop', t3);
  } catch (err) {
    return { ok: false, reason: `crop failed: ${err.message}` };
  }

  let publicUrl;
  try {
    const t4 = Date.now();
    publicUrl = await writeAndHost(cropped, { subdir: 'facecam', prefix: steamId });

    // Validate before handing it to the plugin — a malformed PUBLIC_BASE_URL
    // (unset, empty, missing scheme) would otherwise surface as a generic
    // "Invalid URL" from either axios or the plugin's own server-side check,
    // with no indication of which side or which env var is actually wrong.
    try {
      new URL(publicUrl);
    } catch {
      return {
        ok: false,
        reason: `constructed an invalid public URL ("${publicUrl}") — check PUBLIC_BASE_URL in .env (must be a full URL including https://)`
      };
    }

    log('write + build url', t4);
  } catch (err) {
    return { ok: false, reason: `saving cropped image failed: ${err.message}` };
  }

  try {
    const t5 = Date.now();
    if (!config.rustApi.baseUrl) {
      return { ok: false, reason: 'RUST_API_BASE_URL is not set — cannot reach the plugin API' };
    }
    await rustApi.paintCanvas(netId, publicUrl);
    log('paint canvas call', t5);
  } catch (err) {
    return { ok: false, reason: `painting canvas failed: ${err.message}` };
  }

  log('TOTAL', t0);
  return { ok: true, url: publicUrl };
}

module.exports = { updateFacecamOnCanvas };
