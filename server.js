import express from 'express'
import Database from 'better-sqlite3'

const db = new Database(process.env.DB_PATH || 'data.db')
db.pragma('journal_mode = WAL')
db.exec(`CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  week TEXT NOT NULL,           -- monday of the week, YYYY-MM-DD
  day INTEGER NOT NULL,         -- 0=Mon .. 6=Sun
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0
)`)

const isWeek = (w) => /^\d{4}-\d{2}-\d{2}$/.test(w || '')

const app = express()
app.use(express.json())

app.get('/api/tasks', (req, res) => {
  if (!isWeek(req.query.week)) return res.status(400).json({ error: 'bad week' })
  res.json(db.prepare('SELECT * FROM tasks WHERE week = ? ORDER BY id').all(req.query.week))
})

app.post('/api/tasks', (req, res) => {
  const { week, day, text } = req.body
  if (!isWeek(week) || !Number.isInteger(day) || day < 0 || day > 6 || !text?.trim())
    return res.status(400).json({ error: 'bad task' })
  const { lastInsertRowid } = db
    .prepare('INSERT INTO tasks (week, day, text) VALUES (?, ?, ?)')
    .run(week, day, text.trim().slice(0, 500))
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(lastInsertRowid))
})

app.patch('/api/tasks/:id', (req, res) => {
  const { text, done } = req.body
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)
  if (!row) return res.sendStatus(404)
  db.prepare('UPDATE tasks SET text = ?, done = ? WHERE id = ?').run(
    text?.trim() ? text.trim().slice(0, 500) : row.text,
    done === undefined ? row.done : (done ? 1 : 0),
    row.id
  )
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(row.id))
})

app.delete('/api/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id)
  res.sendStatus(204)
})

if (process.env.NODE_ENV === 'production') {
  app.use(express.static('dist'))
  app.get('*', (_, res) => res.sendFile('index.html', { root: 'dist' }))
}

const port = process.env.PORT || 3001
app.listen(port, () => console.log(`http://localhost:${port}`))
