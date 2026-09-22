// One function per event name from the WEBHOOKS section of the plugin spec.
// Each receives the event's `data` object plus the full envelope (for timestamp etc).

// const { updateFacecamOnCanvas } = require('./facecamPipeline');
// const FACECAM_CANVAS_NET_ID = '224081304'; // whichever tracked canvas you want it painted on

function handleButtonPress(data /* { netId, position, grid, player } */, envelope) {
  console.log(`[button_press] grid=${data.grid} netId=${data.netId} by=${data.player?.name}`);

  // TODO: wire this up, e.g.:
  // if (data.netId === rowSwitchArray[currentIndex]) { ... advance sequence ... }

  // Example: trigger the facecam pipeline off a specific button press.
  // Fire-and-forget — don't await inside a webhook handler, since the response
  // to the plugin was already sent before dispatch() runs.
  // if (data.netId === SOME_TRIGGER_NET_ID && data.player?.steamId) {
  //   updateFacecamOnCanvas(data.player.steamId, FACECAM_CANVAS_NET_ID)
  //     .then((result) => {
  //       if (!result.ok) console.warn('[facecam] skipped:', result.reason);
  //     });
  // }
}

function handlePlayerDeath(data /* { victim, position, grid, attacker, weapon, damageType } */, envelope) {
  const attacker = data.attacker ? data.attacker.name : 'unknown/npc';
  console.log(`[player_death] ${data.victim?.name} died in ${data.grid}, killed by ${attacker} (${data.weapon || data.damageType})`);

  // TODO: e.g. trigger a stream alert, TTS callout, etc.
}

function handleVoiceState(data /* { player, speaking, position, grid } */, envelope) {
  // Only arrives if you've created a voice subscription (POST /subscriptions)
  // covering the player's position — not sent to the general webhook otherwise.
  console.log(`[voice_state] ${data.player?.name} speaking=${data.speaking} in ${data.grid}`);
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
