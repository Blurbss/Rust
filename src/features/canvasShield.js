// Feature: Canvas shield
// Grab a stream frame from the character nearest your own, crop just the
// MIDDLE of their screen (no face detection — the hope is that's roughly
// where their own view of your character sits), paint it to a canvas, then
// move that canvas directly in front of your character to fake the illusion
// of invisibility/camouflage. After CANVAS_SHIELD_RETURN_DELAY_MS, the
// canvas automatically returns to a fixed "home" position rather than
// staying in front of your face indefinitely.
//
// SEQUENCE, and why it's ordered this way: move-then-paint (the original
// order) caused visible glitching — the canvas would already be sitting in
// front of the player showing a blank/stale texture during the brief window
// between the paint call being accepted and the image actually rendering
// (the plugin's own doc: a paint is "queued... plays a moment later", not
// instant). Fixed by staging the canvas CANVAS_SHIELD_STAGING_OFFSET_Y units
// below the intended position first — hidden underground — loading the new
// image while it's out of sight there, and only pulling it up into the
// actual visible position once the image is already loaded:
//   1. Move to the hidden staging position (intended position, Y lowered)
//   2. Grab/crop/host the frame, paint the canvas (still hidden)
//   3. Move UP to the actual intended position (now showing the loaded image)
//   4. After the duration, return to the home position (vanish)
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
//
// RACE GUARD: if activateCanvasShield is triggered again on the same netId
// before the previous activation's 10s return timer fires, the OLD timer
// would otherwise yank the canvas back home right after the NEW activation
// just repositioned it. Fixed with the same per-target generation-counter
// pattern used in playerCanvasTimer.js — each activation bumps a counter for
// that netId, and a scheduled return-home only actually fires if nothing
// newer has activated the shield on that same netId since.

const config = require("../config");
const twitchMap = require("../twitchMap");
const { grabFrameForUser } = require("../frameGrabber");
const { cropCenter } = require("../centerCrop");
const { writeAndHost } = require("../imageHost");
const rustApi = require("../rustPluginClient");

const generationByCanvas = new Map();

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
  const nearby = await rustApi.getPlayersNear(
    myLook.eyes.x,
    myLook.eyes.z,
    searchRadius,
  );

  const others = nearby.filter((p) => p.steamId !== config.myPlayer.steamId);
  if (others.length === 0) return null;

  others.sort(
    (a, b) =>
      distance2D(a.position, myLook.eyes) - distance2D(b.position, myLook.eyes),
  );
  return others[0];
}

/**
 * TODO/VERIFY: placeholder geometry — see file header. Computes a position
 * `distance` meters in front of your own look direction, and a yaw meant to
 * face the canvas back toward you (i.e. opposite your own facing direction).
 */
async function computeTransformInFrontOfPlayer(distance = 0.5) {
  const myLook = await rustApi.getPlayerLook(config.myPlayer.steamId);
  const { eyes, direction } = myLook;

  const targetPosition = {
    x: eyes.x + direction.x * distance,
    y: eyes.y + direction.y * distance - 1.5,
    z: eyes.z + direction.z * distance,
  };

  // Placeholder yaw calc — verify against Rust's actual convention in-game.
  const yawFacingMe = (Math.atan2(direction.x, direction.z) * 180) / Math.PI;

  return {
    x: targetPosition.x,
    y: targetPosition.y,
    z: targetPosition.z,
    yaw: yawFacingMe,
  };
}

/**
 * Schedules the canvas returning to its home position after returnDelayMs,
 * skipping if a newer activation on this same netId has happened since.
 */
function scheduleReturnHome(netId, myGeneration, returnDelayMs) {
  setTimeout(async () => {
    if (generationByCanvas.get(netId) !== myGeneration) {
      console.log(
        `[canvasShield] skipped return-home for netId ${netId} — a newer activation happened since`,
      );
      return;
    }
    try {
      await rustApi.moveCanvas(netId, config.canvasShieldReturn.homePosition);
      console.log(
        `[canvasShield] returned netId ${netId} to home position after ${returnDelayMs}ms`,
      );
    } catch (err) {
      console.warn(
        `[canvasShield] return-home failed for netId ${netId}:`,
        err.message,
      );
    }
  }, returnDelayMs);
}

/**
 * @param {string} netId tracked canvas net ID
 * @returns {Promise<{ok:true,url:string}|{ok:false,reason:string}>}
 */
async function activateCanvasShield(netId) {
  if (!config.myPlayer.steamId) {
    return {
      ok: false,
      reason:
        'MY_STEAM_ID is not set — required to find "nearest player" and "in front of me"',
    };
  }

  // Compute the real target transform up front, and derive the hidden
  // staging transform from it (same x/z/yaw, just lower) — both need the
  // SAME look-direction snapshot, so this is computed once here rather than
  // calling computeTransformInFrontOfPlayer twice (which would re-sample
  // your position/direction separately for each call, and could drift if
  // you're turning while this runs).
  let targetTransform;
  try {
    targetTransform = await computeTransformInFrontOfPlayer();
  } catch (err) {
    return {
      ok: false,
      reason: `failed to compute target position: ${err.message}`,
    };
  }
  const stagingTransform = {
    ...targetTransform,
    y: targetTransform.y - config.canvasShieldStaging.offsetY,
  };

  // Step 1: hide it immediately, before doing anything else that takes time.
  try {
    await rustApi.moveCanvas(netId, stagingTransform);
  } catch (err) {
    return {
      ok: false,
      reason: `failed to move canvas to staging position: ${err.message}`,
    };
  }

  let nearest;
  try {
    nearest = await findNearestPlayer();
  } catch (err) {
    return {
      ok: false,
      reason: `failed to find nearest player: ${err.message}`,
    };
  }
  if (!nearest) {
    return { ok: false, reason: "no other players found nearby" };
  }

  const twitchUsername = twitchMap.getTwitchUsername(nearest.steamId);
  if (!twitchUsername) {
    return {
      ok: false,
      reason: `nearest player (${nearest.steamId}) has no twitch username mapped`,
    };
  }

  let cropped;
  try {
    const frame = await grabFrameForUser(twitchUsername);
    cropped = await cropCenter(frame, {
      widthFraction: 0.35,
      heightFraction: 0.35,
    });
  } catch (err) {
    return { ok: false, reason: `frame grab/crop failed: ${err.message}` };
  }

  // Step 2: load the image while still hidden at the staging position.
  let url;
  try {
    url = await writeAndHost(cropped, {
      subdir: "canvas-shield",
      prefix: nearest.steamId,
    });
    await rustApi.paintCanvas(netId, url);
  } catch (err) {
    return { ok: false, reason: `painting canvas failed: ${err.message}` };
  }

  // Bump the generation for this netId BEFORE revealing it, so any
  // still-pending return-home timer from a previous activation sees a
  // mismatch and skips itself once it fires.
  const myGeneration = (generationByCanvas.get(netId) || 0) + 1;
  generationByCanvas.set(netId, myGeneration);

  // Step 3: pull it up into the actual visible position, image already loaded.
  try {
    await rustApi.moveCanvas(netId, targetTransform);
  } catch (err) {
    // Paint succeeded even if the reveal failed — report both states honestly.
    return {
      ok: false,
      reason: `painted but failed to reveal canvas (still hidden at staging position): ${err.message}`,
      url,
    };
  }

  // Step 4: vanish after the duration.
  scheduleReturnHome(
    netId,
    myGeneration,
    config.canvasShieldReturn.returnDelayMs,
  );

  return { ok: true, url };
}

module.exports = {
  activateCanvasShield,
  findNearestPlayer,
  computeTransformInFrontOfPlayer,
};
