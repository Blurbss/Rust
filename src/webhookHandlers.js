// One function per event name from the WEBHOOKS section of the plugin spec.
// Each receives the event's `data` object plus the full envelope (for timestamp etc).

const buttonFrameGrab = require('./features/buttonFrameGrab');
const deathCam = require('./features/deathCam');
const domeOfSilence = require('./features/domeOfSilence');
const config = require('./config');

// TODO: set these to your actual in-game button net IDs (blurbs.netid while
// looking at each button). Every button-triggered capture below uses the
// SAME underlying face-detection call (buttonFrameGrab.triggerButtonFrameGrab
// -> facecamPipeline.updateFacecamOnCanvas, untouched) — what differs per
// button is just which canvas it paints to and whether it's gated to
// once-per-person via a gadgetName.
const PHOTO_BOOTH_BUTTON_NET_ID = '';
const SECURITY_SYSTEM_BUTTON_NET_ID = '';

function handleButtonPress(data /* { netId, position, grid, player } */, envelope) {
  console.log(`[button_press] grid=${data.grid} netId=${data.netId} by=${data.player?.name}`);

  // TODO: wire other button-driven game logic here too, e.g.:
  // if (data.netId === rowSwitchArray[currentIndex]) { ... advance sequence ... }

  // Fire-and-forget in all cases below — don't await inside a webhook
  // handler, since the response to the plugin was already sent before
  // dispatch() runs.

  if (!data.player?.steamId) return;

  // Photo booth: once per person.
  if (PHOTO_BOOTH_BUTTON_NET_ID && data.netId === PHOTO_BOOTH_BUTTON_NET_ID) {
    buttonFrameGrab
      .triggerButtonFrameGrab(data.player.steamId, config.canvases.photoBooth, { gadgetName: 'photo-booth' })
      .then((result) => {
        if (!result.ok) console.warn('[photoBooth] skipped:', result.reason);
      });
  }

  // Security system: also once per person, but a completely separate limit
  // from the photo booth above even though it's the same underlying call.
  if (SECURITY_SYSTEM_BUTTON_NET_ID && data.netId === SECURITY_SYSTEM_BUTTON_NET_ID) {
    buttonFrameGrab
      .triggerButtonFrameGrab(data.player.steamId, config.canvases.securitySystem, { gadgetName: 'security-system' })
      .then((result) => {
        if (!result.ok) console.warn('[securitySystem] skipped:', result.reason);
      });
  }

  // For a button-triggered capture with NO once-per-person limit, omit
  // gadgetName entirely:
  // buttonFrameGrab.triggerButtonFrameGrab(data.player.steamId, someNetId).then(...)
}

function handlePlayerDeath(data /* { victim, position, grid, attacker, weapon, damageType } */, envelope) {
  const attacker = data.attacker ? data.attacker.name : 'unknown/npc';
  console.log(`[player_death] ${data.victim?.name} died in ${data.grid}, killed by ${attacker} (${data.weapon || data.damageType})`);

  // TODO: other death-triggered logic (stream alert, TTS callout, etc).

  // Death cam: self-gating — it checks isLandmineDeath internally and no-ops
  // otherwise, so this is safe to leave active even before you've tuned
  // anything else.
  deathCam.handlePlayerDeathForDeathCam(data).then((result) => {
    if (!result.ok) console.warn('[deathCam] failed:', result.reason);
  });
}

function handleVoiceState(data /* { player, speaking, position, grid } */, envelope) {
  // Only arrives if you've created a voice subscription (POST /subscriptions)
  // covering the player's position — not sent to the general webhook otherwise.
  console.log(`[voice_state] ${data.player?.name} speaking=${data.speaking} in ${data.grid}`);

  // Dome of Silence: self-gating — no-ops if the dome isn't currently armed
  // (see /manual/dome/arm), so safe to leave active by default.
  domeOfSilence.handleVoiceStateForDome(data).then((result) => {
    if (!result.ok) console.warn('[domeOfSilence] failed:', result.reason);
  });
}

const handlers = {
  button_press: handleButtonPress,
  player_death: handlePlayerDeath,
  voice_state: handleVoiceState
};

/** Dispatches a decoded {event, timestamp, data} envelope to its handler. */
function dispatch(envelope) {
  const handler = handlers[envelope.event];
  if (!handler) {
    console.warn(`[webhook] No handler for event type "${envelope.event}"`);
    return;
  }
  handler(envelope.data, envelope);
}

module.exports = { dispatch };
