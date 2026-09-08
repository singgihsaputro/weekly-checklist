# Weekly Checklist

React + Express + SQLite. One process, one port, one file of data.

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

Env: `PORT` (default 3001), `DB_PATH` (default `./data.db`).

## Hosting

`better-sqlite3` is a native module and SQLite is a **file on disk**. So the host must give you
a persistent disk and a long-running process.

| Host | Works? | Why |
|---|---|---|
| VPS (DigitalOcean, Hetzner, Linode, EC2) | yes | full disk, see below |
| Render / Railway / Fly.io | yes | attach a persistent volume, point `DB_PATH` at it |
| Vercel / Netlify / Cloudflare Pages | **no** | serverless, ephemeral filesystem — data is lost every deploy |
| Shared cPanel hosting | usually no | needs Node 18+ and a persistent process |

Build and start commands are the same everywhere:

```bash
npm ci && npm run build     # build
npm start                   # start
```

Env vars: `PORT` (host usually sets it), `DB_PATH` (point at the persistent disk).

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

SQLite. Single table:

| column | meaning |
|---|---|
| `week` | Monday of the week, `YYYY-MM-DD` |
| `day`  | 0 = Monday … 6 = Sunday |
| `text` | task text (max 500 chars) |
| `done` | 0/1 |

Swap to Postgres only if you outgrow it — 4 queries in `server.js` change, nothing else.

## Not included

No auth (anyone with the URL edits everything), no drag-reorder, no recurring tasks.
Add auth first if it faces the public internet.
