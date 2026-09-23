// Feature: Death cam
// If death event's weapon/damageType indicates a landmine, increase a
// persisted counter and instantly grab a frame from the VICTIM's stream and
// paint it to canvas.
//
// Trigger type: AUTOMATED ONLY — this is driven off the player_death webhook
// event; there's no sensible "manual" version of "someone just died to a
// landmine". Wire handlePlayerDeathForDeathCam into webhookHandlers.js's
// player_death handler.
//
// NOTE ON MATCHING "landmine": the plugin doc says weapon is "short prefab
// name or null" — confirmed the actual value is exactly "landmine".

const config = require('../config');
const state = require('../stateStore');
const twitchMap = require('../twitchMap');
const { grabFrameForUser } = require('../frameGrabber');
const { writeAndHost } = require('../imageHost');
const rustApi = require('../rustPluginClient');

const COUNTER_KEY = 'landmineDeaths';

function isLandmineDeath(data) {
  return typeof data.weapon === 'string' && data.weapon.toLowerCase() === 'landmine';
}

function getLandmineDeathCount() {
  return state.get(COUNTER_KEY, 0);
}

/**
 * Call this from your player_death webhook handler. Fire-and-forget from
 * there (don't await inside the handler) — see the comment pattern already
 * in webhookHandlers.js's handleButtonPress example.
 *
 * @param {object} data the player_death event's `data` object
 * @returns {Promise<{ok:true,count:number,url:string}|{ok:false,reason:string}|{ok:true,skipped:true}>}
 */
async function handlePlayerDeathForDeathCam(data) {
  if (!isLandmineDeath(data)) {
    return { ok: true, skipped: true };
  }

  const newCount = getLandmineDeathCount() + 1;
  state.set(COUNTER_KEY, newCount);
  console.log(`[deathCam] landmine death #${newCount}`);

  const victimSteamId = data.victim?.steamId;
  if (!victimSteamId) {
    return { ok: false, reason: 'landmine death event had no victim steamId' };
  }

  const netId = config.canvases.deathCam;
  if (!netId) {
    return { ok: false, reason: 'CANVAS_NETID_DEATH_CAM is not set' };
  }

  const twitchUsername = twitchMap.getTwitchUsername(victimSteamId);
  if (!twitchUsername) {
    return { ok: false, reason: `no twitch username mapped for steamId ${victimSteamId}`, count: newCount };
  }

  try {
    const frame = await grabFrameForUser(twitchUsername);
    const url = await writeAndHost(frame, { subdir: 'deathcam', prefix: victimSteamId });
    await rustApi.paintCanvas(netId, url);
    return { ok: true, count: newCount, url };
  } catch (err) {
    return { ok: false, reason: err.message, count: newCount };
  }
}

module.exports = { handlePlayerDeathForDeathCam, getLandmineDeathCount, isLandmineDeath };
