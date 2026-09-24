// Feature: Play a one-shot TTS clip in the world.
// Give it a coordinate directly, OR a steamId — in the steamId case, this
// samples the player's position twice a moment apart to measure their real
// movement (see the note in config.js's tts section on why: the plugin's
// player data only exposes LOOK direction, not movement direction or
// speed), and if they're actually traveling, projects the sound slightly
// ahead of them so they'll walk into it / hear it approaching rather than
// it landing behind them.
//
// Trigger type: MANUAL (see /manual/tts route) AND usable from any automated
// event handler (button presses, etc) — call playTTS() directly from
// webhookHandlers.js the same way other features are wired in there.

const config = require('../config');
const rustApi = require('../rustPluginClient');
const voiceMap = require('../voiceMap');
const { generateSpeech } = require('../elevenLabsTTS');
const { applyVoiceEffects } = require('../audioEffects');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Samples a player's position twice, sampleIntervalMs apart, to measure
 * real horizontal velocity — see the config.js comment for why a single
 * snapshot's `direction` field (look direction) can't answer this.
 * @returns {Promise<{position:object, velocity:{x:number,z:number}, speed:number}>}
 */
async function measureMovement(steamId, sampleIntervalMs) {
  const p1 = await rustApi.getPlayer(steamId);
  await delay(sampleIntervalMs);
  const p2 = await rustApi.getPlayer(steamId);

  const dt = sampleIntervalMs / 1000;
  const velocity = {
    x: (p2.position.x - p1.position.x) / dt,
    z: (p2.position.z - p1.position.z) / dt
  };
  const speed = Math.hypot(velocity.x, velocity.z);

  return { position: p2.position, velocity, speed };
}

/**
 * Resolves a {steamId} or {x,y,z} target into a concrete play position,
 * projecting ahead of a moving player if applicable.
 *
 * Confirmed empirically (a stationary player's `direction` came back as a
 * unit vector matching their look angle, not near-zero as a velocity would
 * be while standing still) that `direction` in the plugin's player data is
 * LOOK direction, not movement — so double-sampling position is the only
 * reliable way to know if/how someone is actually traveling.
 */
async function resolvePosition(target) {
  if (target.x !== undefined && target.y !== undefined && target.z !== undefined) {
    return { x: target.x, y: target.y, z: target.z };
  }

  if (!target.steamId) {
    throw new Error('target must have either {x,y,z} or {steamId}');
  }

  const { position, velocity, speed } = await measureMovement(target.steamId, config.tts.sampleIntervalMs);

  if (speed < config.tts.movementThresholdMps) {
    // Not really moving — play right on them, no lead offset.
    return position;
  }

  // Project their position forward using measured velocity — an actual
  // lead/intercept calculation, not a fixed "a few meters ahead" guess.
  return {
    x: position.x + velocity.x * config.tts.leadTimeSeconds,
    y: position.y,
    z: position.z + velocity.z * config.tts.leadTimeSeconds
  };
}

/**
 * @param {string} text
 * @param {{x:number,y:number,z:number}|{steamId:string}} target
 * @param {object} [opts]
 * @param {boolean} [opts.pitchDown] default true
 * @param {boolean} [opts.reverb] default true
 * @param {number} [opts.range] metres, default from config
 * @param {string} [opts.voiceName] friendly name ("pirate", "robot") looked
 *   up via voiceMap.js — mutually exclusive with opts.voiceId
 * @param {string} [opts.voiceId] raw ElevenLabs voice ID, overrides the
 *   default — mutually exclusive with opts.voiceName
 * @returns {Promise<{ok:true,position:object}|{ok:false,reason:string}>}
 */
async function playTTS(text, target, opts = {}) {
  if (!text || !text.trim()) {
    return { ok: false, reason: 'empty text' };
  }

  if (opts.voiceName && opts.voiceId) {
    return { ok: false, reason: 'specify either voiceName or voiceId, not both' };
  }

  let voiceId = opts.voiceId;
  if (opts.voiceName) {
    voiceId = voiceMap.getVoiceId(opts.voiceName);
    if (!voiceId) {
      return {
        ok: false,
        reason: `no voice mapped for "${opts.voiceName}" — known voices: ${voiceMap.listVoiceNames().join(', ') || '(none configured)'}`
      };
    }
  }

  let position;
  try {
    position = await resolvePosition(target);
  } catch (err) {
    return { ok: false, reason: `could not resolve position: ${err.message}` };
  }

  let rawAudio;
  try {
    rawAudio = await generateSpeech(text, { voiceId });
  } catch (err) {
    return { ok: false, reason: `TTS generation failed: ${err.message}` };
  }

  let processedAudio;
  try {
    processedAudio = await applyVoiceEffects(rawAudio, {
      pitchDown: opts.pitchDown,
      reverb: opts.reverb
    });
  } catch (err) {
    return { ok: false, reason: `audio effects failed: ${err.message}` };
  }

  try {
    await rustApi.playAudioAt(
      processedAudio,
      position.x,
      position.y,
      position.z,
      opts.range ?? config.tts.defaultRange
    );
  } catch (err) {
    return { ok: false, reason: `playback failed: ${err.message}` };
  }

  return { ok: true, position };
}

module.exports = { playTTS, measureMovement, resolvePosition };
