# Weekly Checklist

React + Express + SQLite (via libSQL). Runs off a local file on your machine,
off a hosted [Turso](https://turso.tech) database when `TURSO_DATABASE_URL` is set.

A shared weekly task list, a per-person record of which prayers were on time, and
one analytics page comparing the two. Sign in with Google; two allowlisted
accounts, no sign-up.

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

`sholat` — per account. **A row means that prayer was on time; no row means it
wasn't.** Unchecked is the absence of data, so nothing has to be written to start
a day, and unchecking deletes rather than updates.

| column | meaning |
|---|---|
| `email` | whose mark it is; you can only write your own |
| `date` | `YYYY-MM-DD` in `APP_TZ` |
| `prayer` | `subuh` / `dzuhur` / `ashar` / `maghrib` / `isya` |

Primary key is all three, so marking twice is a no-op rather than a duplicate.

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
again), no drag-reorder, no recurring tasks. Tasks are shared between both accounts by design; only sholat marks are
per-person.
