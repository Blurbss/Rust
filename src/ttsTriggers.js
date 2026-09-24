// Named TTS "trigger" configs — bundles everything a single button-press
// call needs (which text/preset to speak, which player/coordinate to target,
// which voice, which effects) into one named entry, so a hotkey or Stream
// Deck button can be bound to ONE STATIC URL forever
// (/manual/tts-trigger/<name>) while every actual behavior is edited in this
// file instead. Same live-reload-from-disk pattern as ttsPresets.js (not
// load-once-at-startup like most other data files here) — this file exists
// specifically to be hand-edited often, so:
//   nano data/tts-triggers.json   (change the preset, steamId, voice, effects — anything)
//   save
//   (hit the same Stream Deck button you already mapped — no restart, no re-mapping)
//
// Storage shape:
//   {
//     "<name>": {
//       "preset": "manual",              // looked up via ttsPresets.js — OR use "text" for literal text instead
//       "steamId": "76561197992270733",  // OR use x/y/z for a fixed coordinate instead
//       "voice": "robot",                // looked up via voiceMap.js — OR use "voiceId" for a raw override
//       "pitchDown": true,
//       "reverb": true,
//       "volume": 0.8,                   // overrides the voice's own configured volume if given
//       "range": 30,
//       "undergroundOffset": 10
//     }
//   }
// Every field except preset/text and steamId/x,y,z is optional — omit
// anything you want left at playTTS's own defaults.

const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "data", "tts-triggers.json");

/** Reads the current file fresh from disk. Returns {} if it doesn't exist yet. */
function readCurrent() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

function writeCurrent(map) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(map, null, 2));
}

/** Returns a trigger's full config object, or null if it doesn't exist. Always reflects the file's current on-disk content. */
function getTrigger(name) {
  const map = readCurrent();
  return name in map ? map[name] : null;
}

/**
 * Creates or overwrites one trigger's config (merging with whatever fields
 * already existed for that name) and persists immediately. Reads fresh
 * before writing so this doesn't clobber a hand-edit made to a DIFFERENT
 * trigger since the last read.
 */
function setTrigger(name, fields) {
  const map = readCurrent();
  map[name] = { ...map[name], ...fields };
  writeCurrent(map);
}

function listTriggerNames() {
  return Object.keys(readCurrent());
}

module.exports = { getTrigger, setTrigger, listTriggerNames };
