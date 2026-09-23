// Tracks which steamIDs have used which gadgets, so a feature (photo booth,
// security system, etc — anything built on the button-triggered face capture)
// can be limited to once-per-person, independently per gadget. Using the
// photo booth doesn't count against the security system's own one-time use,
// even though both are powered by the same underlying face-detection call.
//
// Storage shape, kept as compact as this gets while staying human-readable
// for manual inspection/editing:
//   { "<gadgetName>": { "<steamId>": true, ... }, ... }
// A boolean per entry is all that's needed — presence means "used". If you
// later want a timestamp instead, change `true` to Date.now() and treat any
// truthy value as "used" (existing hasUsed() checks stay correct either way).

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'gadget-usage.json');

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

/** @returns {boolean} whether this steamId has already used this gadget */
function hasUsed(gadgetName, steamId) {
  return !!store[gadgetName]?.[steamId];
}

/** Marks this steamId as having used this gadget. */
function markUsed(gadgetName, steamId) {
  if (!store[gadgetName]) store[gadgetName] = {};
  store[gadgetName][steamId] = true;
  save();
}

/** Clears one person's usage of one gadget (e.g. for testing, or a manual reset). */
function resetUsage(gadgetName, steamId) {
  if (store[gadgetName]) {
    delete store[gadgetName][steamId];
    save();
  }
}

load();

module.exports = { hasUsed, markUsed, resetUsage, load };
