# Marathon Trainer PWA (v4.2.1)

Gemini-only coach, fixed service worker behavior for local dev, and cache/version bump.

## Run locally (new fresh port 5501)

Python:
```bash
cd marathon-pwa-4_2_1
python3 -m http.server 5501
```
Node (http-server):
```bash
npx http-server -p 5501
```

Open on your phone (same Wi‑Fi): `http://<your-computer-LAN-IP>:5501`

## First-time setup
1. Open **Settings → AI Settings**.
2. Paste your **Google AI Studio key** and click **Save**.
3. Click **Fetch Gemini Models**, pick a model with **(generate)**, and **Use selected**.
4. Go to **Coach** and ask it to build a plan.

## Black page / stale cache?
Use the **Reset** button in the header or run in console:
```js
hardResetPWA()
```
This clears SW, caches, and localStorage, then reloads.

## Production
- Keep SW enabled (it only registers on HTTPS).
- Bump version query params in `index.html` when you deploy new code:
  - `styles.css?v=53`
  - `app.js?v=53`
  - `sw.js?v=53`
