// Two-stage, latency-minded frame grab:
//   1. `streamlink --stream-url` resolves the actual playable HLS/RTMP URL
//      WITHOUT spinning up streamlink's own player/output pipeline — that
//      pipeline is built for continuous playback, not "grab one frame fast".
//   2. ffmpeg opens that URL directly and pulls exactly one frame.
// This is meaningfully faster than piping stream data through streamlink's
// normal playback path.

const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const config = require('./config');

/** Resolves the direct stream URL for a Twitch channel. */
async function resolveStreamUrl(twitchUsername, quality = config.stream.quality) {
  const { stdout } = await execFileAsync(
    'streamlink',
    ['--twitch-disable-ads', '--stream-url', `https://twitch.tv/${twitchUsername}`, quality],
    { timeout: config.stream.resolveTimeoutMs }
  );

  const url = stdout.trim();
  if (!url) {
    throw new Error(`streamlink returned no URL for ${twitchUsername} (offline, or quality "${quality}" unavailable)`);
  }
  return url;
}

/** Grabs a single frame from a live stream URL as a JPEG buffer. */
function grabFrame(streamUrl, timeoutMs = config.stream.ffmpegTimeoutMs) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-loglevel', 'error',
      '-i', streamUrl,
      '-frames:v', '1',
      '-q:v', '3',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      'pipe:1'
    ];

    const ffmpeg = spawn('ffmpeg', args);
    const chunks = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        ffmpeg.kill('SIGKILL');
        reject(new Error('ffmpeg frame grab timed out'));
      }
    }, timeoutMs);

    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on('data', () => {}); // loglevel=error already keeps this quiet

    ffmpeg.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    ffmpeg.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0 && chunks.length) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
}

/** Convenience: twitch username -> JPEG buffer, in one call. */
async function grabFrameForUser(twitchUsername) {
  const streamUrl = await resolveStreamUrl(twitchUsername);
  return grabFrame(streamUrl);
}

module.exports = { resolveStreamUrl, grabFrame, grabFrameForUser };
