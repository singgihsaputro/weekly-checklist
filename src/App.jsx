import { useEffect, useState } from 'react'
import { api, DAYS, PRAYERS, mondayOf, shiftWeek, dateOf, fmt, ymd } from './api.js'
import Login from './Login.jsx'
import Dashboard from './Dashboard.jsx'

export default function App() {
  const [me, setMe] = useState(undefined) // undefined = still checking, null = signed out
  const [hash, setHash] = useState(location.hash)

  useEffect(() => {
    api('/api/me')
      .then(setMe)
      .catch(() => setMe(null))
  }, [])

  useEffect(() => {
    const onHash = () => setHash(location.hash)
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  const signOut = async () => {
    await api('/api/logout', { method: 'POST' })
    setMe(null)
  }

  if (me === undefined) return <p className="boot">Loading…</p>
  if (!me) return <Login />

  const onDashboard = hash.startsWith('#/dashboard')

  return (
    <div className="page">
      <div className="cover" />
      <main>
        <div className="icon">{onDashboard ? '📊' : '✅'}</div>
        <h1>{onDashboard ? 'Sholat analytics' : 'Weekly Checklist'}</h1>

        <nav className="nav">
          <a href="#/" className={onDashboard ? '' : 'on'}>
            Checklist
          </a>
          <a href="#/dashboard" className={onDashboard ? 'on' : ''}>
            Analytics
          </a>
          <span className="who">
            {me.name}
            <button onClick={signOut}>Sign out</button>
          </span>
        </nav>

        {onDashboard ? <Dashboard /> : <Checklist me={me} />}
      </main>
    </div>
  )
}

function Checklist({ me }) {
  const [week, setWeek] = useState(mondayOf(new Date()))
  const [tasks, setTasks] = useState([])
  const [marks, setMarks] = useState([])
  const todayWeek = mondayOf(new Date())
  const today = todayWeek === week ? (new Date().getDay() + 6) % 7 : -1

  useEffect(() => {
    api(`/api/tasks?week=${week}`).then(setTasks)
    api(`/api/sholat?week=${week}`).then(setMarks)
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

  const markSholat = async (date, prayer, ontime) => {
    setMarks((m) =>
      ontime
        ? [...m, { email: me.email, date, prayer }]
        : m.filter((x) => !(x.email === me.email && x.date === date && x.prayer === prayer))
    )
    try {
      await api('/api/sholat', { method: 'PUT', body: JSON.stringify({ date, prayer, ontime }) })
    } catch {
      api(`/api/sholat?week=${week}`).then(setMarks) // put it back the way the server sees it
    }
  }

  const done = tasks.filter((t) => t.done).length

  return (
    <>
      <p className="intro">
        Here, you will be adding your day-to-day tasks and as you accomplish them, you will check them off the list -
      </p>

      <div className="weekbar">
        <button onClick={() => setWeek(shiftWeek(week, -1))} aria-label="Previous week">
          ‹
        </button>
        <span className="range">
          {fmt(dateOf(week, 0))} – {fmt(dateOf(week, 6))}
        </span>
        <button onClick={() => setWeek(shiftWeek(week, 1))} aria-label="Next week">
          ›
        </button>
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
            me={me}
            name={name}
            day={day}
            date={dateOf(week, day)}
            isToday={day === today}
            tasks={tasks.filter((t) => t.day === day)}
            marks={marks}
            onAdd={add}
            onToggle={toggle}
            onRemove={remove}
            onMark={markSholat}
          />
        ))}
      </div>
    </>
  )
}

function Day({ me, name, day, date, isToday, tasks, marks, onAdd, onToggle, onRemove, onMark }) {
  const [text, setText] = useState('')
  const iso = ymd(date)
  const future = iso > ymd(new Date())

  const submit = (e) => {
    if (e.key !== 'Enter' || !text.trim()) return
    onAdd(day, text)
    setText('')
  }

  // whoever is signed in goes first, so your own row is the one under your thumb
  const people = [...me.users].sort((a, b) => (a.email === me.email ? -1 : b.email === me.email ? 1 : 0))

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

      <div className="sholat">
        <div className="sholat-head">
          <span>Sholat on time</span>
          {PRAYERS.map((p) => (
            <abbr key={p.key} title={p.label}>
              {p.short}
            </abbr>
          ))}
        </div>
        {people.map(({ email, name: who }) => {
          const mine = email === me.email
          return (
            <div className="sholat-row" key={email}>
              <span className={mine ? 'me' : ''}>{who}</span>
              {PRAYERS.map((p) => {
                const on = marks.some((m) => m.email === email && m.date === iso && m.prayer === p.key)
                return (
                  <input
                    key={p.key}
                    type="checkbox"
                    checked={on}
                    disabled={!mine || future}
                    onChange={() => onMark(iso, p.key, !on)}
                    aria-label={`${who} ${p.label} on ${iso}${mine ? '' : ' (read only)'}`}
                  />
                )
              })}
            </div>
          )
        })}
      </div>
    </section>
  )
}
