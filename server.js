import express from 'express'
import { createClient } from '@libsql/client'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

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

// The whole app is these two people. Passwords live in env vars, never here.
const USERS = {
  'singgih.rochmad@gmail.com': { name: 'Singgih', pass: 'PASSWORD_SINGGIH' },
  'titis.ekaaprilia@gmail.com': { name: 'Titis', pass: 'PASSWORD_TITIS' },
}

const PRAYERS = ['subuh', 'dzuhur', 'ashar', 'maghrib', 'isya']

const roster = () => Object.entries(USERS).map(([email, u]) => ({ email, name: u.name }))

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

// hashed first so a wrong-length guess costs the same as a wrong-value one
const secretsMatch = (a, b) => {
  const h = (v) => createHash('sha256').update(String(v ?? ''), 'utf8').digest()
  return timingSafeEqual(h(a), h(b))
}

// ---- schema ----------------------------------------------------------------

let ready
const init = () =>
  (ready ??= Promise.all([
    db.execute(
      `CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY,
        week TEXT NOT NULL,           -- monday of the week, YYYY-MM-DD
        day INTEGER NOT NULL,         -- 0=Mon .. 6=Sun
        text TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0
      )`
    ),
    // a row means "prayed on time"; no row means not. Unchecked is the default.
    db.execute(
      `CREATE TABLE IF NOT EXISTS sholat (
        email TEXT NOT NULL,
        date TEXT NOT NULL,           -- YYYY-MM-DD, local (Asia/Jakarta)
        prayer TEXT NOT NULL,         -- subuh|dzuhur|ashar|maghrib|isya
        PRIMARY KEY (email, date, prayer)
      )`
    ),
  ]).catch((e) => {
    ready = null
    throw e
  }))

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

app.post(
  '/api/login',
  route(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase()
    const password = String(req.body?.password || '')
    const user = USERS[email]
    // ponytail: no rate limit — serverless has no shared counter. The passwords are
    // long random strings; add a Turso-backed attempt counter if that stops being true.
    const expected = user && process.env[user.pass]
    if (!SECRET || !expected || !secretsMatch(password, expected)) {
      await new Promise((r) => setTimeout(r, 400))
      return res.status(401).json({ error: 'wrong email or password' })
    }
    res.cookie(COOKIE, sign({ email, at: Date.now() }), {
      httpOnly: true,
      sameSite: 'lax',
      secure: Boolean(process.env.VERCEL),
      maxAge: TEN_YEARS,
      path: '/',
    })
    res.json({ email, name: user.name, users: roster() })
  })
)

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE, { path: '/' })
  res.sendStatus(204)
})

app.get(
  '/api/me',
  auth(async (req, res) => res.json({ email: req.email, name: USERS[req.email].name, users: roster() }))
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

// ---- sholat ----------------------------------------------------------------

// both users' marks for the week — the day cards show his and hers side by side
app.get(
  '/api/sholat',
  auth(async (req, res) => {
    if (!isWeek(req.query.week)) return res.status(400).json({ error: 'bad week' })
    const from = mondayOf(req.query.week)
    res.json(await all('SELECT * FROM sholat WHERE date >= ? AND date <= ?', [from, addDays(from, 6)]))
  })
)

// you can only mark your own
app.put(
  '/api/sholat',
  auth(async (req, res) => {
    const { date, prayer, ontime } = req.body
    if (!isDate(date) || !PRAYERS.includes(prayer)) return res.status(400).json({ error: 'bad mark' })
    if (date > today()) return res.status(400).json({ error: 'that day has not happened yet' })
    await db.execute(
      ontime
        ? {
            sql: 'INSERT OR IGNORE INTO sholat (email, date, prayer) VALUES (?, ?, ?)',
            args: [req.email, date, prayer],
          }
        : {
            sql: 'DELETE FROM sholat WHERE email = ? AND date = ? AND prayer = ?',
            args: [req.email, date, prayer],
          }
    )
    res.json({ email: req.email, date, prayer, ontime: Boolean(ontime) })
  })
)

// ---- stats -----------------------------------------------------------------

app.get(
  '/api/stats',
  auth(async (req, res) => {
    const now = today()
    const since = addDays(now, -55) // 8 weeks of trend, 30 days of rates
    // ponytail: reads the window, not the table. Aggregate in SQL if this ever gets slow.
    const rows = await all('SELECT * FROM sholat WHERE date >= ?', [since])

    const marks = new Set(rows.map((r) => `${r.email}|${r.date}|${r.prayer}`))
    const has = (email, date, prayer) => marks.has(`${email}|${date}|${prayer}`)
    const last30 = Array.from({ length: 30 }, (_, i) => addDays(now, -i))

    const byUser = {}
    for (const [email, user] of Object.entries(USERS)) {
      const onTimeIn = (dates) =>
        dates.reduce((n, d) => n + PRAYERS.filter((p) => has(email, d, p)).length, 0)

      const byPrayer = PRAYERS.map((prayer) => ({
        prayer,
        ontime: last30.filter((d) => has(email, d, prayer)).length,
        possible: last30.length,
      }))

      // consecutive complete days back from today (today still in progress, so it
      // extends a streak but never breaks one)
      let streak = 0
      for (let i = 0; i < 365; i++) {
        const d = addDays(now, -i)
        const complete = PRAYERS.every((p) => has(email, d, p))
        if (complete) streak++
        else if (i > 0) break
      }

      const thisMonday = mondayOf(now)
      const weekly = Array.from({ length: 8 }, (_, i) => {
        const week = addDays(thisMonday, -7 * (7 - i))
        const days = Array.from({ length: 7 }, (_, j) => addDays(week, j)).filter((d) => d <= now)
        return { week, ontime: onTimeIn(days), possible: days.length * PRAYERS.length }
      })

      byUser[email] = {
        name: user.name,
        last30: { ontime: onTimeIn(last30), possible: last30.length * PRAYERS.length },
        byPrayer,
        streak,
        weekly,
      }
    }

    res.json({ today: now, prayers: PRAYERS, byUser })
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
