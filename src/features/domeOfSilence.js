// Feature: Dome of Silence (multi-zone)
// Create one or more voip detection ranges (circles), each around wherever
// you're standing when you arm it, each identified by a zoneName you choose
// (e.g. "base", "outpost"). If voice is detected inside a zone, that zone's
// smart switch is signaled — independently of any other armed zone.
//
// Trigger type: arm()/disarm() are MANUAL (see /manual/dome/arm/:zoneName
// etc). The actual detection is AUTOMATED: the plugin sends voice_state
// events to the subscription's URL, which lands on your shared /webhook
// route same as every other event.
//
// WHY GEOMETRY, NOT THE SUBSCRIPTION URL, DECIDES THE ZONE: every zone's
// subscription points at the same shared /webhook URL (there's only one
// webhook endpoint in this app), so the incoming event alone doesn't say
// which zone it belongs to. voice_state events DO include the speaker's
// position, though, so each event is attributed to every ARMED zone whose
// circle actually contains that position — computed fresh per event. This
// also correctly handles overlapping zones: a speaker inside two zones at
// once affects both independently, each with its own switch and its own
// "who's currently talking" set.
//
// Zone state (origin, radius, subscription id, switch entity) persists via
// stateStore.js so a restart doesn't lose armed zones — but note the
// PLUGIN's own subscriptions survive independently of this app; disarm()
// deletes the specific zone's subscription properly rather than just
// forgetting about it, so you don't leak orphaned subscriptions on their
// server.

const config = require("../config");
const state = require("../stateStore");
const rustApi = require("../rustPluginClient");
const rustplusClient = require("../rustplusClient");

const STATE_KEY = "domeOfSilenceZones"; // { [zoneName]: {subscriptionId, originX, originZ, radius, switchEntityId, armedAt} }

// In-memory only, deliberately NOT persisted like zone state — resets
// naturally on a restart, which is correct: stale "still speaking" entries
// from before a restart should never survive it. Keyed by zoneName so each
// zone's speakers and pending turn-off are fully independent of every other
// zone's.
const currentlySpeakingByZone = new Map(); // zoneName -> Set<steamId>
const turnOffTimeoutsByZone = new Map(); // zoneName -> timeout handle

function getZones() {
  return state.get(STATE_KEY, {});
}

function saveZones(zones) {
  state.set(STATE_KEY, zones);
}

/** Clears speaking-state tracking for one zone — called on disarm so a re-arm starts clean. */
function resetSpeakingState(zoneName) {
  currentlySpeakingByZone.delete(zoneName);
  const timeout = turnOffTimeoutsByZone.get(zoneName);
  if (timeout) clearTimeout(timeout);
  turnOffTimeoutsByZone.delete(zoneName);
}

function distance2D(x1, z1, x2, z2) {
  return Math.hypot(x1 - x2, z1 - z2);
}

/**
 * Arms a named zone: reads your current position and creates a circular
 * voice subscription centered on it.
 * @param {string} zoneName unique identifier for this zone, e.g. "base"
 * @param {object} [opts]
 * @param {number} [opts.radius] overrides config.domeOfSilence.radius for this zone
 * @param {string|number} [opts.switchEntityId] overrides config.domeOfSilence.switchEntityId for this zone
 * @param {number} [opts.offDelayMs] how long to wait, after everyone in this
 *   zone stops talking, before actually turning the switch off — a grace
 *   period so brief pauses between sentences don't flicker it off and back
 *   on. Default 0 (turns off immediately once nobody's speaking). Any new
 *   speaker within this window cancels the pending turn-off.
 * @returns {Promise<{ok:true,subscriptionId:string}|{ok:false,reason:string}>}
 */
async function arm(zoneName, opts = {}) {
  if (!zoneName) {
    return { ok: false, reason: "zoneName is required" };
  }
  if (!config.myPlayer.steamId) {
    return { ok: false, reason: "MY_STEAM_ID is not set" };
  }

  const zones = getZones();
  if (zones[zoneName]) {
    return {
      ok: false,
      reason: `zone "${zoneName}" is already armed (subscription ${zones[zoneName].subscriptionId}) — call disarm("${zoneName}") first`,
    };
  }

  let myLook;
  try {
    myLook = await rustApi.getPlayerLook(config.myPlayer.steamId);
  } catch (err) {
    return { ok: false, reason: `could not get your position: ${err.message}` };
  }

  const radius = opts.radius ?? config.domeOfSilence.radius;
  const switchEntityId =
    opts.switchEntityId ?? config.domeOfSilence.switchEntityId;
  const offDelayMs = opts.offDelayMs ?? 0;
  const webhookUrl = `${config.publicBaseUrl}/webhook?key=${config.webhookSecret}`;

  let subscription;
  try {
    subscription = await rustApi.createSubscription({
      url: webhookUrl,
      x: myLook.eyes.x,
      z: myLook.eyes.z,
      radius,
    });
  } catch (err) {
    return {
      ok: false,
      reason: `failed to create subscription: ${err.message}`,
    };
  }

  zones[zoneName] = {
    subscriptionId: subscription.id,
    originX: myLook.eyes.x,
    originZ: myLook.eyes.z,
    radius,
    switchEntityId,
    offDelayMs,
    armedAt: Date.now(),
  };
  saveZones(zones);

  return { ok: true, subscriptionId: subscription.id };
}

/** Disarms one named zone: deletes its plugin-side subscription and clears local state. */
async function disarm(zoneName) {
  const zones = getZones();
  const existing = zones[zoneName];
  if (!existing) {
    return { ok: false, reason: `zone "${zoneName}" is not currently armed` };
  }

  try {
    await rustApi.deleteSubscription(existing.subscriptionId);
  } catch (err) {
    // Still clear local state even if the delete failed (e.g. already gone
    // on their side) — don't get permanently stuck unable to re-arm.
    console.warn(
      `[domeOfSilence] deleteSubscription failed for zone "${zoneName}", clearing local state anyway:`,
      err.message,
    );
  }

  delete zones[zoneName];
  saveZones(zones);
  resetSpeakingState(zoneName);
  return { ok: true };
}

function isArmed(zoneName) {
  return !!getZones()[zoneName];
}

function listArmedZones() {
  return Object.keys(getZones());
}

/**
 * Call this from your voice_state webhook handler for EVERY voice_state
 * event you receive. Internally, this checks the event's position against
 * EVERY currently-armed zone's circle and updates each matching zone
 * independently — a single event can affect multiple overlapping zones, or
 * none if the player isn't actually inside any armed zone's radius.
 *
 * @param {object} data the voice_state event's `data` object
 * @returns {Promise<{ok:true,affectedZones:string[]}|{ok:false,reason:string}>}
 */
async function handleVoiceStateForDome(data) {
  const zones = getZones();
  const zoneNames = Object.keys(zones);
  if (zoneNames.length === 0) return { ok: true, skipped: true };

  const steamId = data.player?.steamId;
  if (!steamId) {
    return { ok: false, reason: "voice_state event had no player steamId" };
  }
  if (!data.position) {
    return {
      ok: false,
      reason: "voice_state event had no position — cannot attribute to a zone",
    };
  }

  // Don't trigger on your own voice.
  //if (steamId === config.myPlayer.steamId) return { ok: true, skipped: true };

  const affectedZones = [];
  const errors = [];

  for (const zoneName of zoneNames) {
    const zone = zones[zoneName];
    const dist = distance2D(
      data.position.x,
      data.position.z,
      zone.originX,
      zone.originZ,
    );
    if (dist > zone.radius) continue; // this event isn't inside this particular zone

    affectedZones.push(zoneName);

    if (!zone.switchEntityId) {
      errors.push(`zone "${zoneName}" has no switchEntityId configured`);
      continue;
    }

    if (!currentlySpeakingByZone.has(zoneName)) {
      currentlySpeakingByZone.set(zoneName, new Set());
    }
    const speakers = currentlySpeakingByZone.get(zoneName);

    try {
      if (data.speaking) {
        const existingTimeout = turnOffTimeoutsByZone.get(zoneName);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
          turnOffTimeoutsByZone.delete(zoneName);
        }

        const wasEmpty = speakers.size === 0;
        speakers.add(steamId);

        if (wasEmpty) {
          await rustplusClient.setSwitch(zone.switchEntityId, true);
        }
      } else {
        speakers.delete(steamId);

        if (speakers.size === 0) {
          const offDelayMs = zone.offDelayMs ?? 0;
          const timeout = setTimeout(async () => {
            turnOffTimeoutsByZone.delete(zoneName);
            if (speakers.size === 0) {
              await rustplusClient.setSwitch(zone.switchEntityId, false);
            }
          }, offDelayMs);
          turnOffTimeoutsByZone.set(zoneName, timeout);
        }
        // If speakers isn't empty, someone else in THIS zone is still talking — its switch stays on.
      }

      console.log(
        `[domeOfSilence] zone="${zoneName}" ${data.player?.name} speaking=${data.speaking} — ${speakers.size} currently speaking in this zone`,
      );
    } catch (err) {
      errors.push(`zone "${zoneName}": ${err.message}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, reason: errors.join("; "), affectedZones };
  }
  return { ok: true, affectedZones };
}

module.exports = {
  arm,
  disarm,
  isArmed,
  listArmedZones,
  handleVoiceStateForDome,
};
