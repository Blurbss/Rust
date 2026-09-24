// Server-side voice effects via ffmpeg — reverb and pitch-down, approximating
// the browser ConvolverNode+GainNode effect chain without needing a native
// audio-output binding. This runs on a headless droplet with no sound card
// and no need for real-time playback, so a native speaker-output dependency
// (what a real Web Audio API port for Node pulls in, for
// decodeAudioData/ConvolverNode) is the wrong tool here — ffmpeg is already
// a hard requirement for this whole project.
//
// REVERB: uses TWO CHAINED aecho stages, not true convolution (afir). A
// convolution-reverb version was built and tested extensively — it produced
// valid, correctly encoded, correctly sized files (confirmed via ffprobe and
// manual CLI runs on the actual droplet's ffmpeg 4.4.2) that were accepted by
// the plugin (202, real id/netId) — but never actually played in-game, for
// reasons that couldn't be pinned down remotely. Since aecho is confirmed to
// actually produce audible playback in this environment, that's the tool
// available; tuning has gone through several iterations to get as close to
// the original convolution reverb's character as aecho can reach:
//
//   1. Original attempt: 2 taps, widely spaced (1000ms, 1800ms) — sounded
//      like distinct repeats, not reverb.
//   2. Many taps (7), evenly spaced (20ms apart) — fixed the "repeats"
//      problem but caused comb filtering (perfectly periodic echoes
//      reinforce/cancel specific frequencies), audible as a tinny, metallic,
//      "in a box" resonance.
//   3. Irregularly-spaced taps with increasing gaps — fixed the metallic
//      resonance, but the short total decay (~200ms) read as tight/boxy,
//      like an intercom, not spacious.
//   4. CURRENT: two aecho stages chained in series, each irregularly spaced,
//      spanning a much longer total decay (~900ms tail). Chaining stages is
//      the same principle classic (Schroeder-style) reverb algorithms use —
//      the second stage echoes the ALREADY-ECHOED signal from the first,
//      compounding into a denser, more diffuse wash than any single stage of
//      discrete taps can produce alone. Not identical to true convolution,
//      but the closest this tool gets: longer, denser, and non-periodic
//      rather than short and metallic.
//
// PITCH-DOWN: uses ffmpeg's rubberband filter — a real pitch-shifting
// library (confirmed compiled into this ffmpeg build), not the cheap
// asetrate+atempo reinterpret-the-sample-rate trick an earlier version used.
// Shifts pitch independent of tempo/duration in one filter, no sample-rate
// probing or manual tempo math needed. Tested directly: the old
// asetrate+atempo approach hard-crashed ffmpeg once pitchFactor dropped to
// 0.1; rubberband succeeded cleanly all the way down to 0.01.

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const config = require('./config');

// Stage 1: early reflections, closer together, spanning ~0-300ms.
// Stage 2: late reflections, feeding off stage 1's already-diffused output,
// spanning ~150-600ms further out — the overlap between the two stages'
// ranges is intentional, it's what creates the compounding density.
// out_gain kept at/below 0.7-0.8 to avoid ffmpeg's own clipping/saturation
// warning seen at 0.9.
const AECHO_STAGE_1 = '0.8:0.7:25|55|90|130|175|225|280:0.35|0.3|0.26|0.22|0.19|0.16|0.13';
const AECHO_STAGE_2 = '0.7:0.6:150|280|430|600:0.25|0.18|0.12|0.08';

/**
 * @param {Buffer} audioBuffer input audio (whatever ElevenLabs returned — mp3)
 * @param {object} [opts]
 * @param {boolean} [opts.pitchDown] default false
 * @param {boolean} [opts.reverb] default false
 * @param {number} [opts.pitchFactor] < 1 lowers pitch, e.g. 0.9 = ~10% lower, 0.3 = very deep.
 *   Default from config.tts.pitchFactor (itself from TTS_PITCH_FACTOR in .env). Tested working
 *   cleanly (via rubberband) all the way down to 0.01.
 * @param {number} [opts.volume] linear gain multiplier, default 1.0 (no change). Applied LAST,
 *   after pitch/reverb, as a final, predictable overall gain stage.
 * @returns {Promise<Buffer>} processed mp3 bytes — same buffer back, untouched, if no effect applies
 */
async function applyVoiceEffects(audioBuffer, opts = {}) {
  const pitchDown = opts.pitchDown ?? false;
  const reverb = opts.reverb ?? false;
  const pitchFactor = opts.pitchFactor ?? config.tts.pitchFactor;
  const volume = opts.volume ?? 1.0;
  const hasVolumeChange = volume !== 1.0;

  if (!pitchDown && !reverb && !hasVolumeChange) return audioBuffer; // nothing to do

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tmpIn = path.join(os.tmpdir(), `tts-in-${stamp}.mp3`);
  const tmpOut = path.join(os.tmpdir(), `tts-out-${stamp}.mp3`);

  await fs.writeFile(tmpIn, audioBuffer);

  try {
    const filters = [];

    if (pitchDown) {
      filters.push(`rubberband=pitch=${pitchFactor}`);
    }

    if (reverb) {
      filters.push(`aecho=${AECHO_STAGE_1}`, `aecho=${AECHO_STAGE_2}`);
    }

    if (hasVolumeChange) {
      filters.push(`volume=${volume}`);
    }

    await execFileAsync('ffmpeg', [
      '-y',
      '-loglevel', 'error',
      '-i', tmpIn,
      '-af', filters.join(','),
      tmpOut
    ]);

    // Debug aid: preserve the exact processed file instead of deleting it,
    // so it can be downloaded and actually played/inspected directly. Off by
    // default — every real run still cleans up normally unless explicitly
    // asked not to via TTS_DEBUG_KEEP_OUTPUT=true.
    if (process.env.TTS_DEBUG_KEEP_OUTPUT === 'true') {
      const debugPath = path.join(os.tmpdir(), 'tts-debug-last-output.mp3');
      await fs.copyFile(tmpOut, debugPath);
      console.log(`[audioEffects] debug copy saved to ${debugPath}`);
    }

    return await fs.readFile(tmpOut);
  } finally {
    fs.unlink(tmpIn).catch(() => {});
    fs.unlink(tmpOut).catch(() => {});
  }
}

module.exports = { applyVoiceEffects };
