import express from 'express'
import { createClient } from '@libsql/client'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// .env.local in dev; on Vercel the platform injects the real env
try {
  process.loadEnvFile('.env.local')
} catch {}

// Turso in the cloud; a local SQLite file when no credentials are set.
const db = createClient(
  process.env.TURSO_DATABASE_URL
    ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: `file:${process.env.DB_PATH || 'data.db'}` }
)

// The whole app is these two people. Google vouches for who someone is; this
// list decides who is let in. Any other Google account is bounced at the callback.
const USERS = {
  'singgih.rochmad@gmail.com': { name: 'Singgih', masjid: true },
  'titis.ekaaprilia@gmail.com': { name: 'Titis' },
}

// Two kinds of routine. Worst to best; no row at all is the extra state at the
// bottom of each — "not recorded" — so an untouched day costs no writes.
const KINDS = {
  sholat: ['sholat', 'ontime', 'masjid'],
  done: ['done'],
}
const ON_TIME = new Set(['ontime', 'masjid'])

// praying in the masjid is a thing only one of them does
const levelsFor = (email, kind) =>
  kind === 'sholat' && !USERS[email]?.masjid ? KINDS.sholat.filter((l) => l !== 'masjid') : KINDS[kind]

// The day in order, so the list reads top to bottom like the day happens.
const ROUTINES = [
  { key: 'sholat_subuh', label: 'Sholat Subuh', kind: 'sholat' },
  { key: 'mengaji_subuh', label: 'Mengaji pagi', kind: 'done' },
  { key: 'olahraga_pagi', label: 'Olahraga pagi', kind: 'done' },
  { key: 'mandi_pagi', label: 'Mandi pagi', kind: 'done' },
  { key: 'sholat_dzuhur', label: 'Sholat Dzuhur', kind: 'sholat' },
  { key: 'sholat_ashar', label: 'Sholat Ashar', kind: 'sholat' },
  { key: 'mandi_sore', label: 'Mandi sore', kind: 'done' },
  { key: 'sholat_maghrib', label: 'Sholat Maghrib', kind: 'sholat' },
  { key: 'mengaji_maghrib', label: 'Mengaji habis Maghrib', kind: 'done' },
  { key: 'sholat_isya', label: 'Sholat Isya', kind: 'done_placeholder' },
  { key: 'makan', label: 'Makan', kind: 'done' },
  { key: 'minum_vitamin', label: 'Minum vitamin', kind: 'done' },
]
ROUTINES.find((r) => r.key === 'sholat_isya').kind = 'sholat'

const BY_KEY = Object.fromEntries(ROUTINES.map((r) => [r.key, r]))
const SHOLAT = ROUTINES.filter((r) => r.kind === 'sholat')
const HABITS = ROUTINES.filter((r) => r.kind === 'done')

const roster = () =>
  Object.entries(USERS).map(([email, u]) => ({
    email,
    name: u.name,
    levels: Object.fromEntries(Object.keys(KINDS).map((kind) => [kind, levelsFor(email, kind)])),
  }))

// Everyone here is in one timezone; days must not roll over on UTC's schedule.
const TZ = process.env.APP_TZ || 'Asia/Jakarta'
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())

const parseDay = (s) => new Date(`${s}T12:00:00Z`)
const fmtDay = (d) => d.toISOString().slice(0, 10)
const addDays = (s, n) => {
  const d = parseDay(s)
  d.setUTCDate(d.getUTCDate() + n)
  return fmtDay(d)
}
const mondayOf = (s) => addDays(s, -((parseDay(s).getUTCDay() + 6) % 7))

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(parseDay(s).getTime())

// ---- sessions --------------------------------------------------------------

const SECRET = process.env.SESSION_SECRET
const COOKIE = 'session'
// "no expiry" as far as anyone will notice; a cookie must carry some max-age
const TEN_YEARS = 10 * 365 * 24 * 60 * 60 * 1000

const sign = (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${createHmac('sha256', SECRET).update(body).digest('base64url')}`
}

const verify = (token) => {
  if (!SECRET || !token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const got = Buffer.from(sig)
  const want = Buffer.from(createHmac('sha256', SECRET).update(body).digest('base64url'))
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString())
  } catch {
    return null
  }
}

const readCookie = (req, name) => {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1))
  }
  return null
}

// ---- google sign-in --------------------------------------------------------

// Both endpoints are overridable so the whole flow can be driven against a local
// stub. Nothing sets either in production, where they stay Google's.
const GOOGLE_AUTH = process.env.OAUTH_AUTH_ENDPOINT || 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = process.env.OAUTH_TOKEN_ENDPOINT || 'https://oauth2.googleapis.com/token'
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || 'http://localhost:5173/api/auth/callback'
const FLOW = 'oauth_flow' // short-lived: carries state, nonce and the PKCE verifier

const configured = () => Boolean(SECRET && CLIENT_ID && CLIENT_SECRET)
const b64url = (buf) => buf.toString('base64url')

// The id_token arrives over TLS straight from Google's token endpoint, so its
// signature is already accounted for; these claims still have to be checked.
const claimsOf = (idToken) => {
  const parts = String(idToken || '').split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString())
  } catch {
    return null
  }
}

const ISSUERS = ['accounts.google.com', 'https://accounts.google.com']

export const emailFromClaims = (claims, nonce) => {
  if (!claims) return null
  if (claims.aud !== CLIENT_ID) return null
  if (!ISSUERS.includes(claims.iss)) return null
  if (!claims.exp || claims.exp * 1000 < Date.now()) return null
  if (claims.nonce !== nonce) return null
  if (claims.email_verified !== true && claims.email_verified !== 'true') return null
  const email = String(claims.email || '').trim().toLowerCase()
  return USERS[email] ? email : null
}

// ---- schema ----------------------------------------------------------------

let ready
const init = () =>
  (ready ??= (async () => {
    await db.execute(
      `CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY,
        week TEXT NOT NULL,           -- monday of the week, YYYY-MM-DD
        day INTEGER NOT NULL,         -- 0=Mon .. 6=Sun
        text TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0
      )`
    )
    // a row records how a routine went; no row means nothing was recorded
    await db.execute(
      `CREATE TABLE IF NOT EXISTS routine (
        email TEXT NOT NULL,
        date TEXT NOT NULL,           -- YYYY-MM-DD, local (Asia/Jakarta)
        item TEXT NOT NULL,           -- a key from ROUTINES
        level TEXT NOT NULL,          -- sholat|ontime|masjid, or done
        PRIMARY KEY (email, date, item)
      )`
    )
    await absorbOldSholatTable()
  })().catch((e) => {
    ready = null
    throw e
  }))

// The prayers used to live in their own table, one row per prayer. They are just
// twelve routines now. Copy them across once and rename the old table rather than
// dropping it, so the original rows are still there if this turns out wrong.
const absorbOldSholatTable = async () => {
  const found = await db.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sholat'"
  )
  if (!found.rows.length) return
  // rows predating levels meant "on time", which is what that column defaults to
  await db.execute("ALTER TABLE sholat ADD COLUMN level TEXT NOT NULL DEFAULT 'ontime'").catch(() => {})
  await db.execute(`INSERT OR IGNORE INTO routine (email, date, item, level)
    SELECT email, date, 'sholat_' || prayer, COALESCE(level, 'ontime') FROM sholat`)
  await db.execute('ALTER TABLE sholat RENAME TO sholat_pre_routines')
  console.log('migrated the sholat table into routine')
}

const isWeek = isDate
const all = async (sql, args) => (await db.execute({ sql, args })).rows
const one = async (sql, args) => (await all(sql, args))[0]

// ---- app -------------------------------------------------------------------

const app = express()
app.use(express.json())

// express 4 drops async rejections on the floor, so every route goes through this
const route = (fn) => async (req, res) => {
  try {
    await init()
    await fn(req, res)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'server error' })
  }
}

const auth = (fn) =>
  route(async (req, res) => {
    const session = verify(readCookie(req, COOKIE))
    if (!session || !USERS[session.email]) return res.status(401).json({ error: 'not signed in' })
    req.email = session.email
    await fn(req, res)
  })

const cookieOpts = (maxAge) => ({
  httpOnly: true,
  sameSite: 'lax', // must survive the top-level redirect back from Google
  secure: Boolean(process.env.VERCEL),
  maxAge,
  path: '/',
})

app.get('/api/auth/google', (req, res) => {
  if (!configured()) return res.redirect('/?auth=unconfigured')
  const state = b64url(randomBytes(16))
  const nonce = b64url(randomBytes(16))
  const verifier = b64url(randomBytes(32))
  res.cookie(FLOW, sign({ state, nonce, verifier }), cookieOpts(10 * 60 * 1000))
  const url = new URL(GOOGLE_AUTH)
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email',
    state,
    nonce,
    code_challenge: b64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })
  res.redirect(url.toString())
})

app.get(
  '/api/auth/callback',
  route(async (req, res) => {
    const flow = verify(readCookie(req, FLOW))
    res.clearCookie(FLOW, { path: '/' })
    // one reason code for every failure — a stranger learns nothing from which
    if (!configured() || req.query.error || !flow || !req.query.state || req.query.state !== flow.state)
      return res.redirect('/?auth=denied')

    const token = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code || ''),
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
        code_verifier: flow.verifier,
      }),
    })
    if (!token.ok) return res.redirect('/?auth=denied')

    const email = emailFromClaims(claimsOf((await token.json()).id_token), flow.nonce)
    if (!email) return res.redirect('/?auth=denied')

    res.cookie(COOKIE, sign({ email, at: Date.now() }), cookieOpts(TEN_YEARS))
    res.redirect('/')
  })
)

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE, { path: '/' })
  res.sendStatus(204)
})

app.get(
  '/api/me',
  auth(async (req, res) =>
    res.json({ email: req.email, name: USERS[req.email].name, users: roster(), routines: ROUTINES })
  )
)

// ---- tasks (shared between both users) -------------------------------------

app.get(
  '/api/tasks',
  auth(async (req, res) => {
    if (!isWeek(req.query.week)) return res.status(400).json({ error: 'bad week' })
    res.json(await all('SELECT * FROM tasks WHERE week = ? ORDER BY id', [req.query.week]))
  })
)

app.post(
  '/api/tasks',
  auth(async (req, res) => {
    const { week, day, text } = req.body
    if (!isWeek(week) || !Number.isInteger(day) || day < 0 || day > 6 || !text?.trim())
      return res.status(400).json({ error: 'bad task' })
    const { lastInsertRowid } = await db.execute({
      sql: 'INSERT INTO tasks (week, day, text) VALUES (?, ?, ?)',
      args: [week, day, text.trim().slice(0, 500)],
    })
    res.json(await one('SELECT * FROM tasks WHERE id = ?', [Number(lastInsertRowid)]))
  })
)

app.patch(
  '/api/tasks/:id',
  auth(async (req, res) => {
    const { text, done } = req.body
    const row = await one('SELECT * FROM tasks WHERE id = ?', [req.params.id])
    if (!row) return res.sendStatus(404)
    await db.execute({
      sql: 'UPDATE tasks SET text = ?, done = ? WHERE id = ?',
      args: [
        text?.trim() ? text.trim().slice(0, 500) : row.text,
        done === undefined ? row.done : done ? 1 : 0,
        row.id,
      ],
    })
    res.json(await one('SELECT * FROM tasks WHERE id = ?', [row.id]))
  })
)

app.delete(
  '/api/tasks/:id',
  auth(async (req, res) => {
    await db.execute({ sql: 'DELETE FROM tasks WHERE id = ?', args: [req.params.id] })
    res.sendStatus(204)
  })
)

// ---- routines --------------------------------------------------------------

// both people's marks for the week — the day cards show his and hers together
app.get(
  '/api/routines',
  auth(async (req, res) => {
    if (!isWeek(req.query.week)) return res.status(400).json({ error: 'bad week' })
    const from = mondayOf(req.query.week)
    res.json(await all('SELECT * FROM routine WHERE date >= ? AND date <= ?', [from, addDays(from, 6)]))
  })
)

// you can only mark your own, and only at a level your account is allowed
app.put(
  '/api/routines',
  auth(async (req, res) => {
    const { date, item } = req.body
    const level = req.body.level || null
    const routine = BY_KEY[item]
    if (!isDate(date) || !routine) return res.status(400).json({ error: 'bad mark' })
    if (level && !levelsFor(req.email, routine.kind).includes(level))
      return res.status(400).json({ error: 'bad level' })
    if (date > today()) return res.status(400).json({ error: 'that day has not happened yet' })
    await db.execute(
      level
        ? {
            sql: `INSERT INTO routine (email, date, item, level) VALUES (?, ?, ?, ?)
                  ON CONFLICT(email, date, item) DO UPDATE SET level = excluded.level`,
            args: [req.email, date, item, level],
          }
        : {
            sql: 'DELETE FROM routine WHERE email = ? AND date = ? AND item = ?',
            args: [req.email, date, item],
          }
    )
    res.json({ email: req.email, date, item, level })
  })
)

// ---- stats -----------------------------------------------------------------

app.get(
  '/api/stats',
  auth(async (req, res) => {
    const now = today()
    const since = addDays(now, -55) // 8 weeks of trend, 30 days of rates
    // ponytail: reads the window, not the table. Aggregate in SQL if this gets slow.
    const rows = await all('SELECT * FROM routine WHERE date >= ?', [since])

    const marks = new Map(rows.map((r) => [`${r.email}|${r.date}|${r.item}`, r.level]))
    const at = (email, date, item) => marks.get(`${email}|${date}|${item}`) || null
    const last30 = Array.from({ length: 30 }, (_, i) => addDays(now, -i))

    const byUser = {}
    for (const [email, user] of Object.entries(USERS)) {
      const tally = (dates) => {
        const out = { ontime: 0, masjid: 0, prayed: 0, possible: dates.length * SHOLAT.length }
        for (const d of dates)
          for (const { key } of SHOLAT) {
            const level = at(email, d, key)
            if (!level) continue
            out.prayed++
            if (ON_TIME.has(level)) out.ontime++
            if (level === 'masjid') out.masjid++
          }
        return out
      }

      const byPrayer = SHOLAT.map(({ key, label }) => {
        const levels = last30.map((d) => at(email, d, key))
        return {
          item: key,
          label: label.replace(/^Sholat /, ''),
          ontime: levels.filter((l) => l && ON_TIME.has(l)).length,
          prayed: levels.filter(Boolean).length,
          possible: last30.length,
        }
      })

      const byRoutine = HABITS.map(({ key, label }) => ({
        item: key,
        label,
        done: last30.filter((d) => at(email, d, key)).length,
        possible: last30.length,
      }))

      // consecutive days back from today with all five prayers on time (today is
      // still in progress, so it can extend a streak but never break one)
      let streak = 0
      for (let i = 0; i < 365; i++) {
        const d = addDays(now, -i)
        const complete = SHOLAT.every(({ key }) => ON_TIME.has(at(email, d, key)))
        if (complete) streak++
        else if (i > 0) break
      }

      const thisMonday = mondayOf(now)
      const weekly = Array.from({ length: 8 }, (_, i) => {
        const week = addDays(thisMonday, -7 * (7 - i))
        const days = Array.from({ length: 7 }, (_, j) => addDays(week, j)).filter((d) => d <= now)
        return { week, ...tally(days) }
      })

      byUser[email] = {
        name: user.name,
        levels: Object.fromEntries(Object.keys(KINDS).map((k) => [k, levelsFor(email, k)])),
        last30: tally(last30),
        byPrayer,
        byRoutine,
        streak,
        weekly,
      }
    }

    res.json({ today: now, routines: ROUTINES, byUser })
  })
)

// on Vercel the static build is served by the CDN, not by express
if (!process.env.VERCEL) {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static('dist'))
    app.get('*', (_, res) => res.sendFile('index.html', { root: 'dist' }))
  }
  const port = process.env.PORT || 3001
  app.listen(port, () => console.log(`http://localhost:${port}`))
}

export default app
