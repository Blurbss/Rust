// Opens a LIVE audio pipeline from a Twitch channel, matching a proven
// working pattern (not the "resolve URL then let ffmpeg fetch it directly"
// approach used elsewhere in this codebase for video frames): streamlink is
// spawned as its own process piping raw stream bytes into ffmpeg's stdin,
// which re-encodes to 16kHz mono WAV on stdout. This is deliberately
// different from frameGrabber.js's approach because streamlink handles
// Twitch's ad markers/access tokens more robustly than pointing ffmpeg at a
// resolved URL directly — this matters more for a continuous audio feed than
// for grabbing a single video frame.
//
// Both processes are spawned detached (their own process group) so
// stopAudioStream can reliably kill streamlink's entire subprocess tree via
// a negative PID — killing only the top process can leave orphaned children
// running.

const { spawn } = require('child_process');

/**
 * @param {string} twitchUsername
 * @returns {{streamlinkProc: import('child_process').ChildProcess, ffmpegProc: import('child_process').ChildProcess, stdout: NodeJS.ReadableStream}}
 *   stdout is 16kHz mono WAV audio, ready to feed into Azure's push stream.
 */
function openAudioStream(twitchUsername) {
  const streamUrl = `https://www.twitch.tv/${twitchUsername}`;
  const streamlinkCommand = `streamlink --stdout --twitch-low-latency ${streamUrl} audio_only`;

  const streamlinkProc = spawn(streamlinkCommand, {
    shell: true,
    detached: true, // own process group, so -pid kill reaches streamlink's children too
    stdio: ['ignore', 'pipe', 'ignore']
  });

  const ffmpegProc = spawn('ffmpeg', [
    '-loglevel', 'error',
    '-fflags', 'nobuffer',
    '-flags', 'low_delay',
    '-probesize', '512000', // default 5MB is overkill for audio-only; smaller = faster start
    '-analyzeduration', '1000000', // 1s max, keeps startup snappy
    '-i', 'pipe:0',
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-f', 'wav',
    'pipe:1'
  ]);

  streamlinkProc.stdout.pipe(ffmpegProc.stdin);

  // Expected during shutdown when we kill streamlink before ffmpeg finishes
  // reading — don't let it surface as an unhandled error.
  ffmpegProc.stdin.on('error', (err) => {
    if (err.code !== 'EPIPE') console.error('[audioGrabber] ffmpeg stdin error:', err);
  });

  ffmpegProc.stderr.on('data', () => {}); // loglevel=error already keeps this quiet

  return { streamlinkProc, ffmpegProc, stdout: ffmpegProc.stdout };
}

/**
 * Proper shutdown order for a stream opened above: unpipe first (so ffmpeg
 * doesn't try to keep reading from a process we're about to kill), then kill
 * ffmpeg, then kill streamlink's whole process group.
 */
function stopAudioStream({ streamlinkProc, ffmpegProc }) {
  try {
    if (streamlinkProc?.stdout && ffmpegProc?.stdin) {
      streamlinkProc.stdout.unpipe(ffmpegProc.stdin);
    }
  } catch {
    /* already unpiped/closed */
  }

  if (ffmpegProc) {
    try {
      ffmpegProc.kill('SIGKILL');
    } catch {
      /* already dead */
    }
  }

  if (streamlinkProc) {
    try {
      process.kill(-streamlinkProc.pid, 'SIGKILL'); // negative pid = whole process group
    } catch {
      /* already dead, or platform doesn't support process groups (Windows) */
    }
  }
}

module.exports = { openAudioStream, stopAudioStream };
