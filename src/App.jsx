import { useEffect, useState } from 'react'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

// monday of the week containing `d`, as YYYY-MM-DD
function mondayOf(d) {
  const m = new Date(d)
  m.setHours(12, 0, 0, 0)
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7))
  return m.toISOString().slice(0, 10)
}

const shiftWeek = (week, n) => {
  const d = new Date(week + 'T12:00:00')
  d.setDate(d.getDate() + n * 7)
  return mondayOf(d)
}

const dateOf = (week, day) => {
  const d = new Date(week + 'T12:00:00')
  d.setDate(d.getDate() + day)
  return d
}

const fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

const api = (url, opts) =>
  fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts }).then((r) =>
    r.status === 204 ? null : r.json()
  )

export default function App() {
  const [week, setWeek] = useState(mondayOf(new Date()))
  const [tasks, setTasks] = useState([])
  const today = mondayOf(new Date()) === week ? (new Date().getDay() + 6) % 7 : -1

  useEffect(() => {
    api(`/api/tasks?week=${week}`).then(setTasks)
  }, [week])

  const add = async (day, text) => {
    const task = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ week, day, text }) })
    setTasks((t) => [...t, task])
  }

  const toggle = async (task) => {
    setTasks((t) => t.map((x) => (x.id === task.id ? { ...x, done: task.done ? 0 : 1 } : x)))
    await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ done: !task.done }) })
  }

  const remove = async (task) => {
    setTasks((t) => t.filter((x) => x.id !== task.id))
    await api(`/api/tasks/${task.id}`, { method: 'DELETE' })
  }

  const done = tasks.filter((t) => t.done).length

  return (
    <div className="page">
      <div className="cover" />
      <main>
        <div className="icon">✅</div>
        <h1>Weekly Checklist</h1>
        <p className="intro">
          Here, you will be adding your day-to-day tasks and as you accomplish them, you will check them off the list -
        </p>

        <div className="weekbar">
          <button onClick={() => setWeek(shiftWeek(week, -1))}>‹</button>
          <span className="range">
            {fmt(dateOf(week, 0))} – {fmt(dateOf(week, 6))}
          </span>
          <button onClick={() => setWeek(shiftWeek(week, 1))}>›</button>
          <button className="today" onClick={() => setWeek(mondayOf(new Date()))}>
            Today
          </button>
          <span className="count">
            {done}/{tasks.length} done
          </span>
        </div>

        <div className="grid">
          {DAYS.map((name, day) => (
            <Day
              key={day}
              name={name}
              day={day}
              date={dateOf(week, day)}
              isToday={day === today}
              tasks={tasks.filter((t) => t.day === day)}
              onAdd={add}
              onToggle={toggle}
              onRemove={remove}
            />
          ))}
        </div>
      </main>
    </div>
  )
}

function Day({ name, day, date, isToday, tasks, onAdd, onToggle, onRemove }) {
  const [text, setText] = useState('')

  const submit = (e) => {
    if (e.key !== 'Enter' || !text.trim()) return
    onAdd(day, text)
    setText('')
  }

  return (
    <section className={`card d${day}${isToday ? ' today' : ''}`}>
      <header>
        <h2>{name}</h2>
        <span className="date">{fmt(date)}</span>
      </header>
      <ul>
        {tasks.map((t) => (
          <li key={t.id} className={t.done ? 'done' : ''}>
            <span onClick={() => onToggle(t)}>{t.text}</span>
            <input type="checkbox" checked={!!t.done} onChange={() => onToggle(t)} />
            <button className="del" onClick={() => onRemove(t)} aria-label={`Delete ${t.text}`}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <input
        className="add"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={submit}
        placeholder="+ Add"
        aria-label={`Add task to ${name}`}
      />
    </section>
  )
}
