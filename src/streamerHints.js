// Per-streamer detection overrides, for outlier cases where the generic
// facecam-detection prompt (facecamDetector.js's SYSTEM_PROMPT, shared and
// unchanged for everyone) genuinely can't cope with a specific streamer's
// unusual overlay. Two independent kinds of override, both keyed by
// lowercased twitch username so casing in twitch-map.json doesn't cause a
// silent miss:
//
//   hint     — text appended to the prompt for that one streamer's calls
//              only. Good for "this doesn't look like a normal face,
//              here's what to actually look for" — a judgment call, left to
//              the model.
//   cxOffset/cyOffset — a fixed fractional nudge (-1.0 to 1.0) applied to
//              the model's returned center point AFTER detection, only when
//              building the crop window — NOT before the edge-proximity
//              safety check, which still judges the model's genuine,
//              unmodified output. Good for "the model finds it in roughly
//              the right place every time, but consistently off-center by
//              about this much" — a measured, deterministic correction, not
//              something to leave to the model's own numeric precision via
//              a text instruction.
//
// Either can be set alone or together. Storage shape:
//   { "<username>": { "hint": "...", "cxOffset": -0.05, "cyOffset": 0 } }

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

/**
 * @param {string} twitchUsername
 * @returns {{hint?:string, cxOffset?:number, cyOffset?:number}|null} the full
 *   override record for this streamer, or null if none is set
 */
function getOverrides(twitchUsername) {
  if (!twitchUsername) return null;
  return map[twitchUsername.toLowerCase()] || null;
}

/** Convenience: just the hint text, or null. */
function getHint(twitchUsername) {
  return getOverrides(twitchUsername)?.hint || null;
}

/** Merges the given fields into this streamer's record (creating it if needed) and persists. */
function setOverrides(twitchUsername, overrides) {
  const key = twitchUsername.toLowerCase();
  map[key] = { ...map[key], ...overrides };
  save();
}

function removeOverrides(twitchUsername) {
  delete map[twitchUsername.toLowerCase()];
  save();
}

load();

module.exports = { load, save, getOverrides, getHint, setOverrides, removeOverrides };
