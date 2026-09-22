// Sends a single frame to OpenAI and asks for the streamer's facecam location as
// a FRACTIONAL bounding box (0.0-1.0 of width/height), not exact pixels — vision
// models are reliably in-the-neighborhood but not pixel-precise, especially once
// the image is internally resized/tiled before the model sees it. Image detail
// level (low/high) is configurable via OPENAI_IMAGE_DETAIL — low is faster/cheaper,
// high gives the model more visual fidelity to work with.

const config = require('./config');

const SYSTEM_PROMPT = `You are analyzing a single frame from a Rust (the survival game) Twitch stream.
Your job is to locate the STREAMER'S OWN FACE overlaid on top of the gameplay — either a real
human face from their webcam, or a VTuber-style animated avatar face — if one is visible.

You are looking for an actual FACE, not a box, panel, or frame shape. Do not select something
just because it is rectangular or camera-shaped:
- Ignore chat boxes, alert/donation/subscriber-goal panels, follower trackers, event lists, maps,
  inventory, health/hunger bars, or any other rectangular UI overlay that does not itself contain
  a visible face.
- Ignore an empty webcam border/frame if no actual face is currently visible inside it (camera off,
  blocked, or the frame is purely decorative).
- Many streamers green-screen their background out entirely, so their face and upper body appear
  as a free-floating cutout with NO rectangular border, panel, or background behind them at all.
  This is still exactly what you're looking for — just without an obvious box drawn around it. In
  that case, return a tight box around the visible face/head/shoulders region itself, not any
  surrounding UI.

What counts as a match:
- A real human face (webcam feed, bordered or borderless/green-screened), OR
- A VTuber-style animated/2D avatar's face acting as their camera replacement.
Either one is placed by the streamer and is almost always positioned along one of the screen's
edges or in a corner (top, bottom, left, right) — essentially never dead center. It can be large
or small — do not assume it must be a small box.

How to tell a real face from UI graphics:
- A real human face has natural skin tones, individual features (eyes, nose, mouth, hair, facial
  hair, headphones or a microphone), and looks like a photograph of a person — not a flat vector
  icon, a solid-color panel, or text/numbers.
- A VTuber avatar is a stylized but still clearly face-shaped character with eyes and a mouth —
  not a flat icon or bar graphic either.
- Health bars, ammo counts, money/score readouts, kill trackers, and other numeric or icon-based
  HUD elements are NEVER a face, no matter how close they sit to one.
- Judge the face independently of what's next to it: a facecam is very often placed directly
  touching or overlapping other HUD elements (stat bars, meters, counters). Do not dismiss a real
  face just because it's adjacent to or touching other UI — only judge whether a face is visible
  in that specific region.

What must NOT be confused with it:
- The in-game Rust character's face or head. That's part of the 3D game world, can appear
  anywhere including dead center, and is never the facecam even when a realistic face is visible.
- Any box-shaped UI element that does not itself contain a face — a rectangle alone is never
  sufficient grounds for a match.

If no real human face or VTuber avatar is visible anywhere in the frame, say so plainly. Do not
default to picking some other box-shaped overlay just because you couldn't find a face — a
"found: false" answer is correct and expected for streamers with no facecam at all.

Respond with ONLY compact JSON, no prose, no markdown fences, in exactly this shape:
{"found": true, "x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0}
or
{"found": false}
x, y, width, and height are FRACTIONS of the image's total width/height, from 0.0 to 1.0 — NOT
pixel values. x=0,y=0 is the top-left corner; x=1,y=1 is the bottom-right corner. For example, a
face occupying the left 20% and bottom 30% of the frame would be roughly
{"found": true, "x": 0.0, "y": 0.7, "width": 0.2, "height": 0.3}.
It's fine to include a small margin around the face rather than cropping it exactly tight —
err slightly generous rather than cutting off part of the face.`;

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON found in model response: ${text}`);
  return JSON.parse(match[0]);
}

/**
 * @param {Buffer} imageBuffer JPEG frame
 * @param {{width:number,height:number}} dims actual pixel dimensions of imageBuffer,
 *   kept as a parameter for compatibility even though the prompt now asks for
 *   fractional (0-1) coordinates rather than exact pixels — precise pixel
 *   regression is something vision models are unreliable at, especially once
 *   the image is internally resized/tiled before the model sees it.
 * @returns {Promise<{found:false}|{found:true,x:number,y:number,width:number,height:number}>}
 *   x/y/width/height are fractions of image width/height (0.0-1.0), not pixels.
 */
async function detectFacecam(imageBuffer, dims) {
  if (!config.openai.apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const base64 = imageBuffer.toString('base64');
  const userText = 'Find the facecam in this frame, if any. Return x, y, width, and height as fractions of the image (0.0-1.0), not pixels.';

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openai.apiKey}`
    },
    body: JSON.stringify({
      model: config.openai.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64}`,
                detail: config.openai.imageDetail
              }
            }
          ]
        }
      ],
      max_tokens: 100,
      temperature: 0
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI response had no content');

  return extractJson(content);
}

module.exports = { detectFacecam };
