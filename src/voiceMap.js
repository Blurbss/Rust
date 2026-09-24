// Maps a friendly voice name ("pirate", "robot") to its ElevenLabs voice ID,
// so callers of playTTS() don't need to know/type raw voice IDs. Same
// in-memory-loaded-once, write-through-to-file pattern as twitchMap.js.

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

/** Returns the ElevenLabs voice ID for a friendly name, or null if unmapped. */
function getVoiceId(voiceName) {
  return map[voiceName] || null;
}

/** Adds or updates one mapping and persists the whole file. */
function setVoiceId(voiceName, voiceId) {
  map[voiceName] = voiceId;
  save();
}

function listVoiceNames() {
  return Object.keys(map);
}

load();

module.exports = { load, save, getVoiceId, setVoiceId, listVoiceNames };
