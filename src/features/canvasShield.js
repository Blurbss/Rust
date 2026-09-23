// Feature: Canvas shield
// Grab a stream frame from the character nearest your own, crop just the
// MIDDLE of their screen (no face detection — the hope is that's roughly
// where their own view of your character sits), paint it to a canvas, then
// move that canvas directly in front of your character to fake the illusion
// of invisibility/camouflage.
//
// Trigger type: MANUAL primarily (see /manual/canvas-shield route) — you'd
// trigger this yourself in the moment, not off an automated event.
//
// VERIFY BEFORE RELYING ON THIS IN A REAL FIGHT:
// 1. "Nearest player" excludes you by MY_STEAM_ID (config.myPlayer.steamId) —
//    set that in .env or this will happily pick yourself as "nearest".
// 2. The yaw/rotation math below is a best-effort placeholder, NOT verified
//    against Rust's actual coordinate/rotation conventions (which axis is
//    "north", clockwise vs counterclockwise, whether moveCanvas's yaw means
//    the same thing as the player look direction's implied heading). Test
//    this against a real canvas and adjust the formula in
//    computeTransformInFrontOfPlayer before trusting it live.

const config = require('../config');
const twitchMap = require('../twitchMap');
const { grabFrameForUser } = require('../frameGrabber');
const { cropCenter } = require('../centerCrop');
const { writeAndHost } = require('../imageHost');
const rustApi = require('../rustPluginClient');

/** Straight-line distance between two {x,z} points (ignoring y/height). */
function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Finds the nearest other player to your own position.
 * @param {number} searchRadius meters to search within
 * @returns {Promise<object|null>} the plugin's player object, or null if none found
 */
async function findNearestPlayer(searchRadius = 50) {
  const myLook = await rustApi.getPlayerLook(config.myPlayer.steamId);
  const nearby = await rustApi.getPlayersNear(myLook.eyes.x, myLook.eyes.z, searchRadius);

  const others = nearby.filter((p) => p.steamId !== config.myPlayer.steamId);
  if (others.length === 0) return null;

  others.sort((a, b) => distance2D(a.position, myLook.eyes) - distance2D(b.position, myLook.eyes));
  return others[0];
}

/**
 * TODO/VERIFY: placeholder geometry — see file header. Computes a position
 * `distance` meters in front of your own look direction, and a yaw meant to
 * face the canvas back toward you (i.e. opposite your own facing direction).
 */
async function computeTransformInFrontOfPlayer(distance = 1.5) {
  const myLook = await rustApi.getPlayerLook(config.myPlayer.steamId);
  const { eyes, direction } = myLook;

  const targetPosition = {
    x: eyes.x + direction.x * distance,
    y: eyes.y + direction.y * distance,
    z: eyes.z + direction.z * distance
  };

  // Placeholder yaw calc — verify against Rust's actual convention in-game.
  const yawFacingMe = (Math.atan2(-direction.x, -direction.z) * 180) / Math.PI;

  return { x: targetPosition.x, y: targetPosition.y, z: targetPosition.z, yaw: yawFacingMe };
}

/**
 * @param {string} netId tracked canvas net ID
 * @returns {Promise<{ok:true,url:string}|{ok:false,reason:string}>}
 */
async function activateCanvasShield(netId) {
  if (!config.myPlayer.steamId) {
    return { ok: false, reason: 'MY_STEAM_ID is not set — required to find "nearest player" and "in front of me"' };
  }

  let nearest;
  try {
    nearest = await findNearestPlayer();
  } catch (err) {
    return { ok: false, reason: `failed to find nearest player: ${err.message}` };
  }
  if (!nearest) {
    return { ok: false, reason: 'no other players found nearby' };
  }

  const twitchUsername = twitchMap.getTwitchUsername(nearest.steamId);
  if (!twitchUsername) {
    return { ok: false, reason: `nearest player (${nearest.steamId}) has no twitch username mapped` };
  }

  let cropped;
  try {
    const frame = await grabFrameForUser(twitchUsername);
    cropped = await cropCenter(frame, { widthFraction: 0.35, heightFraction: 0.35 });
  } catch (err) {
    return { ok: false, reason: `frame grab/crop failed: ${err.message}` };
  }

  let url;
  try {
    url = await writeAndHost(cropped, { subdir: 'canvas-shield', prefix: nearest.steamId });
    await rustApi.paintCanvas(netId, url);
  } catch (err) {
    return { ok: false, reason: `painting canvas failed: ${err.message}` };
  }

  try {
    const transform = await computeTransformInFrontOfPlayer();
    await rustApi.moveCanvas(netId, transform);
  } catch (err) {
    // Paint succeeded even if positioning failed — report both states honestly.
    return { ok: false, reason: `painted but failed to reposition canvas: ${err.message}`, url };
  }

  return { ok: true, url };
}

module.exports = { activateCanvasShield, findNearestPlayer, computeTransformInFrontOfPlayer };
