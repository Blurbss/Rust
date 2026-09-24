// Server-side voice effects via ffmpeg — reverb and a slight pitch-down,
// approximating the browser ConvolverNode+GainNode effect chain without
// needing a native audio-output binding. This runs on a headless droplet
// with no sound card and no need for real-time playback, so a native
// speaker-output dependency (which is what a real Web Audio API port for
// Node pulls in, for decodeAudioData/ConvolverNode) is the wrong tool here —
// ffmpeg is already a hard requirement for this whole project and produces
// exactly the kind of file the plugin's /play endpoint expects
// ("mp3, or anything ffmpeg reads").
//
// Reverb here is an aecho-based approximation (multiple delayed, decaying
// echo taps), not true convolution reverb against a generated noise impulse
// like the browser ConvolverNode version — it's a well-known cheap
// approximation, not identical, but doesn't need an impulse-response file
// or any extra dependency. Tune AECHO_PARAMS below to taste.
//
// Pitch-down uses asetrate (reinterprets sample rate = changes pitch AND
// speed) followed by aresample back to the original rate and atempo to
// restore the original duration — so the end result is pitch-shifted only,
// not slowed down. Requires probing the real input sample rate first via
// ffprobe (can't assume ElevenLabs's output rate without checking).

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const config = require('./config');

const AECHO_PARAMS = '0.8:0.9:1000|1800:0.3|0.25'; // in_gain:out_gain:delays(ms):decays

async function probeSampleRate(filePath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=sample_rate',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath
  ]);
  const rate = parseInt(stdout.trim(), 10);
  if (!rate) throw new Error(`could not determine sample rate of ${filePath}`);
  return rate;
}

/**
 * @param {Buffer} audioBuffer input audio (whatever ElevenLabs returned — mp3)
 * @param {object} [opts]
 * @param {boolean} [opts.pitchDown] default true
 * @param {boolean} [opts.reverb] default true
 * @param {number} [opts.pitchFactor] < 1 lowers pitch, e.g. 0.9 = ~10% lower. Default from config.
 * @returns {Promise<Buffer>} processed mp3 bytes — same buffer back, untouched, if both effects are off
 */
async function applyVoiceEffects(audioBuffer, opts = {}) {
  const pitchDown = opts.pitchDown ?? true;
  const reverb = opts.reverb ?? true;
  const pitchFactor = opts.pitchFactor ?? config.tts.pitchFactor;

  if (!pitchDown && !reverb) return audioBuffer; // nothing to do

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tmpIn = path.join(os.tmpdir(), `tts-in-${stamp}.mp3`);
  const tmpOut = path.join(os.tmpdir(), `tts-out-${stamp}.mp3`);

  await fs.writeFile(tmpIn, audioBuffer);

  try {
    const filters = [];

    if (pitchDown) {
      const rate = await probeSampleRate(tmpIn);
      const newRate = Math.round(rate * pitchFactor);
      const tempo = 1 / pitchFactor;
      filters.push(`asetrate=${newRate}`, `aresample=${rate}`, `atempo=${tempo}`);
    }

    if (reverb) {
      filters.push(`aecho=${AECHO_PARAMS}`);
    }

    await execFileAsync('ffmpeg', [
      '-y',
      '-loglevel', 'error',
      '-i', tmpIn,
      '-af', filters.join(','),
      tmpOut
    ]);

    return await fs.readFile(tmpOut);
  } finally {
    fs.unlink(tmpIn).catch(() => {});
    fs.unlink(tmpOut).catch(() => {});
  }
}

module.exports = { applyVoiceEffects };
