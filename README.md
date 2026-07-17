# Momentum

A personal productivity tracker: daily checklists with time tracking, reusable task presets, an archive with daily reflections, long-term goals, a bulletin board, and a calendar with multi-lead-time reminders. Multi-user with private per-account data.

No dependencies — the backend is pure Python standard library, the frontend is vanilla JS served as a PWA.

## Run it

```
python server.py
```

Then open http://localhost:4000. Set the `PORT` environment variable to use a different port.

Everything is stored in `data/db.json` (created on first run). Back that file up and you've backed up the app.

## Using it on iPhone / iPad

Momentum is an installable PWA:

1. Serve it somewhere your phone can reach (deploy to any host that runs Python, or expose your PC on your LAN and visit `http://<pc-ip>:4000`).
2. Open it in Safari → Share → **Add to Home Screen**. It launches full-screen with its own icon, like a native app.

For a real App Store listing you would wrap this app with [Capacitor](https://capacitorjs.com/) (pointing it at the deployed URL or bundling `public/`), then build and submit with Xcode on a Mac using an Apple Developer account ($99/year). No code changes are needed first.

## Notes on reminders

Calendar reminders fire as system notifications (plus in-app toasts) at each lead time you pick — while the app is open in a tab or installed as a PWA. True push notifications with the app fully closed require a hosted push service (e.g. Web Push with a VAPID server), which this self-contained build intentionally avoids.

## Google sign-in (optional)

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) create an **OAuth client ID** of type *Web application*.
2. Add your app's URL(s) to **Authorized JavaScript origins** (e.g. `http://localhost:4000` and your deployed HTTPS URL).
3. Give the client ID to the server either as an environment variable `GOOGLE_CLIENT_ID=...` or in `data/config.json`:
   ```json
   { "googleClientId": "1234567890-abc.apps.googleusercontent.com" }
   ```
4. Restart the server. A "Sign in with Google" button appears on the login screen automatically. Google accounts and username/password accounts are separate accounts.

## Deploying

A `Dockerfile` is included — the app runs anywhere that runs containers (Render, Fly.io, Railway, a VPS). Two things to remember:

- **Persistence**: all data is in `/app/data` — mount a persistent disk/volume there or accounts are lost on redeploy.
- **HTTPS**: required for Google sign-in and for the PWA install prompt; every major host provides it automatically.

## Accounts & privacy

Anyone with access to the server can register a username/password. Passwords are hashed with scrypt; sessions use signed 30-day tokens. Each user only ever sees their own data. If you deploy it publicly, put it behind HTTPS.

## Layout

- `server.py` — HTTP server + JSON API (auth, days, tasks, presets, notes, goals, events)
- `public/` — the web app (`js/views/*` are the six screens)
- `data/` — created at runtime: `db.json` (all data) and `secret.key` (token signing key)
