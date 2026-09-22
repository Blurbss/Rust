// Loads the whole steamId -> twitchUsername map into memory once at startup.
// Even a few thousand entries is a few hundred KB, so this is both simpler
// and faster than standing up a database for it: lookups are plain object
// property access, no disk I/O per call, and the file only gets touched
// when you actually add/update an entry.

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'steam-twitch-map.json');

let map = {};

function load() {
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    map = JSON.parse(raw);
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

/** Returns the twitch username for a steamId, or null if unmapped. */
function getTwitchUsername(steamId) {
  return map[steamId] || null;
}

/** Adds or updates one mapping and persists the whole file. */
function setTwitchUsername(steamId, twitchUsername) {
  map[steamId] = twitchUsername;
  save();
}

/** Bulk-replace the whole map (e.g. after importing a CSV/spreadsheet) and persist it. */
function setAll(newMap) {
  map = { ...newMap };
  save();
}

// Load once when this module is first required (Node caches modules, so
// every other file that requires this gets the same in-memory map).
load();

module.exports = { load, save, getTwitchUsername, setTwitchUsername, setAll, _map: () => map };
