const fs = require('fs/promises');
const path = require('path');
const config = require('./config');
const twitchMap = require('./twitchMap');
const { grabFrameForUser } = require('./frameGrabber');
const { detectFacecam } = require('./facecamDetector');
const { cropImageBuffer } = require('./imageCrop');
const { getJpegDimensions, buildCropFromCenter } = require('./imageDimensions');
const rustApi = require('./rustPluginClient');

const FACECAM_DIR = path.join(__dirname, '..', 'public', 'facecam');

function log(label, startedAt) {
  console.log(`[facecam] ${label}: ${Date.now() - startedAt}ms`);
}

/** Deletes any previous cropped images for this steamId before writing a new one,
 *  so repeated calls don't accumulate files on disk. */
async function cleanupPrevious(steamId) {
  try {
    const files = await fs.readdir(FACECAM_DIR);
    const stale = files.filter((f) => f.startsWith(`${steamId}-`));
    await Promise.all(stale.map((f) => fs.unlink(path.join(FACECAM_DIR, f)).catch(() => {})));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[facecam] cleanup warning:', err.message);
  }
}

/** Safety-net sweep: deletes any facecam file older than maxAgeMs, regardless of
 *  steamId. Call this on an interval from index.js in case a crash ever leaves
 *  orphaned files behind. */
async function sweepOldFiles(maxAgeMs = 10 * 60 * 1000) {
  try {
    const files = await fs.readdir(FACECAM_DIR);
    const now = Date.now();
    await Promise.all(
      files.map(async (f) => {
        const full = path.join(FACECAM_DIR, f);
        const stat = await fs.stat(full).catch(() => null);
        if (stat && now - stat.mtimeMs > maxAgeMs) {
          await fs.unlink(full).catch(() => {});
        }
      })
    );
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[facecam] sweep warning:', err.message);
  }
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
  try {
    const t2 = Date.now();
    bbox = await detectFacecam(frame, dims);
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

  const clamped = buildCropFromCenter(bbox, dims, config.facecamCrop);
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
    await cleanupPrevious(steamId);
    const filename = `${steamId}-${Date.now()}.jpg`;
    await fs.mkdir(FACECAM_DIR, { recursive: true });
    await fs.writeFile(path.join(FACECAM_DIR, filename), cropped);
    publicUrl = `${config.publicBaseUrl}/facecam/${filename}`;

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

module.exports = { updateFacecamOnCanvas, sweepOldFiles };
