// Reuses ffmpeg (already required for the frame grab) instead of adding a
// separate image library like sharp or ImageMagick just for a crop.

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

/**
 * @param {Buffer} imageBuffer source JPEG
 * @param {{x:number,y:number,width:number,height:number}} box pixel box to crop to
 * @returns {Promise<Buffer>} cropped JPEG
 */
async function cropImageBuffer(imageBuffer, { x, y, width, height }) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tmpIn = path.join(os.tmpdir(), `facecam-in-${stamp}.jpg`);
  const tmpOut = path.join(os.tmpdir(), `facecam-out-${stamp}.jpg`);

  await fs.writeFile(tmpIn, imageBuffer);

  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-loglevel', 'error',
      '-i', tmpIn,
      '-vf', `crop=${Math.round(width)}:${Math.round(height)}:${Math.round(x)}:${Math.round(y)}`,
      '-q:v', '2',
      tmpOut
    ]);

    return await fs.readFile(tmpOut);
  } finally {
    fs.unlink(tmpIn).catch(() => {});
    fs.unlink(tmpOut).catch(() => {});
  }
}

module.exports = { cropImageBuffer };
