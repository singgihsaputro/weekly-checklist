# Daily Routines

React + Express + SQLite (via libSQL). Runs off a local file on your machine,
off a hosted [Turso](https://turso.tech) database when `TURSO_DATABASE_URL` is set.

A shared task list, a per-person record of twelve daily routines, and one
analytics page comparing the two. Readable by week or one day at a time. Sign in
with Google; two allowlisted accounts, no sign-up.

Installable: it ships a web manifest and iOS home-screen icons, so *Add to Home
Screen* gives it an app icon and a standalone window. There is deliberately **no
service worker** — the data lives in Turso, so offline would show an empty app,
and the cache invalidation would be real work for nothing.

## Local

```bash
npm install
npm run dev        # vite on :5173, api on :3001
```

## Production (single process, serves built frontend + API)

```bash
npm run build
npm start          # http://localhost:3001
```

Copy `.env.example` to `.env.local` and fill it in — the server reads that file
automatically. Values already in the environment win, so CI and Vercel override it.

| Variable | Why |
|---|---|
| `SESSION_SECRET` | signs the session cookie; changing it signs everyone out |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | the Google OAuth web client. **Unset means sign-in always fails** |
| `OAUTH_REDIRECT_URI` | must match a URI registered on that client, exactly |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | hosted DB; without them it uses a local file |
| `APP_TZ` | day boundaries (default `Asia/Jakarta`) |
| `PORT`, `DB_PATH` | local only — default 3001 and `./data.db` |

## Hosting

Two shapes work:

| Host | Works? | Why |
|---|---|---|
| Vercel | yes | serverless + Turso, no disk needed — see below |
| VPS (DigitalOcean, Hetzner, Linode, EC2) | yes | full disk, see below |
| Render / Railway / Fly.io | yes | attach a persistent volume, point `DB_PATH` at it |
| Shared cPanel hosting | usually no | needs Node 18+ and a persistent process |

Serverless hosts have an ephemeral filesystem, so a SQLite **file** is lost on every deploy.
Set `TURSO_DATABASE_URL` and the data lives in Turso instead, and Vercel works fine.

Build and start commands are the same everywhere:

```bash
npm ci && npm run build     # build
npm start                   # start
```

Env vars: `PORT` (host usually sets it), `DB_PATH` (point at the persistent disk).

### Vercel

The frontend is served from the CDN; `api/index.js` runs the express app as one serverless
function (`vercel.json` routes every `/api/*` request to it). No disk, so the data goes to Turso.

1. Create the database — [install the CLI](https://docs.turso.tech/cli/installation), then:

   ```bash
   turso auth signup
   turso db create weekly-checklist
   turso db show weekly-checklist --url        # -> TURSO_DATABASE_URL
   turso db tokens create weekly-checklist     # -> TURSO_AUTH_TOKEN
   ```

   The `tasks` table creates itself on the first request.

2. On [vercel.com/new](https://vercel.com/new), import this repo. The Vite preset is detected;
   leave the build settings alone.

3. Add every variable from the table above (Settings → Environment Variables), then
   deploy. `SESSION_SECRET` and the Google client are required — sign-in fails
   closed without them, which locks *everyone* out, not just strangers.

### The Google client

In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
create an **OAuth client ID** of type *Web application* and register both redirect
URIs exactly:

```
https://<your-app>.vercel.app/api/auth/callback
http://localhost:5173/api/auth/callback
```

The second one is for `npm run dev`, where vite serves the app on 5173 and
proxies `/api` to the server — coming back to 3001 would land on a port with no
app on it. Add `http://localhost:3001/api/auth/callback` too if you use
`npm start` locally.

On the consent screen, keep the app in *Testing* and add both addresses as test
users — that is a second gate in front of the allowlist, not a replacement for it.
Only `openid email` is requested, so Google hands back an address and nothing else.

Redeploys never touch the data — it lives in Turso, not in the build.

Every `/api` route except `/api/login` requires a session, so the URL alone gets a
stranger nothing but the login form.

### Render

1. New → Web Service → connect this repo.
2. Build command: `npm ci && npm run build`
3. Start command: `npm start`
4. Add a Disk: mount path `/data`, 1 GB.
5. Env: `NODE_ENV=production`, `DB_PATH=/data/data.db`.

`PORT` is injected by Render — don't set it.

### Fly.io

```bash
fly launch --no-deploy              # generates fly.toml + Dockerfile
fly volumes create data --size 1
```

In `fly.toml`:

```toml
[env]
  NODE_ENV = "production"
  DB_PATH  = "/data/data.db"
  PORT     = "3001"

[[mounts]]
  source      = "data"
  destination = "/data"

[http_service]
  internal_port = 3001
```

```bash
fly deploy
```

### Redeploying

Code updates are safe — the DB lives on the volume, not in the repo image.
`data.db*` is gitignored, so it never ships with the code.

## Deploy on a cheap VPS

Needs ~1 vCPU / 512MB. Node 18+.

```bash
git clone <repo> /opt/weekly-checklist && cd /opt/weekly-checklist
npm ci && npm run build
```

systemd unit `/etc/systemd/system/weekly-checklist.service`:

```ini
[Unit]
After=network.target

[Service]
WorkingDirectory=/opt/weekly-checklist
Environment=NODE_ENV=production PORT=3001
ExecStart=/usr/bin/node server.js
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now weekly-checklist
```

nginx site:

```nginx
server {
  server_name checklist.example.com;
  location / { proxy_pass http://127.0.0.1:3001; }
}
```

Then `certbot --nginx -d checklist.example.com` for TLS.

Backup = `cp data.db data.db.bak` (or `sqlite3 data.db ".backup out.db"` while running).

## Database

SQLite, reached through `@libsql/client` — a local file in dev, Turso in production.

`tasks` — shared by both accounts:

| column | meaning |
|---|---|
| `week` | Monday of the week, `YYYY-MM-DD` |
| `day`  | 0 = Monday … 6 = Sunday |
| `text` | task text (max 500 chars) |
| `done` | 0/1 |

`routine` — per account. **A row records how a routine went; no row means nothing
was recorded.** "Not recorded" is the absence of data, so a fresh day costs no
writes and clearing a mark deletes rather than updates.

| column | meaning |
|---|---|
| `email` | whose mark it is; you can only write your own |
| `date` | `YYYY-MM-DD` in `APP_TZ` |
| `item` | a key from `ROUTINES` in `server.js` |
| `level` | depends on the item's kind |

Primary key is `(email, date, item)`, so changing a level replaces the row instead
of adding one.

The twelve routines come in two kinds, listed in the order the day happens:

| kind | items | levels |
|---|---|---|
| `sholat` | Subuh, Dzuhur, Ashar, Maghrib, Isya | `sholat` < `ontime` < `masjid` |
| `done` | Mengaji pagi, Olahraga pagi, Mandi pagi, Mandi sore, Mengaji habis Maghrib, Makan, Minum vitamin | `done` |

The control follows the kind: a prayer gets a dropdown because it has a scale to
pick from, a habit gets a checkbox because it only has two states. The catalogue
is served from `/api/me`, so the client never carries its own copy.
`masjid` is allowed **only for Singgih** — the roster says who may use which levels
for which kind, and `PUT /api/routines` enforces it, so the browser cannot talk its
way past it. The kinds do not share a scale either: a habit cannot be `masjid` and
a prayer cannot be `done`.

Both `ontime` and `masjid` count as on time in the stats; `masjid` is also counted
on its own.

### Migrations

Prayers used to live in their own `sholat` table, one row per prayer, and before
that without a `level` column at all. On boot the server adds the missing column
if needed, copies every row into `routine` as `sholat_<prayer>`, then renames the
old table to `sholat_pre_routines` — renamed rather than dropped, so the originals
are still there, and renamed rather than flagged, so the copy cannot run twice.

Swap to Postgres only if you outgrow it — 4 queries in `server.js` change, nothing else.

## Auth

Google decides *who someone is*; the allowlist in `server.js` decides *who gets
in*. There are no passwords anywhere — not in the repo, not in the database, not
in an env var.

The flow is the authorization-code one, with `state` (CSRF), `nonce` (replay) and
PKCE `S256`, all carried in a short-lived signed cookie rather than server memory,
since serverless has none. On the way back the `id_token` is checked for issuer,
audience, expiry, matching nonce, `email_verified`, and finally membership of the
allowlist. Anything short of all of those redirects to `/?auth=denied`, with one
reason code for every failure so a stranger learns nothing from which.

The token is read without verifying its signature *because* it is fetched over TLS
directly from Google's token endpoint rather than passed through the browser —
Google documents this case. Move to JWKS verification if a token ever starts
arriving by another route.

The session itself is an HMAC-signed cookie — `HttpOnly`, `SameSite=Lax`, `Secure`
in production, ten-year `Max-Age`, so nobody gets signed out in practice. Signing
out clears it; rotating `SESSION_SECRET` invalidates every session at once.

## Not included

No sign-up, no refresh tokens (the session outlives them and nothing calls Google
again), no service worker, no drag-reorder, no per-person routine lists — both
accounts track the same twelve. Tasks are shared between both accounts by design; only sholat marks are
per-person.

## On a phone

The layout is built for a phone first: one column, tap targets sized for thumbs,
16px inputs so iOS does not zoom on focus, and the reveal-on-hover controls stay
visible where there is no hover. The charts keep a fixed `viewBox`, so their
gutters and type sizes are re-proportioned below 560px rather than scaled down
into illegibility.

### Add to Home Screen

On iPhone: open it in **Safari** → Share → *Add to Home Screen*. You get the app
icon, the name "Routines", and a standalone window with no browser chrome.
`display-mode: standalone` trims the cover and adds bottom safe-area padding.

The icons come from one source, `public/favicon.svg`, rasterised with
`rsvg-convert`:

```bash
rsvg-convert -w 180 -h 180 public/favicon.svg -o public/apple-touch-icon.png
```

`apple-touch-icon.png` is full-bleed and opaque, because iOS rounds and masks it
itself and renders transparency as black. The maskable manifest icon shrinks the
mark to 70% so it survives Android's circular crop.

One caveat worth knowing: signing in from a standalone iOS window sends you out
to Google and back, and older iOS versions hand that round trip to Safari
instead, leaving the session in the wrong place. If sign-in ever seems to "not
stick" in the installed app, sign in once from inside it rather than from Safari.

## Week view versus day view

Twelve routines times two people is twenty-four controls per day. Rendered seven
times over, the week view stopped being readable — so it is not rendered that way.
The week shows one progress ring and a score per person per day, and tapping either
opens that day. The day view is where the controls live. Entry happens one day at
a time; the week is for looking.

## Motion

`framer-motion` drives the view transition, the card stagger, task rows growing and
collapsing, the toggle pill, the progress rings and the counting hero numbers. It
costs about 48KB gzipped, which roughly doubles the bundle — a real price, paid
deliberately for the interaction feel.

Everything animated is also correct without animation: `useReducedMotion` is
honoured throughout, and the reduced-motion path sets final values directly rather
than animating faster.

Three.js was considered and rejected — a 3D renderer to animate a list of
dropdowns is the wrong tool. Tailwind was rejected too: the stylesheet already
works, and converting it would be churn with nothing visible at the end.
