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

## Extending

- Add game logic in `src/webhookHandlers.js` (e.g. your `rowSwitchArray` sequencing
  belongs in `handleButtonPress`).
- Call their API from anywhere via `require('./src/rustPluginClient')`, e.g.
  `rustApi.moveChestItem(fromId, toId, itemId)`.
- Wire TTS output into a speaker via `speech.synthesizeToBuffer(text)` +
  `rustPluginClient` — note the raw voice packet endpoint (`POST /voice/<speakerId>`)
  is documented as bridge-only ("the bridge calls this; you don't"), so check with
  the devs on how they expect audio delivered before building that part.
