# rust-integration

Node app for the custom Rust server plugin: receives their webhooks, calls their HTTP API,
plus scaffolding for Rust+ (electrical automation) and Azure Speech.

## Layout

```
index.js                  entrypoint — starts the webhook server + Rust+ connection
ecosystem.config.js        pm2 process definition
.env.example               copy to .env and fill in
src/
  config.js                loads env vars
  webhookServer.js          Express app: POST /webhook (them -> you)
  webhookHandlers.js        one function per event: button_press, player_death, voice_state
  rustPluginClient.js       axios client for their HTTP API (you -> them): /players, /chests, etc.
  rustplusClient.js         @liamcottle/rustplus.js wrapper, based on your sample script
  speech.js                 Azure Speech SDK (TTS now, STT stubbed for later)
  twitchMap.js              steamId -> twitch username, loaded from data/steam-twitch-map.json into memory
  frameGrabber.js           streamlink (resolve URL) + ffmpeg (grab 1 frame) as fast as possible
  facecamDetector.js        sends the frame to OpenAI, asks for the facecam's pixel bounding box
  imageCrop.js              crops the frame to that box using ffmpeg (no extra image library)
  facecamPipeline.js        orchestrates all of the above end-to-end + disk cleanup
data/
  steam-twitch-map.json     steamId -> twitch username map (edit directly, or via twitchMap.setTwitchUsername)
public/facecam/             cropped images get written here and served at /facecam/<file> for the plugin to fetch
```

## Setup

```bash
npm install
cp .env.example .env
# fill in .env — see below
```

### .env values

- `WEBHOOK_SECRET` — invent your own random string. This becomes part of the URL you hand
  the devs. Generate one with `openssl rand -hex 16`.
- `RUST_API_BASE_URL` / `RUST_API_KEY` — the base URL and key for *their* HTTP API
  (the one with `/players`, `/chests`, `/canvases`, etc). `test123123` from their doc is
  presumably a dev-server placeholder — confirm the real key before going live.
- `RUSTPLUS_*` — only needed once you've paired via the rustplus.js CLI to get a player
  token. Leave blank and the app will skip connecting to Rust+ without crashing.
- `AZURE_KEY` / `AZURE_REGION` — only needed once you wire up TTS/STT.
- `PUBLIC_BASE_URL` — must match your nginx prefix (`https://blurbsttv.com/rust`), since this
  is used to build the URL handed to the plugin's canvas-paint endpoint.
- `OPENAI_API_KEY` / `OPENAI_MODEL` — for the facecam detection step. Default model is
  `gpt-4o-mini` (vision-capable, fast, cheap).
- `STREAM_QUALITY` — fallback chain streamlink tries, in order (e.g. `480p,worst`). Lower
  resolution = faster resolve/transfer, but less detail for finding a small facecam overlay.

### System dependencies (install these on the droplet, not via npm)

```bash
sudo apt update
sudo apt install -y ffmpeg python3-pip
pip3 install --upgrade streamlink
```
Confirm both are on PATH: `ffmpeg -version` and `streamlink --version`.

## Running

Locally:
```bash
npm start
```

On the droplet, under pm2:
```bash
pm2 start ecosystem.config.js
pm2 save          # persist across reboots
pm2 startup       # if you haven't already set pm2 to launch on boot
```

## Exposing the webhook

The app listens on `PORT` (default 3000) on `/webhook`, expecting the shape:

```json
{"event": "<name>", "timestamp": 1234567890, "data": {...}}
```

It checks `?key=<WEBHOOK_SECRET>` (or an `X-Webhook-Key` header) on every request —
that's the URL-embedded secret, separate from `RUST_API_KEY`, so treat the URL itself
as a credential.

**Don't hand out `http://blurbsttv.com:3000/webhook` directly.** Put Nginx (or Caddy) in
front with a Let's Encrypt cert, forwarding to `localhost:3000`, so the URL you give the
devs is:

```
https://blurbsttv.com/webhook?key=<your WEBHOOK_SECRET value>
```

(or a subdomain like `rust.blurbsttv.com/webhook?key=...` if you want to keep this
separate from anything else on the box.)

Minimal Nginx server block for reference:

```nginx
server {
    listen 443 ssl;
    server_name blurbsttv.com;

    ssl_certificate     /etc/letsencrypt/live/blurbsttv.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/blurbsttv.com/privkey.pem;

    location /webhook {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Facecam pipeline

`src/facecamPipeline.js` exports `updateFacecamOnCanvas(steamId, netId)`, which:

1. Looks up the twitch username for `steamId` (in-memory, instant).
2. Resolves the live stream URL via `streamlink --stream-url` and grabs one frame via `ffmpeg`.
3. Sends that frame to OpenAI asking for the facecam's pixel bounding box — the prompt is
   written to distinguish a real corner-pinned facecam/VTuber overlay from the in-game Rust
   character's face, and to say "not found" rather than guess when there's no facecam.
4. Crops to that box with `ffmpeg` (reusing the same binary, no extra image library).
5. Writes the crop to `public/facecam/`, deleting that steamId's previous file first so
   repeated calls don't accumulate files on disk.
6. Calls `rustPluginClient.paintCanvas(netId, url)` — note the plugin's doc says a 202 there
   means "queued for download, not painted yet", so the actual in-game paint happens
   asynchronously on their side, outside this app's control.

Each stage logs its own timing (`[facecam] grab frame: 1234ms`, etc.) so you can see where
time is actually going once it's running against a real stream — `pm2 logs rust-integration`
will show it live.

**Realistic latency expectations:** streamlink negotiating with Twitch plus ffmpeg pulling a
frame typically runs 1–4 seconds depending on the quality you pick; the OpenAI call is
another 1–2 seconds even at low detail. A couple of seconds end-to-end (through step 5) is
achievable but tight — test against a real stream and tune `STREAM_QUALITY` down if you need
it faster, at the cost of the vision model having a lower-resolution frame to search.

**Testing without a real in-game trigger:**
```bash
curl -X POST "https://blurbsttv.com/rust/facecam/<steamId>/<netId>?key=<WEBHOOK_SECRET>"
```
Returns `{"ok":true,"url":"..."}` or `{"ok":false,"reason":"..."}` — the reason string tells
you which stage failed (no mapping, streamer offline, no facecam found, etc).

**Wiring it to an actual trigger:** it's not called automatically from anywhere yet — see the
commented-out example in `handleButtonPress` in `src/webhookHandlers.js`. Whatever event you
pick, call it fire-and-forget (`.then()`, not `await`) from inside the handler, since the
webhook response to the plugin is already sent before `dispatch()` runs.

**Adding steamId → twitch mappings:**
```js
const twitchMap = require('./src/twitchMap');
twitchMap.setTwitchUsername('76561198000000000', 'their_twitch_username');
```
or just edit `data/steam-twitch-map.json` directly and restart the app (it's only read once
at startup).

## Extending

- Add game logic in `src/webhookHandlers.js` (e.g. your `rowSwitchArray` sequencing
  belongs in `handleButtonPress`).
- Call their API from anywhere via `require('./src/rustPluginClient')`, e.g.
  `rustApi.moveChestItem(fromId, toId, itemId)`.
- Wire TTS output into a speaker via `speech.synthesizeToBuffer(text)` +
  `rustPluginClient` — note the raw voice packet endpoint (`POST /voice/<speakerId>`)
  is documented as bridge-only ("the bridge calls this; you don't"), so check with
  the devs on how they expect audio delivered before building that part.
