// Maps a friendly voice name ("pirate", "robot") to its ElevenLabs voice ID
// AND a volume multiplier (0.0-1.0+, applied as a final gain stage in
// audioEffects.js), so a voice that generates too loud/quiet relative to
// others can be corrected once here rather than passed as an option on
// every call. Same in-memory-loaded-once, write-through-to-file pattern as
// twitchMap.js.
//
// Storage shape: { "<name>": { "voiceId": "...", "volume": 0.8 } }
// volume is optional per entry — defaults to 1.0 (no change) if omitted.
//
// BACKWARD COMPATIBLE with the older flat-string format this file used
// before volume existed ({ "<name>": "<voiceId>" }) — a plain string entry
// is treated as that voiceId with volume 1.0. This matters because a
// droplet may already have a real voice-map.json with entries in the old
// shape; this reads those correctly without requiring you to rewrite them
// by hand before deploying this update.

const fs = require('fs');
const path = require('path');

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
    return { voiceId: entry, volume: 1.0 };
  }
  if (entry && typeof entry === 'object') {
    return { voiceId: entry.voiceId, volume: entry.volume ?? 1.0 };
  }
  return null;
}

/** Returns the ElevenLabs voice ID for a friendly name, or null if unmapped. */
function getVoiceId(voiceName) {
  const entry = normalizeEntry(map[voiceName]);
  return entry?.voiceId || null;
}

/** Returns the configured volume (0.0-1.0+) for a voice name, defaulting to 1.0 if unset/unmapped. */
function getVolume(voiceName) {
  const entry = normalizeEntry(map[voiceName]);
  return entry?.volume ?? 1.0;
}

/** Adds or updates one voice's mapping (merges with any existing volume/voiceId for that name) and persists. */
function setVoice(voiceName, { voiceId, volume } = {}) {
  const existing = normalizeEntry(map[voiceName]) || { voiceId: undefined, volume: 1.0 };
  map[voiceName] = {
    voiceId: voiceId ?? existing.voiceId,
    volume: volume ?? existing.volume
  };
  save();
}

function listVoiceNames() {
  return Object.keys(map);
}

load();

module.exports = { load, save, getVoiceId, getVolume, setVoice, listVoiceNames };
