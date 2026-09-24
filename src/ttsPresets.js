// Named, pre-set TTS text snippets, so triggering a call doesn't require
// typing/encoding text at the moment of triggering.
//
// UNLIKE every other data file in this project (twitchMap.js, voiceMap.js,
// streamerHints.js — all loaded ONCE at startup, requiring a restart to pick
// up hand-edits), this one re-reads the file from disk on EVERY lookup. That
// trade-off is deliberate and specific to this file: its whole purpose is
// being edited by hand often, and a small JSON file read is cheap. So the
// intended workflow is:
//   nano data/tts-presets.json   (edit any preset's text, including "manual")
//   save
//   curl ".../manual/tts?preset=whatever&..."   (uses the new text immediately)
// No restart, no HTTP "set" call required — though the /manual/tts-presets/
// :name/set route still exists as an alternative for scripting/hotkeys, and
// writes to the exact same file, so either editing method works
// interchangeably with the other at any time.
//
// The "manual" entry is special only by convention, not by code: it's the
// name you're expected to overwrite most often as a scratch slot, then
// trigger repeatedly via ?preset=manual without retyping/re-encoding text
// into a URL each time. Any other preset name works identically.

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'tts-presets.json');

/** Reads the current file fresh from disk. Returns {} if it doesn't exist yet. */
function readCurrent() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function writeCurrent(map) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(map, null, 2));
}

/** Returns the text for a preset name, or null if it doesn't exist. Always reflects the file's current on-disk content. */
function getPreset(name) {
  const map = readCurrent();
  return name in map ? map[name] : null;
}

/**
 * Creates or overwrites one preset's text and persists immediately. Reads
 * fresh before writing so this doesn't clobber a hand-edit made to a
 * DIFFERENT preset since the last read.
 */
function setPreset(name, text) {
  const map = readCurrent();
  map[name] = text;
  writeCurrent(map);
}

function listPresetNames() {
  return Object.keys(readCurrent());
}

module.exports = { getPreset, setPreset, listPresetNames };
