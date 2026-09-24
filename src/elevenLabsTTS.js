// ElevenLabs text-to-speech client. Request shape (model_id, voice_settings,
// xi-api-key header) is confirmed against two real working scripts, so this
// isn't guessed — just ported to use Node's built-in fetch instead of a
// browser fetch or the node-fetch package, keeping this project's
// zero-extra-npm-dependency approach for anything that isn't ffmpeg/streamlink.

const config = require('./config');

/**
 * @param {string} text
 * @param {object} [opts]
 * @param {string} [opts.voiceId] overrides config.elevenLabs.voiceId
 * @param {string} [opts.modelId] default config.elevenLabs.defaultModelId
 * @param {number} [opts.speed] 0.7-1.2, default 1.0 (ElevenLabs' own default). NOT supported
 *   on the eleven_v3 model at all — logs a warning rather than silently doing nothing if
 *   a non-default speed is requested while using eleven_v3.
 * @returns {Promise<Buffer>} raw audio bytes (mp3) straight from ElevenLabs
 */
async function generateSpeech(text, opts = {}) {
  if (!config.elevenLabs.apiKey) {
    throw new Error('ELEVENLABS_API_KEY is not set');
  }

  const voiceId = opts.voiceId || config.elevenLabs.voiceId;
  const modelId = opts.modelId || config.elevenLabs.defaultModelId;
  const speed = opts.speed ?? 1.0;

  if (speed !== 1.0 && (speed < 0.7 || speed > 1.2)) {
    throw new Error(`speed must be between 0.7 and 1.2 (got ${speed})`);
  }

  if (speed !== 1.0 && modelId === 'eleven_v3') {
    console.warn(
      `[elevenLabsTTS] speed=${speed} requested but modelId is eleven_v3, which does NOT support speed — this will have no effect (voiceId=${voiceId}). Use a different model (e.g. eleven_multilingual_v2) for speed control on this voice.`
    );
  }

  const voiceSettings = {
    stability: 0.5,
    similarity_boost: 0.75,
    use_speaker_boost: true
  };
  if (speed !== 1.0) {
    voiceSettings.speed = speed;
  }

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': config.elevenLabs.apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text: text.replaceAll('\n', ''),
      model_id: modelId,
      voice_settings: voiceSettings
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`[elevenLabsTTS] API error ${res.status} (voiceId=${voiceId}): ${errText}`);
    throw new Error(`ElevenLabs API error ${res.status}: ${errText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // A 200 with a suspiciously tiny body is worth flagging on its own — seen
  // in the wild when something upstream returns an empty/near-empty audio
  // response despite a success status. Not necessarily an error, but a
  // signal worth having in the logs rather than silently trusting res.ok alone.
  if (buffer.length < 1000) {
    console.warn(`[elevenLabsTTS] HTTP ${res.status}, but only ${buffer.length} bytes — suspiciously small for real audio (voiceId=${voiceId})`);
  } else {
    console.log(`[elevenLabsTTS] HTTP ${res.status}, generated ${buffer.length} bytes (voiceId=${voiceId})`);
  }

  return buffer;
}

module.exports = { generateSpeech };
