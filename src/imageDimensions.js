// Reads width/height straight out of JPEG SOF markers — no ffprobe process
// spawn needed, just a buffer scan. Used to (a) ground the vision prompt with
// the real frame size and (b) clamp whatever box comes back so a bad/oversized
// response can never crash the ffmpeg crop step.

function getJpegDimensions(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error('Not a valid JPEG (missing SOI marker)');
  }

  let offset = 2;
  while (offset < buffer.length - 1) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = buffer[offset + 1];

    // SOF0-SOF15 (excluding DHT 0xC4, JPG 0xC8, DAC 0xCC) all carry dimensions
    // in the same position.
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isSof) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return { width, height };
    }

    // Markers with no payload to skip (shouldn't appear before SOF, but be safe)
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }

    const segmentLength = buffer.readUInt16BE(offset + 2);
    offset += 2 + segmentLength;
  }

  throw new Error('Could not find JPEG dimensions (no SOF marker found)');
}

/**
 * Clamps a model-provided box to fit inside the real image bounds, so an
 * out-of-range or hallucinated box can never reach ffmpeg. Returns null if
 * nothing sane is left after clamping (e.g. box was entirely outside the frame).
 */
function clampBox(box, dims) {
  // Cap size to the frame first — a box literally can't be bigger than the
  // image it's cropped from.
  let width = Math.min(Math.round(box.width), dims.width);
  let height = Math.min(Math.round(box.height), dims.height);

  if (width < 10 || height < 10) return null; // too small to be a real facecam crop

  let x = Math.round(box.x);
  let y = Math.round(box.y);

  // Slide (don't shrink) the box back inside the frame if it overflows an
  // edge. This matters a lot for facecams pinned near the actual edge of the
  // video — shrinking the box there would truncate straight through the
  // face; sliding it preserves the full crop size and just repositions the
  // window to capture it entirely.
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x + width > dims.width) x = dims.width - width;
  if (y + height > dims.height) y = dims.height - height;

  return { x, y, width, height };
}

/**
 * Builds a crop box from a center point + rough width/height estimates, with
 * generous padding and hard min/max bounds on each axis independently — designed
 * so that even a somewhat-off center point or a wrong size estimate still
 * produces a sane crop that contains the actual face, and so the crop's
 * aspect ratio can actually match the real overlay shape (most facecams are
 * wider than tall, or vice versa — never assume square).
 *
 * @param {{cx:number, cy:number, width:number, height:number}} point fractional (0-1)
 *   center point plus independent rough width/height estimates
 * @param {{width:number, height:number}} dims real pixel dimensions of the frame
 * @param {object} [opts]
 * @param {number} [opts.paddingMultiplier] how much bigger than the raw estimate
 *   the crop window should be on each axis (e.g. 1.8 = 80% bigger), to absorb
 *   center/size error
 * @param {number} [opts.minFraction] crop width/height will never be smaller than
 *   this fraction of the frame's respective dimension
 * @param {number} [opts.maxFraction] crop width/height will never be larger than
 *   this fraction of the frame's respective dimension
 */
function buildCropFromCenter(point, dims, opts = {}) {
  const paddingMultiplier = opts.paddingMultiplier ?? 1.8;
  const minFraction = opts.minFraction ?? 0.08;
  const maxFraction = opts.maxFraction ?? 0.5;

  const rawWidthFraction = Math.max(0, point.width || 0);
  const rawHeightFraction = Math.max(0, point.height || 0);

  const paddedWidthFraction = Math.min(maxFraction, Math.max(minFraction, rawWidthFraction * paddingMultiplier));
  const paddedHeightFraction = Math.min(maxFraction, Math.max(minFraction, rawHeightFraction * paddingMultiplier));

  const cropWidth = paddedWidthFraction * dims.width;
  const cropHeight = paddedHeightFraction * dims.height;

  const cx = point.cx * dims.width;
  const cy = point.cy * dims.height;

  return clampBox(
    {
      x: cx - cropWidth / 2,
      y: cy - cropHeight / 2,
      width: cropWidth,
      height: cropHeight
    },
    dims
  );
}

module.exports = { getJpegDimensions, clampBox, buildCropFromCenter };
