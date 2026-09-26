import { useEffect, useState } from 'react'
import {
  api,
  DAYS,
  PRAYERS,
  LEVEL_INFO,
  nextLevel,
  mondayOf,
  shiftWeek,
  dateOf,
  dayIndex,
  fmt,
  fmtLong,
  ymd,
} from './api.js'
import Login from './Login.jsx'
import Dashboard from './Dashboard.jsx'
import Logo from './Logo.jsx'

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
        <div className="brand">
          <Logo />
          <div>
            <h1>Daily Routines</h1>
            <p className="tagline">{onDashboard ? 'Sholat analytics' : 'Tasks and sholat, week by week'}</p>
          </div>
        </div>

        <nav className="nav">
          <a href="#/" className={onDashboard ? '' : 'on'}>
            Routines
          </a>
          <a href="#/dashboard" className={onDashboard ? 'on' : ''}>
            Analytics
          </a>
          <span className="who">
            {me.name}
            <button onClick={signOut}>Sign out</button>
          </span>
        </nav>

        {onDashboard ? <Dashboard /> : <Routines me={me} />}
      </main>
    </div>
  )
}

function Routines({ me }) {
  const [view, setView] = useState(() => localStorage.getItem('view') || 'week')
  const [anchor, setAnchor] = useState(() => ymd(new Date()))
  const [tasks, setTasks] = useState([])
  const [marks, setMarks] = useState([])

  const week = mondayOf(anchor)
  const today = ymd(new Date())
  const daily = view === 'day'

  useEffect(() => {
    localStorage.setItem('view', view)
  }, [view])

  // the day view still loads its whole week — one request either way, and
  // stepping between days then costs nothing
  useEffect(() => {
    api(`/api/tasks?week=${week}`).then(setTasks)
    api(`/api/sholat?week=${week}`).then(setMarks)
  }, [week])

  const step = (n) => setAnchor(daily ? ymd(dateOf(anchor, n)) : shiftWeek(week, n))

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

  const setLevel = async (date, prayer, level) => {
    setMarks((m) => {
      const rest = m.filter((x) => !(x.email === me.email && x.date === date && x.prayer === prayer))
      return level ? [...rest, { email: me.email, date, prayer, level }] : rest
    })
    try {
      await api('/api/sholat', { method: 'PUT', body: JSON.stringify({ date, prayer, level }) })
    } catch {
      api(`/api/sholat?week=${week}`).then(setMarks) // put it back the way the server sees it
    }
  }

  const shown = daily ? [dayIndex(week, anchor)] : [0, 1, 2, 3, 4, 5, 6]
  const visible = tasks.filter((t) => shown.includes(t.day))
  const done = visible.filter((t) => t.done).length

  return (
    <>
      <div className="weekbar">
        <div className="viewtoggle" role="group" aria-label="View">
          <button className={daily ? '' : 'on'} onClick={() => setView('week')}>
            Week
          </button>
          <button className={daily ? 'on' : ''} onClick={() => setView('day')}>
            Day
          </button>
        </div>
        <button onClick={() => step(-1)} aria-label={daily ? 'Previous day' : 'Previous week'}>
          ‹
        </button>
        <span className="range">
          {daily ? fmtLong(dateOf(week, shown[0])) : `${fmt(dateOf(week, 0))} – ${fmt(dateOf(week, 6))}`}
        </span>
        <button onClick={() => step(1)} aria-label={daily ? 'Next day' : 'Next week'}>
          ›
        </button>
        <button className="today" onClick={() => setAnchor(today)}>
          Today
        </button>
        <span className="count">
          {done}/{visible.length} done
        </span>
      </div>

      <div className="scale">
        {Object.entries(LEVEL_INFO).map(([key, info]) => (
          <span key={key || 'none'}>
            <b className={`lv-${key || 'none'}`}>{info.mark}</b> {info.label}
          </span>
        ))}
      </div>

      <div className={daily ? 'grid one' : 'grid'}>
        {shown.map((day) => (
          <Day
            key={day}
            me={me}
            name={DAYS[day]}
            day={day}
            date={dateOf(week, day)}
            isToday={ymd(dateOf(week, day)) === today}
            tasks={tasks.filter((t) => t.day === day)}
            marks={marks}
            onAdd={add}
            onToggle={toggle}
            onRemove={remove}
            onLevel={setLevel}
          />
        ))}
      </div>
    </>
  )
}

function Day({ me, name, day, date, isToday, tasks, marks, onAdd, onToggle, onRemove, onLevel }) {
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
          <span>Sholat</span>
          {PRAYERS.map((p) => (
            <abbr key={p.key} title={p.label}>
              {p.short}
            </abbr>
          ))}
        </div>
        {people.map(({ email, name: who, levels }) => {
          const mine = email === me.email
          return (
            <div className="sholat-row" key={email}>
              <span className={mine ? 'me' : ''}>{who}</span>
              {PRAYERS.map((p) => {
                const level = marks.find((m) => m.email === email && m.date === iso && m.prayer === p.key)?.level || ''
                const info = LEVEL_INFO[level]
                const description = `${who} · ${p.label} on ${iso}: ${info.label}`
                return (
                  <button
                    key={p.key}
                    className={`lv lv-${level || 'none'}`}
                    disabled={!mine || future}
                    onClick={() => onLevel(iso, p.key, nextLevel(level, levels))}
                    title={mine ? `${description} — tap to change` : description}
                    aria-label={description}
                  >
                    {info.mark}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </section>
  )
}
