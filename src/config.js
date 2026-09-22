require('dotenv').config();

function required(name, fallback) {
  const val = process.env[name] ?? fallback;
  if (val === undefined || val === '') {
    console.warn(`[config] Warning: ${name} is not set`);
  }
  return val;
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  webhookSecret: required('WEBHOOK_SECRET'),

  rustApi: {
    baseUrl: required('RUST_API_BASE_URL'),
    apiKey: required('RUST_API_KEY')
  },

  rustPlus: {
    serverIp: process.env.RUSTPLUS_SERVER_IP || '',
    serverPort: process.env.RUSTPLUS_SERVER_PORT || '',
    playerId: process.env.RUSTPLUS_PLAYER_ID || '',
    playerToken: process.env.RUSTPLUS_PLAYER_TOKEN || ''
  },

  azure: {
    key: process.env.AZURE_KEY || '',
    region: process.env.AZURE_REGION || 'centralus'
  },

  // Public URL this app is reachable at (through nginx), used to build the
  // hosted image URL handed to /canvases/<netId>/image. Matches the /rust
  // location prefix from your nginx config.
  publicBaseUrl: required('PUBLIC_BASE_URL', 'https://blurbsttv.com/rust'),

  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    // "low" is faster/cheaper but downsamples internally before analysis, which
    // can make coordinate accuracy worse. If clamped/rejected boxes are common
    // in your logs, try "high" — costs more latency for better spatial accuracy.
    imageDetail: process.env.OPENAI_IMAGE_DETAIL || 'low'
  },

  stream: {
    // Comma-separated fallback chain streamlink will try in order. Lower
    // resolutions resolve/transfer faster but give the vision model less to
    // work with for finding a small facecam overlay — tune to taste.
    quality: process.env.STREAM_QUALITY || '480p,worst',
    resolveTimeoutMs: Number(process.env.STREAM_RESOLVE_TIMEOUT_MS) || 6000,
    ffmpegTimeoutMs: Number(process.env.STREAM_FFMPEG_TIMEOUT_MS) || 6000
  }
};
