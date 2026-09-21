import express from 'express'
import { createClient } from '@libsql/client'

// Turso in the cloud; a local SQLite file when no credentials are set.
const db = createClient(
  process.env.TURSO_DATABASE_URL
    ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: `file:${process.env.DB_PATH || 'data.db'}` }
)

// serverless cold starts have no startup hook, so create the table on first use
let ready
const init = () =>
  (ready ??= db
    .execute(
      `CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY,
        week TEXT NOT NULL,           -- monday of the week, YYYY-MM-DD
        day INTEGER NOT NULL,         -- 0=Mon .. 6=Sun
        text TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0
      )`
    )
    .catch((e) => {
      ready = null
      throw e
    }))

const isWeek = (w) => /^\d{4}-\d{2}-\d{2}$/.test(w || '')

const all = async (sql, args) => (await db.execute({ sql, args })).rows
const one = async (sql, args) => (await all(sql, args))[0]

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

const app = express()
app.use(express.json())

app.get(
  '/api/tasks',
  route(async (req, res) => {
    if (!isWeek(req.query.week)) return res.status(400).json({ error: 'bad week' })
    res.json(await all('SELECT * FROM tasks WHERE week = ? ORDER BY id', [req.query.week]))
  })
)

app.post(
  '/api/tasks',
  route(async (req, res) => {
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
  route(async (req, res) => {
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
  route(async (req, res) => {
    await db.execute({ sql: 'DELETE FROM tasks WHERE id = ?', args: [req.params.id] })
    res.sendStatus(204)
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
