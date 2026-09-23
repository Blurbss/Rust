// Feature: Dome of Silence
// Create a voip detection range (circle) around your current coordinate, then
// if voice is detected inside it, signal a smart switch.
//
// Trigger type: setup() is MANUAL (call once when you want to arm it — see
// /manual/dome-of-silence/arm route). The actual detection is AUTOMATED: the
// plugin sends voice_state events to the subscription's URL, which lands on
// your /webhook route same as any other event — wire handleVoiceStateForDome
// into webhookHandlers.js's voice_state handler.
//
// State (origin, radius, subscription id) persists via stateStore.js so a
// restart doesn't lose an armed dome — but note the PLUGIN's own subscription
// survives independently of this app; disarm() deletes it properly rather
// than just forgetting about it, so you don't leak orphaned subscriptions on
// their server.

const config = require("../config");
const state = require("../stateStore");
const rustApi = require("../rustPluginClient");
const rustplusClient = require("../rustplusClient");

const STATE_KEY = "domeOfSilence";

/**
 * Arms the dome: reads your current position and creates a circular voice
 * subscription centered on it.
 * @returns {Promise<{ok:true,subscriptionId:string}|{ok:false,reason:string}>}
 */
async function arm() {
  if (!config.myPlayer.steamId) {
    return { ok: false, reason: "MY_STEAM_ID is not set" };
  }

  const existing = state.get(STATE_KEY);
  if (existing) {
    return {
      ok: false,
      reason: `already armed (subscription ${existing.subscriptionId}) — call disarm() first`,
    };
  }

  let myLook;
  try {
    myLook = await rustApi.getPlayerLook(config.myPlayer.steamId);
  } catch (err) {
    return { ok: false, reason: `could not get your position: ${err.message}` };
  }

  const webhookUrl = `${config.publicBaseUrl}/webhook?key=${config.webhookSecret}`;

  let subscription;
  try {
    subscription = await rustApi.createSubscription({
      url: webhookUrl,
      x: myLook.eyes.x,
      z: myLook.eyes.z,
      radius: config.domeOfSilence.radius,
    });
  } catch (err) {
    return {
      ok: false,
      reason: `failed to create subscription: ${err.message}`,
    };
  }

  state.set(STATE_KEY, {
    subscriptionId: subscription.id,
    originX: myLook.eyes.x,
    originZ: myLook.eyes.z,
    radius: config.domeOfSilence.radius,
    armedAt: Date.now(),
  });

  return { ok: true, subscriptionId: subscription.id };
}

/** Disarms the dome: deletes the plugin-side subscription and clears local state. */
async function disarm() {
  const existing = state.get(STATE_KEY);
  if (!existing) {
    return { ok: false, reason: "not currently armed" };
  }

  try {
    await rustApi.deleteSubscription(existing.subscriptionId);
  } catch (err) {
    // Still clear local state even if the delete failed (e.g. already gone
    // on their side) — don't get permanently stuck unable to re-arm.
    console.warn(
      "[domeOfSilence] deleteSubscription failed, clearing local state anyway:",
      err.message,
    );
  }

  state.remove(STATE_KEY);
  return { ok: true };
}

function isArmed() {
  return !!state.get(STATE_KEY);
}

/**
 * Call this from your voice_state webhook handler for EVERY voice_state
 * event you receive — it no-ops if the dome isn't armed, and it's your own
 * responsibility to only wire this up to events that actually came from this
 * dome's subscription URL (they will, since the plugin only sends voice_state
 * to subscription URLs that cover the speaking player's position).
 *
 * @param {object} data the voice_state event's `data` object
 */
async function handleVoiceStateForDome(data) {
  const dome = state.get(STATE_KEY);
  if (!dome) return { ok: true, skipped: true };

  // Don't trigger on your own voice.
  //if (data.player?.steamId === config.myPlayer.steamId)
  //  return { ok: true, skipped: true };

  const entityId = config.domeOfSilence.switchEntityId;
  if (!entityId) {
    return { ok: false, reason: "DOME_SWITCH_ENTITY_ID is not set" };
  }

  try {
    if (data.speaking) await rustplusClient.setSwitch(entityId, true);
    else {
      setTimeout(async () => {
        await rustplusClient.setSwitch(entityId, false);
      }, 3000);
    }
    console.log(
      `[domeOfSilence] voice detected from ${data.player?.name}, switch triggered`,
    );
    return { ok: true, triggeredBy: data.player };
  } catch (err) {
    return { ok: false, reason: `failed to trigger switch: ${err.message}` };
  }
}

module.exports = { arm, disarm, isArmed, handleVoiceStateForDome };
