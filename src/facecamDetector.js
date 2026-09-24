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
{"found": true, "cx": 0.0, "cy": 0.0, "width": 0.0, "height": 0.0}
or
{"found": false}
cx, cy are the CENTER of the FACE itself — specifically, the midpoint between eye level and the
bottom of the nose, roughly where the bridge of the nose sits. Do NOT center on the whole webcam
overlay or camera feed as a box — ignore hair, headphones, a hat, a microphone, shoulders, or
torso when picking this point. Those extend by very different amounts above/below/beside the face
depending on the streamer's camera framing, so anchoring to the face itself (not the overall
overlay shape) keeps the point consistent regardless of how much extra headroom or shoulder is
visible. cx, cy are fractions of the image's total width/height (0.0 to 1.0). x=0,y=0 is the
top-left corner; x=1,y=1 is the bottom-right corner.
width and height are ROUGH estimates of how much space to include AROUND that face point for a
good crop (enough to comfortably contain the whole head, and typically a bit of the surrounding
overlay) — as a fraction of the image's total width and height respectively. These do NOT need to
be precise or equal to each other — most facecam overlays are wider than they are tall, or vice
versa, so estimate each dimension independently rather than assuming a square shape.
We'll add generous padding around your point automatically, so focus your effort on getting the
FACE-CENTER point right, and the rough proportions (wide-and-short, tall-and-narrow, or roughly
square) rather than trying to perfect the exact edges.
Example: a face centered near the right side of the frame, at eye level roughly a third of the way
down from the top, in an overlay that's moderately wide and moderately tall, would be
{"found": true, "cx": 0.85, "cy": 0.33, "width": 0.3, "height": 0.35}.`;

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON found in model response: ${text}`);
  return JSON.parse(match[0]);
}

/**
 * @param {Buffer} imageBuffer JPEG frame
 * @param {{width:number,height:number}} dims actual pixel dimensions of imageBuffer
 *   (kept for signature compatibility; not directly used since coordinates are fractional)
 * @param {string} [streamerHint] optional outlier-case addition from streamerHints.js,
 *   appended to the system prompt for THIS call only. When omitted, the prompt sent
 *   is byte-identical to every other call — this never alters detection for anyone
 *   this hint isn't specifically written for.
 * @returns {Promise<{found:false}|{found:true,cx:number,cy:number,width:number,height:number}>}
 *   cx/cy are the fractional (0.0-1.0) CENTER point of the face; width/height are rough
 *   independent fractional size estimates (not assumed square — real overlays rarely are).
 *   Center-point estimation is a task vision models handle far more reliably than precise
 *   box-edge regression.
 */
async function detectFacecam(imageBuffer, dims, streamerHint) {
  if (!config.openai.apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const base64 = imageBuffer.toString('base64');
  const userText = 'Find the facecam in this frame, if any. Return its center point (cx, cy) and rough width/height, as independent fractions of the image (0.0-1.0) — do not assume a square shape.';

  const systemPrompt = streamerHint ? `${SYSTEM_PROMPT}\n\n${streamerHint}` : SYSTEM_PROMPT;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openai.apiKey}`
    },
    body: JSON.stringify({
      model: config.openai.model,
      messages: [
        { role: 'system', content: systemPrompt },
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
