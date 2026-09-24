// Tool: Setup stream listen code
// When passed a steamID, start listening to their stream audio. Either
// listens for up to maxDurationMs and returns the full transcript, OR stops
// early the moment `keyword` is heard. Meant to be called FROM other
// features, not triggered directly.
//
// Azure config and cleanup order below are matched against a proven working
// script (raw profanity, en-US, 250ms end-silence timeout, and — critically —
// unpipe-then-kill-ffmpeg-then-kill-streamlink-process-group in that exact
// order to avoid orphaned processes on shutdown).

const sdk = require("microsoft-cognitiveservices-speech-sdk");
const config = require("./config");
const twitchMap = require("./twitchMap");
const { openAudioStream, stopAudioStream } = require("./audioGrabber");

/**
 * @param {string} steamId
 * @param {object} [opts]
 * @param {number} [opts.maxDurationMs] hard cap on listen time, default from config
 * @param {string} [opts.keyword] if given, stops as soon as this word/phrase is heard
 *   (case-insensitive substring match on each recognized segment)
 * @returns {Promise<{ok:true,transcript:string,matchedKeyword:string|null,timedOut:boolean}|{ok:false,reason:string}>}
 */
function listenToStream(steamId, opts = {}) {
  const maxDurationMs =
    opts.maxDurationMs ?? config.streamListen.defaultMaxDurationMs;
  const keyword = opts.keyword ? opts.keyword.toLowerCase() : null;

  return new Promise((resolve) => {
    const twitchUsername = twitchMap.getTwitchUsername(steamId);
    if (!twitchUsername) {
      resolve({
        ok: false,
        reason: `no twitch username mapped for steamId ${steamId}`,
      });
      return;
    }
    if (!config.azure.key) {
      resolve({ ok: false, reason: "AZURE_KEY is not set" });
      return;
    }

    const transcriptParts = [];
    let settled = false;
    let audioHandles = null;

    const speechConfig = sdk.SpeechConfig.fromSubscription(
      config.azure.key,
      config.azure.region,
    );
    speechConfig.speechRecognitionLanguage = "en-US";
    speechConfig.setProfanity(sdk.ProfanityOption.Raw);
    speechConfig.setProperty("EndSilenceTimeoutMs", "250");

    const pushStream = sdk.AudioInputStream.createPushStream();
    const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);

      recognizer.stopContinuousRecognitionAsync(
        () => {
          recognizer.close();
          try {
            pushStream.close();
          } catch {
            /* already closed */
          }
          try {
            audioConfig.close();
          } catch {
            /* already closed */
          }
          if (audioHandles) stopAudioStream(audioHandles);
          resolve(result);
        },
        () => {
          // stop failed — clean up everything else anyway rather than leaving
          // processes running.
          if (audioHandles) stopAudioStream(audioHandles);
          resolve(result);
        },
      );
    };

    const timeoutHandle = setTimeout(() => {
      finish({
        ok: true,
        transcript: transcriptParts.join(" ").trim(),
        matchedKeyword: null,
        timedOut: true,
      });
    }, maxDurationMs);

    recognizer.recognized = (_sender, event) => {
      if (event.result.reason === sdk.ResultReason.RecognizedSpeech) {
        const text = event.result.text.trim();
        if (!text.length) return;

        transcriptParts.push(text);

        // Opt-in: log each phrase the instant it's recognized, purely for a
        // human to read along live — this doesn't change what's returned at
        // the end (still the full accumulated transcript / keyword match,
        // unaffected either way).
        if (opts.logLive) {
          console.log(`[streamListen] recognized: "${text}"`);
        }

        if (keyword && text.toLowerCase().includes(keyword)) {
          finish({
            ok: true,
            transcript: transcriptParts.join(" ").trim(),
            matchedKeyword: opts.keyword,
            timedOut: false,
          });
        }
      }
    };

    recognizer.canceled = (_sender, event) => {
      finish({
        ok: false,
        reason: `recognition canceled: ${event.errorDetails || event.reason}`,
      });
    };

    recognizer.startContinuousRecognitionAsync();

    try {
      audioHandles = openAudioStream(twitchUsername);
      audioHandles.stdout.on("data", (chunk) => pushStream.write(chunk));
      audioHandles.stdout.on("close", () => {
        try {
          pushStream.close();
        } catch {
          /* already closed */
        }
      });
      audioHandles.ffmpegProc.on("error", (err) =>
        finish({ ok: false, reason: `ffmpeg error: ${err.message}` }),
      );
      audioHandles.streamlinkProc.on("error", (err) =>
        finish({ ok: false, reason: `streamlink error: ${err.message}` }),
      );
    } catch (err) {
      finish({ ok: false, reason: err.message });
    }
  });
}

module.exports = { listenToStream };
