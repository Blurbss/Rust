// Deliberately dumb and fast: crops a fixed fraction out of the middle of a
// frame with no detection step at all. For features like Canvas Shield where
// you don't need to find anything specific — you just want "whatever's in
// the middle of their screen" — skipping the OpenAI call entirely saves the
// 1-2s that step costs elsewhere in the pipeline.

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { getJpegDimensions } = require('./imageDimensions');

/**
 * @param {Buffer} imageBuffer source JPEG
 * @param {object} [opts]
 * @param {number} [opts.widthFraction] fraction of frame width to keep, centered (default 0.4)
 * @param {number} [opts.heightFraction] fraction of frame height to keep, centered (default 0.4)
 * @returns {Promise<Buffer>} cropped JPEG
 */
async function cropCenter(imageBuffer, { widthFraction = 0.4, heightFraction = 0.4 } = {}) {
  const dims = getJpegDimensions(imageBuffer);
  const width = Math.round(dims.width * widthFraction);
  const height = Math.round(dims.height * heightFraction);
  const x = Math.round((dims.width - width) / 2);
  const y = Math.round((dims.height - height) / 2);

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tmpIn = path.join(os.tmpdir(), `centercrop-in-${stamp}.jpg`);
  const tmpOut = path.join(os.tmpdir(), `centercrop-out-${stamp}.jpg`);

  await fs.writeFile(tmpIn, imageBuffer);

  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-loglevel', 'error',
      '-i', tmpIn,
      '-vf', `crop=${width}:${height}:${x}:${y}`,
      '-q:v', '2',
      tmpOut
    ]);

    return await fs.readFile(tmpOut);
  } finally {
    fs.unlink(tmpIn).catch(() => {});
    fs.unlink(tmpOut).catch(() => {});
  }
}

module.exports = { cropCenter };
