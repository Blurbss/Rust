// Per-streamer detection hints, for outlier cases where the generic
// facecam-detection prompt (facecamDetector.js's SYSTEM_PROMPT, shared and
// unchanged for everyone) genuinely can't cope with a specific streamer's
// unusual overlay — e.g. a VTuber avatar that doesn't read as a normal face
// shape. A hint here is appended ONLY when processing that exact streamer's
// frame; every other streamer's detection call is byte-identical to before
// this file existed. Keyed by lowercased twitch username so casing in
// twitch-map.json doesn't cause a silent miss.

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'streamer-hints.json');

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

/** Returns the hint text for a twitch username, or null if none is set. */
function getHint(twitchUsername) {
  if (!twitchUsername) return null;
  return map[twitchUsername.toLowerCase()] || null;
}

/** Adds or updates one streamer's hint and persists the whole file. */
function setHint(twitchUsername, hintText) {
  map[twitchUsername.toLowerCase()] = hintText;
  save();
}

function removeHint(twitchUsername) {
  delete map[twitchUsername.toLowerCase()];
  save();
}

load();

module.exports = { load, save, getHint, setHint, removeHint };
