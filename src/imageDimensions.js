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
  let x = Math.max(0, Math.min(Math.round(box.x), dims.width - 1));
  let y = Math.max(0, Math.min(Math.round(box.y), dims.height - 1));
  let width = Math.max(0, Math.min(Math.round(box.width), dims.width - x));
  let height = Math.max(0, Math.min(Math.round(box.height), dims.height - y));

  if (width < 10 || height < 10) return null; // too small to be a real facecam crop
  return { x, y, width, height };
}

module.exports = { getJpegDimensions, clampBox };
