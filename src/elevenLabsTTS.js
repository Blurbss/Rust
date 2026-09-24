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
 * @param {string} [opts.modelId] default 'eleven_v3'
 * @returns {Promise<Buffer>} raw audio bytes (mp3) straight from ElevenLabs
 */
async function generateSpeech(text, opts = {}) {
  if (!config.elevenLabs.apiKey) {
    throw new Error('ELEVENLABS_API_KEY is not set');
  }

  const voiceId = opts.voiceId || config.elevenLabs.voiceId;
  const modelId = opts.modelId || 'eleven_v3';

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': config.elevenLabs.apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text: text.replaceAll('\n', ''),
      model_id: modelId,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        use_speaker_boost: true
      }
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`ElevenLabs API error ${res.status}: ${errText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { generateSpeech };
