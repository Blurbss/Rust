// Maps a friendly voice name ("pirate", "robot") to its ElevenLabs voice ID,
// model, speed, and a volume multiplier. Same in-memory-loaded-once,
// write-through-to-file pattern as twitchMap.js.
//
// Storage shape: { "<name>": { "voiceId": "...", "modelId": "...", "speed": 1.0, "volume": 0.8 } }
// modelId, speed, and volume are all optional per entry:
//   modelId — defaults to config.elevenLabs.defaultModelId if omitted
//   speed   — defaults to 1.0 (ElevenLabs' own default, no change) if omitted
//   volume  — defaults to 1.0 (no change) if omitted
//
// IMPORTANT, confirmed against ElevenLabs' own docs: speed is NOT supported
// on the eleven_v3 model at all — that's also the model that supports the
// [tag] bracket syntax for emotional direction. A voice can have bracket-tag
// support (eleven_v3) OR a custom speed (a different model), not both at
// once. getSpeed() below doesn't silently swallow this — the caller
// (elevenLabsTTS.js) warns explicitly when a non-default speed is set on a
// voice still using eleven_v3, so it's never a silent no-op.
//
// BACKWARD COMPATIBLE with the older flat-string format this file used
// before volume existed ({ "<name>": "<voiceId>" }) — a plain string entry
// is treated as that voiceId with modelId/speed/volume all left at their
// defaults. This matters because a droplet may already have a real
// voice-map.json with entries in an older shape; this reads those correctly
// without requiring a rewrite before deploying an update.

const fs = require('fs');
const path = require('path');
const config = require('./config');

const DATA_PATH = path.join(__dirname, '..', 'data', 'voice-map.json');

let map = {};

function load() {
  try {
    map = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      map = {};
    } else {
      throw err;
    }
  }
  return map;
}

function save() {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(map, null, 2));
}

function normalizeEntry(entry) {
  if (typeof entry === 'string') {
    return { voiceId: entry, modelId: undefined, speed: 1.0, volume: 1.0 };
  }
  if (entry && typeof entry === 'object') {
    return {
      voiceId: entry.voiceId,
      modelId: entry.modelId,
      speed: entry.speed ?? 1.0,
      volume: entry.volume ?? 1.0
    };
  }
  return null;
}

/** Returns the ElevenLabs voice ID for a friendly name, or null if unmapped. */
function getVoiceId(voiceName) {
  const entry = normalizeEntry(map[voiceName]);
  return entry?.voiceId || null;
}

/** Returns the configured model ID for a voice name, or the project default if unset/unmapped. */
function getModelId(voiceName) {
  const entry = normalizeEntry(map[voiceName]);
  return entry?.modelId || config.elevenLabs.defaultModelId;
}

/** Returns the configured speed (0.7-1.2) for a voice name, defaulting to 1.0 if unset/unmapped. */
function getSpeed(voiceName) {
  const entry = normalizeEntry(map[voiceName]);
  return entry?.speed ?? 1.0;
}

/** Returns the configured volume (0.0-1.0+) for a voice name, defaulting to 1.0 if unset/unmapped. */
function getVolume(voiceName) {
  const entry = normalizeEntry(map[voiceName]);
  return entry?.volume ?? 1.0;
}

/** Adds or updates one voice's mapping (merges with any existing fields for that name) and persists. */
function setVoice(voiceName, { voiceId, modelId, speed, volume } = {}) {
  const existing = normalizeEntry(map[voiceName]) || { voiceId: undefined, modelId: undefined, speed: 1.0, volume: 1.0 };
  map[voiceName] = {
    voiceId: voiceId ?? existing.voiceId,
    modelId: modelId ?? existing.modelId,
    speed: speed ?? existing.speed,
    volume: volume ?? existing.volume
  };
  save();
}

function listVoiceNames() {
  return Object.keys(map);
}

load();

module.exports = { load, save, getVoiceId, getModelId, getSpeed, getVolume, setVoice, listVoiceNames };
