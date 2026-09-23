// Generalizes the "write a cropped/generated image somewhere public and hand
// back a URL the plugin can fetch" pattern so every feature does this the
// same way instead of each reinventing write+cleanup logic.
//
// Files land under public/<subdir>/<prefix>-<timestamp>.jpg and are served by
// webhookServer.js's express.static mount at /<subdir>/<file>. Each call
// deletes that prefix's previous file(s) first, so repeated calls (e.g. the
// same steamId triggering a feature repeatedly) don't accumulate files —
// same disk-conscious approach as the original facecam pipeline.

const fs = require('fs/promises');
const path = require('path');
const config = require('./config');

const PUBLIC_ROOT = path.join(__dirname, '..', 'public');

/** Deletes any existing files for this prefix within a subdir before writing a new one. */
async function cleanupPrevious(subdir, prefix) {
  const dir = path.join(PUBLIC_ROOT, subdir);
  try {
    const files = await fs.readdir(dir);
    const stale = files.filter((f) => f.startsWith(`${prefix}-`));
    await Promise.all(stale.map((f) => fs.unlink(path.join(dir, f)).catch(() => {})));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[imageHost] cleanup warning (${subdir}):`, err.message);
  }
}

/**
 * Writes a buffer under public/<subdir>/ and returns its public URL.
 * @param {Buffer} buffer image bytes (jpg/png — extension controls what gets written)
 * @param {object} opts
 * @param {string} opts.subdir e.g. 'facecam', 'framegrab', 'canvas-shield'
 * @param {string} opts.prefix stable id for cleanup grouping — usually a steamId
 * @param {string} [opts.ext] file extension without the dot, default 'jpg'
 * @returns {Promise<string>} full public URL
 */
async function writeAndHost(buffer, { subdir, prefix, ext = 'jpg' }) {
  await cleanupPrevious(subdir, prefix);

  const filename = `${prefix}-${Date.now()}.${ext}`;
  const dir = path.join(PUBLIC_ROOT, subdir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), buffer);

  return `${config.publicBaseUrl}/${subdir}/${filename}`;
}

/** Safety-net sweep across ALL subdirs under public/, in case a crashed run left orphans. */
async function sweepOldFiles(maxAgeMs = 10 * 60 * 1000) {
  try {
    const subdirs = await fs.readdir(PUBLIC_ROOT);
    for (const subdir of subdirs) {
      const dir = path.join(PUBLIC_ROOT, subdir);
      const stat = await fs.stat(dir).catch(() => null);
      if (!stat || !stat.isDirectory()) continue;

      const files = await fs.readdir(dir);
      const now = Date.now();
      await Promise.all(
        files.map(async (f) => {
          const full = path.join(dir, f);
          const fileStat = await fs.stat(full).catch(() => null);
          if (fileStat && now - fileStat.mtimeMs > maxAgeMs) {
            await fs.unlink(full).catch(() => {});
          }
        })
      );
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[imageHost] sweep warning:', err.message);
  }
}

module.exports = { writeAndHost, sweepOldFiles };
