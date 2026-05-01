# Local Message Wall

A dependency-free local network app for collecting audience messages by QR code, moderating them centrally, and showing approved messages on a main display.

## Run it

```powershell
node server.js
```

Then open:

- Moderator: `http://localhost:3000/moderate`
- QR code: `http://localhost:3000/qr-code`
- Main display: `http://localhost:3000/display`
- Submit form: scan the QR code shown on the QR Code page

Phones need to be on the same Wi-Fi/network as the computer running the app. If Windows asks about firewall access for Node.js, allow access on private networks.

## Useful settings

```powershell
$env:PORT="8080"; node server.js
$env:PUBLIC_URL="http://192.168.1.50:3000"; node server.js
$env:MODERATOR_KEY="change-me"; node server.js
```

- `PORT` changes the server port.
- `PUBLIC_URL` overrides the QR-code URL if the app guesses the wrong network address.
- `MODERATOR_KEY` locks moderation endpoints. Use the printed moderation URL with `?key=...`.

Messages are stored locally in `data/messages.json`.

Rejected messages can be deleted from the moderation page.

The display page includes a subtle audio-reactive background. Open `http://localhost:3000/display` on the display machine, click **Enable audio visualizer**, and allow microphone/audio input when Chrome asks. Browsers may block live audio capture on plain LAN addresses such as `http://192.168.x.x:3000/display`; if that happens, the display will keep using a fallback animated background.

## Deploy on Render

Add these files and folders to your GitHub repo:

- `server.js`
- `package.json`
- `render.yaml`
- `.gitignore`
- `README.md`
- `public/`

Do not commit `node_modules/`, `*.log`, or `data/messages.json`.

In Render, create a new Web Service from the repo. The included `render.yaml` sets:

- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`

Render provides HTTPS automatically for its `onrender.com` URL and for custom domains. The app uses the incoming request host/protocol to generate QR URLs, so the QR code should point at the public HTTPS Render URL.

For a real hosted service, replace the local JSON message store with a database. The current `data/messages.json` approach is fine for demos or a single small event, but hosted files can be lost on redeploys, restarts, or scaling unless you attach persistent storage.
