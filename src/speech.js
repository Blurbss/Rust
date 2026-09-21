const sdk = require('microsoft-cognitiveservices-speech-sdk');
const config = require('./config');

function getSpeechConfig() {
  if (!config.azure.key) {
    throw new Error('AZURE_KEY is not set');
  }
  return sdk.SpeechConfig.fromSubscription(config.azure.key, config.azure.region);
}

/** Synthesize text to a Buffer of audio (e.g. to feed into the voice/speaker bridge). */
function synthesizeToBuffer(text) {
  return new Promise((resolve, reject) => {
    const speechConfig = getSpeechConfig();
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, undefined);

    synthesizer.speakTextAsync(
      text,
      (result) => {
        synthesizer.close();
        if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
          resolve(Buffer.from(result.audioData));
        } else {
          reject(new Error(`Speech synthesis failed: ${result.errorDetails}`));
        }
      },
      (err) => {
        synthesizer.close();
        reject(err);
      }
    );
  });
}

// TODO: add a transcribeFromStream(...) using SpeechRecognizer + PushAudioInputStream
// once you're feeding it live Steam voice packets (see rustPluginClient's /voice/<speakerId>
// note — that inbound stream is server->bridge, so STT would sit on the bridge side).

module.exports = { synthesizeToBuffer };
