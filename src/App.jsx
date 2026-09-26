import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { api, DAYS, LEVEL_INFO, kept as isKept, mondayOf, shiftWeek, dateOf, dayIndex, fmt, fmtLong, ymd } from './api.js'
import Login from './Login.jsx'
import Dashboard from './Dashboard.jsx'
import Logo from './Logo.jsx'
import Ring from './Ring.jsx'
import StatusIcon from './StatusIcon.jsx'
import PullToRefresh from './PullToRefresh.jsx'

export default function App() {
  const [me, setMe] = useState(undefined) // undefined = still checking, null = signed out
  const [hash, setHash] = useState(location.hash)
  // bumping this is what a pull-to-refresh does; the pages watch it
  const [reloads, setReloads] = useState(0)

  const refresh = useCallback(async () => {
    setReloads((n) => n + 1)
    // let the refetch actually happen before the spinner stops
    await new Promise((r) => setTimeout(r, 450))
  }, [])

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
      <PullToRefresh onRefresh={refresh} />
      <div className="cover" />
      <main>
        <div className="brand">
          <Logo />
          <div>
            <h1>Daily Routines</h1>
            <p className="tagline">{onDashboard ? 'How the two of you are doing' : 'Tasks and routines, day by day'}</p>
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

        <AnimatePresence mode="wait">
          <motion.div
            key={onDashboard ? 'dash' : 'routines'}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.3, 1] }}
          >
            {onDashboard ? <Dashboard reloads={reloads} /> : <Routines me={me} reloads={reloads} />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}

function Routines({ me, reloads }) {
  const [view, setView] = useState(() => localStorage.getItem('view') || 'week')
  const [anchor, setAnchor] = useState(() => ymd(new Date()))
  const [tasks, setTasks] = useState([])
  const [marks, setMarks] = useState([])
  const reduced = useReducedMotion()

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
    api(`/api/routines?week=${week}`).then(setMarks)
  }, [week, reloads])

  const step = (n) => setAnchor(daily ? ymd(dateOf(anchor, n)) : shiftWeek(week, n))

  const openDay = (date) => {
    setAnchor(ymd(date))
    setView('day')
  }

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

  const setLevel = async (date, item, level) => {
    setMarks((m) => {
      const rest = m.filter((x) => !(x.email === me.email && x.date === date && x.item === item))
      return level ? [...rest, { email: me.email, date, item, level }] : rest
    })
    try {
      await api('/api/routines', { method: 'PUT', body: JSON.stringify({ date, item, level }) })
    } catch {
      api(`/api/routines?week=${week}`).then(setMarks) // put it back the way the server sees it
    }
  }

  const shown = daily ? [dayIndex(week, anchor)] : [0, 1, 2, 3, 4, 5, 6]
  const visible = tasks.filter((t) => shown.includes(t.day))
  const done = visible.filter((t) => t.done).length

  return (
    <>
      <div className="weekbar">
        <div className="viewtoggle" role="group" aria-label="View">
          {['week', 'day'].map((v) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {view === v && !reduced && <motion.span layoutId="viewpill" className="pill" transition={spring} />}
              <span>{v === 'week' ? 'Week' : 'Day'}</span>
            </button>
          ))}
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
          {done}/{visible.length} tasks done
        </span>
      </div>

      {me.notes?.length > 0 && (
        <motion.section
          className="notes"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.2, 0.8, 0.3, 1] }}
        >
          <h2>Catatan minggu ini</h2>
          <ul>
            {me.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </motion.section>
      )}

      <motion.div
        className={daily ? 'grid one' : 'grid'}
        initial="hidden"
        animate="shown"
        variants={{ shown: { transition: { staggerChildren: reduced ? 0 : 0.035 } } }}
      >
        {shown.map((day) => (
          <Day
            key={`${week}-${day}`}
            me={me}
            name={DAYS[day]}
            day={day}
            date={dateOf(week, day)}
            isToday={ymd(dateOf(week, day)) === today}
            compact={!daily}
            tasks={tasks.filter((t) => t.day === day)}
            marks={marks}
            onAdd={add}
            onToggle={toggle}
            onRemove={remove}
            onLevel={setLevel}
            onOpenDay={openDay}
          />
        ))}
      </motion.div>
    </>
  )
}

const spring = { type: 'spring', stiffness: 420, damping: 34 }

const cardIn = {
  hidden: { opacity: 0, y: 10 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.2, 0.8, 0.3, 1] } },
}

function Day({ me, name, day, date, isToday, compact, tasks, marks, onAdd, onToggle, onRemove, onLevel, onOpenDay }) {
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
  const levelOf = (email, item) =>
    marks.find((m) => m.email === email && m.date === iso && m.item === item)?.level || ''

  const onHaid = (email) => levelOf(email, 'haid') === 'haid'

  // Which routines a person owes today: the ones their account has at all, minus
  // the haid flag itself (a state, not an achievement), minus whatever that day
  // excuses — those are not owed, so they must not read as missed.
  const owedBy = (levels, haid) =>
    me.routines.filter(
      (r) => r.kind !== 'haid' && (levels[r.kind] || []).length > 0 && !(haid && r.haidExcused)
    )

  const scoreFor = (email, levels) => {
    const owed = owedBy(levels, onHaid(email))
    return { kept: owed.filter((r) => isKept(levelOf(email, r.key))).length, total: owed.length }
  }

  return (
    <motion.section variants={cardIn} className={`card d${day}${isToday ? ' today' : ''}`}>
      <header>
        <h2>{name}</h2>
        <span className="date">{fmt(date)}</span>
      </header>

      <ul>
        <AnimatePresence initial={false}>
          {tasks.map((t) => (
            <motion.li
              key={t.id}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={spring}
              className={t.done ? 'done' : ''}
            >
              <span onClick={() => onToggle(t)}>{t.text}</span>
              <input type="checkbox" checked={!!t.done} onChange={() => onToggle(t)} />
              <button className="del" onClick={() => onRemove(t)} aria-label={`Delete ${t.text}`}>
                ×
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <input
        className="add"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={submit}
        placeholder="+ Add"
        aria-label={`Add task to ${name}`}
      />

      <div className="routines">
        {people.map(({ email, name: who, levels }) => {
          const mine = email === me.email
          const haid = onHaid(email)
          const { kept, total } = scoreFor(email, levels)

          if (compact)
            return (
              <motion.button
                className="summary"
                key={email}
                onClick={() => onOpenDay(date)}
                whileTap={{ scale: 0.97 }}
                transition={spring}
                aria-label={`${who}: ${kept} of ${total} routines kept on ${iso} — open this day`}
              >
                <Ring value={kept} max={total} size={34} />
                <span className={mine ? 'me' : ''}>{who}</span>
                <span className="muted">
                  {kept}/{total}
                </span>
              </motion.button>
            )

          return (
            <div className="person" key={email}>
              <h3>
                <Ring value={kept} max={total} size={30} />
                <span className={mine ? 'me' : ''}>{who}</span>
                <span className="muted">
                  {kept}/{total}
                </span>
              </h3>
              <div className="routine-list">
                {me.routines
                  .filter((r) => (levels[r.kind] || []).length > 0)
                  .map((r) => {
                    const level = levelOf(email, r.key)
                    const label = `${who} · ${r.label} on ${iso}`
                    const allowed = levels[r.kind]
                    // on a haid day these are excused, not missed
                    const excused = haid && r.haidExcused
                    return (
                      <label
                        key={r.key}
                        className={`${allowed.length === 1 ? 'plain' : ''}${r.kind === 'haid' ? ' haid' : ''}${
                          excused ? ' excused' : ''
                        }`}
                      >
                        <StatusIcon level={excused ? 'haid' : level} title={excused ? 'Dalam haid' : LEVEL_INFO[level].label} />
                        <span className="name">{r.label}</span>
                        <span className="ctl">
                          {/* one level means done-or-not, which is a box; a scale needs a scale */}
                          {excused ? (
                            <em>Dalam haid</em>
                          ) : allowed.length === 1 ? (
                            <input
                              type="checkbox"
                              checked={level === allowed[0]}
                              disabled={!mine || future}
                              onChange={(e) => onLevel(iso, r.key, e.target.checked ? allowed[0] : null)}
                              aria-label={label}
                            />
                          ) : (
                            <select
                              className={`lv-${level || 'none'}`}
                              value={level}
                              disabled={!mine || future}
                              onChange={(e) => onLevel(iso, r.key, e.target.value || null)}
                              aria-label={label}
                            >
                              {['', ...allowed].map((key) => (
                                <option key={key || 'none'} value={key}>
                                  {LEVEL_INFO[key].label}
                                </option>
                              ))}
                            </select>
                          )}
                        </span>
                      </label>
                    )
                  })}
              </div>
            </div>
          )
        })}
      </div>
    </motion.section>
  )
}
