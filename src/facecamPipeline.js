const fs = require('fs/promises');
const path = require('path');
const config = require('./config');
const twitchMap = require('./twitchMap');
const { grabFrameForUser } = require('./frameGrabber');
const { detectFacecam } = require('./facecamDetector');
const { cropImageBuffer } = require('./imageCrop');
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

  let bbox;
  try {
    const t2 = Date.now();
    bbox = await detectFacecam(frame);
    log('detect facecam', t2);
  } catch (err) {
    return { ok: false, reason: `facecam detection failed: ${err.message}` };
  }

  if (!bbox.found) {
    return { ok: false, reason: `no facecam found for ${twitchUsername}` };
  }

  let cropped;
  try {
    const t3 = Date.now();
    cropped = await cropImageBuffer(frame, bbox);
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
    log('write + build url', t4);
  } catch (err) {
    return { ok: false, reason: `saving cropped image failed: ${err.message}` };
  }

  try {
    const t5 = Date.now();
    await rustApi.paintCanvas(netId, publicUrl);
    log('paint canvas call', t5);
  } catch (err) {
    return { ok: false, reason: `painting canvas failed: ${err.message}` };
  }

  log('TOTAL', t0);
  return { ok: true, url: publicUrl };
}

module.exports = { updateFacecamOnCanvas, sweepOldFiles };
