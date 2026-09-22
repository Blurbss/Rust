// Sends a single frame to OpenAI and asks for a pixel bounding box around the
// streamer's facecam, if present. Uses image detail:"low" deliberately —
// we only need a rough rectangle, not fine detail, and low-detail requests
// are processed faster and cheaper.

const config = require('./config');

const SYSTEM_PROMPT = `You are analyzing a single frame from a Rust (the survival game) Twitch stream.
Your only job is to find the streamer's webcam/facecam overlay, if one is present, and return its
pixel bounding box.

Rules:
- The facecam is a small rectangular webcam overlay the STREAMER placed on top of their stream,
  showing a real human face. It is almost always pinned near one of the screen's edges or corners
  (top-left, top-right, bottom-left, bottom-right), and essentially never dead center.
- Do NOT confuse it with the in-game Rust character's face/head, which is part of the 3D game world
  and can appear anywhere in the frame, including the center. The in-game character is never the facecam,
  even when a face is clearly visible on it.
- If a VTuber avatar/model is used instead of a real camera, treat it the same as a facecam IF it is
  pinned in that same corner/edge overlay style.
- Many streamers have NO facecam at all. If you do not see a real overlay pinned to an edge, say so
  rather than guessing.

Respond with ONLY compact JSON, no prose, no markdown fences, in exactly this shape:
{"found": true, "x": 0, "y": 0, "width": 0, "height": 0}
or
{"found": false}
Coordinates are integer pixel values relative to the top-left corner of the image as given.
The user message will state the image's exact pixel dimensions — your x, y, width, and height
values must fit entirely within those bounds (x+width <= image width, y+height <= image height).`;

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON found in model response: ${text}`);
  return JSON.parse(match[0]);
}

/**
 * @param {Buffer} imageBuffer JPEG frame
 * @param {{width:number,height:number}} dims actual pixel dimensions of imageBuffer —
 *   critical to include, since without grounding the model can return coordinates
 *   that don't correspond to the real frame size at all.
 * @returns {Promise<{found:false}|{found:true,x:number,y:number,width:number,height:number}>}
 */
async function detectFacecam(imageBuffer, dims) {
  if (!config.openai.apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const base64 = imageBuffer.toString('base64');
  const userText = `Find the facecam in this frame, if any. The image is exactly ${dims.width}x${dims.height} pixels — return coordinates within that range.`;

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
