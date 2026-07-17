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

## Profile & password recovery

Clicking your name/avatar (bottom-left) opens your profile, where you can set or change your email (the new address activates only after clicking its verification link) and upload or remove a profile photo (resized client-side to 128px, stored with the account).

"Forgot password?" on the sign-in screen sends a single-use, 1-hour reset link to the account's email. With no SMTP configured, the link is **written to the server log only** (never shown to the requester — that would allow account takeover); the site owner can retrieve it from the log.

## Deploying

### PythonAnywhere (free, persistent)

1. Create a free account at [pythonanywhere.com](https://www.pythonanywhere.com) — your username becomes the URL (`https://<username>.pythonanywhere.com`).
2. Open a **Bash console** there and run:
   ```
   git clone https://github.com/hanw1434/momentum.git
   ```
3. Go to the **Web** tab → *Add a new web app* → *Manual configuration* → pick the newest Python offered.
4. On the web app page set **Source code** to `/home/<username>/momentum`, then click the **WSGI configuration file** link and replace its entire contents with:
   ```python
   import sys
   sys.path.insert(0, '/home/<username>/momentum')
   from wsgi import application
   ```
5. Click **Reload**. The site is live, with HTTPS, and data persists in `~/momentum/data/`.

To update later: `cd ~/momentum && git pull`, then Reload on the Web tab.

Note: free PythonAnywhere accounts restrict outbound internet to an allowlist. Password login works regardless; if Google sign-in verification is blocked, ask their support to allow `oauth2.googleapis.com` (commonly already allowed) or upgrade.

### Anywhere else (Docker)

A `Dockerfile` is included — the app runs on any container host (Render, Fly.io, Railway, a VPS). Two things to remember:

- **Persistence**: all data is in `/app/data` — mount a persistent disk/volume there or accounts are lost on redeploy.
- **HTTPS**: required for Google sign-in and for the PWA install prompt; every major host provides it automatically.

## Accounts & privacy

Registration asks for a username, email and password, protected by a built-in captcha (a server-generated distorted-SVG challenge — no third-party service; it deters casual bots, not determined ones). New accounts must click an emailed verification link before they can sign in. Passwords are hashed with scrypt; sessions use signed 30-day tokens. Each user only ever sees their own data, stored server-side in `data/db.json` — it persists across restarts and is independent of any browser. If you deploy publicly, put it behind HTTPS.

### Email sending (verification links)

Without email settings the server runs in **dev mode**: the verification link is shown on-screen right after sign-up instead of being emailed (fine for personal/local use, but it means email ownership isn't actually proven). To send real emails, add SMTP settings via environment variables or `data/config.json`:

```json
{
  "smtpHost": "smtp.gmail.com",
  "smtpPort": 587,
  "smtpUser": "you@gmail.com",
  "smtpPass": "an-app-password",
  "smtpFrom": "you@gmail.com",
  "baseUrl": "https://yourapp.example.com"
}
```

`baseUrl` is what verification links point at. Note: **PythonAnywhere free accounts block outbound SMTP** — on that host either keep dev mode, or upgrade / switch to an HTTP email API.

## Layout

- `server.py` — HTTP server + JSON API (auth, days, tasks, presets, notes, goals, events)
- `public/` — the web app (`js/views/*` are the six screens)
- `data/` — created at runtime: `db.json` (all data) and `secret.key` (token signing key)
