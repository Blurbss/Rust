// Generic small persisted state, same pattern as twitchMap.js: loaded fully
// into memory once, written back to disk on every change. Intended for the
// kind of thing individual features need to remember across restarts — a
// counter, a one-time setup result, a subscription id — NOT for anything
// large or high-frequency (that's what the /canvases, /chests etc. plugin
// API and the database on their side are for).
//
// Usage:
//   const state = require('./stateStore');
//   state.get('landmineDeaths', 0);              // read with a default
//   state.set('landmineDeaths', state.get('landmineDeaths', 0) + 1);
//   state.get('domeOfSilence');                   // -> {originX, originZ, subscriptionId} or undefined

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'state.json');

let store = {};

function load() {
  try {
    store = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      store = {};
    } else {
      throw err;
    }
  }
  return store;
}

function save() {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(store, null, 2));
}

function get(key, defaultValue) {
  return key in store ? store[key] : defaultValue;
}

function set(key, value) {
  store[key] = value;
  save();
}

function remove(key) {
  delete store[key];
  save();
}

load();

module.exports = { get, set, remove, load };
