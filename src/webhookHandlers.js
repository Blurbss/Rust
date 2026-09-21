// One function per event name from the WEBHOOKS section of the plugin spec.
// Each receives the event's `data` object plus the full envelope (for timestamp etc).

function handleButtonPress(data /* { netId, position, grid, player } */, envelope) {
  console.log(`[button_press] grid=${data.grid} netId=${data.netId} by=${data.player?.name}`);

  // TODO: wire this up, e.g.:
  // if (data.netId === rowSwitchArray[currentIndex]) { ... advance sequence ... }
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
