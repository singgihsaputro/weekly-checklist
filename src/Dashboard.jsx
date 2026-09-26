import { useEffect, useState } from 'react'
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'
import { api, pct } from './api.js'

const SERIES = ['var(--series-1)', 'var(--series-2)']
const NARROW = '(max-width: 560px)'

// Charts keep a fixed viewBox, so on a phone every gutter and label has to be
// re-proportioned rather than just scaled down with the rest.
function useNarrow() {
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW).matches)
  useEffect(() => {
    const mq = matchMedia(NARROW)
    const sync = () => setNarrow(mq.matches)
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return narrow
}

function Count({ value, suffix = '' }) {
  const reduced = useReducedMotion()
  const raw = useMotionValue(reduced ? value : 0)
  const shown = useTransform(raw, (v) => Math.round(v) + suffix)
  useEffect(() => {
    if (reduced) return raw.set(value)
    const run = animate(raw, value, { duration: 0.9, ease: [0.2, 0.8, 0.3, 1] })
    return () => run.stop()
  }, [value, reduced])
  return <motion.span>{shown}</motion.span>
}

const weekLabel = (week) =>
  new Date(`${week}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

// rounds only the data end, so every bar stays anchored to the baseline
const barPath = (x, y, w, h, r = 4) => {
  const rr = Math.min(r, w)
  return `M${x},${y} H${x + w - rr} A${rr},${rr} 0 0 1 ${x + w},${y + rr} V${y + h - rr} A${rr},${rr} 0 0 1 ${x + w - rr},${y + h} H${x} Z`
}

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api('/api/stats').then(setStats).catch((e) => setError(e.message))
  }, [])

  if (error) return <p className="error">{error}</p>
  if (!stats) return <p className="muted">Loading…</p>

  const users = Object.entries(stats.byUser).map(([email, u], i) => ({ email, ...u, color: SERIES[i] }))

  return (
    <div className="dash">
      <div className="legend">
        {users.map((u) => (
          <span key={u.email}>
            <i style={{ background: u.color }} />
            {u.name}
          </span>
        ))}
      </div>

      <div className="tiles">
        {users.map((u, i) => (
          <motion.div
            className="tile"
            key={u.email}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.35, ease: [0.2, 0.8, 0.3, 1] }}
          >
            <h3>
              <i style={{ background: u.color }} />
              {u.name}
            </h3>
            <div className="hero">
              <Count value={pct(u.last30.ontime, u.last30.possible)} suffix="%" />
            </div>
            <p className="muted">
              sholat on time · {u.last30.ontime} of {u.last30.possible}, last 30 days
            </p>
            <dl className="sub">
              <div>
                <dt>Streak</dt>
                <dd>
                  <strong>{u.streak}</strong> days, all five on time
                </dd>
              </div>
              <div>
                <dt>Prayed at all</dt>
                <dd>
                  <strong>{pct(u.last30.prayed, u.last30.possible)}%</strong> ({u.last30.prayed}/
                  {u.last30.possible})
                </dd>
              </div>
              {u.levels.sholat.includes('masjid') && (
                <div>
                  <dt>In the masjid</dt>
                  <dd>
                    <strong>{u.last30.masjid}</strong> prayers
                  </dd>
                </div>
              )}
            </dl>
          </motion.div>
        ))}
      </div>

      <Bars
        users={users}
        title="Sholat on time"
        description="Share of the last 30 days each prayer was on time."
        rows={(u) => u.byPrayer.map((r) => ({ key: r.item, label: r.label, value: r.ontime, total: r.possible }))}
      />

      <Bars
        users={users}
        title="Other routines kept"
        description="Share of the last 30 days each routine was recorded as done."
        rows={(u) => u.byRoutine.map((r) => ({ key: r.item, label: r.label, value: r.done, total: r.possible }))}
      />

      <WeeklyTrend users={users} />

      <details className="tableview">
        <summary>Table view</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Routine</th>
              {users.map((u) => (
                <th scope="col" key={u.email}>
                  {u.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users[0].byPrayer.map((row, i) => (
              <tr key={row.item}>
                <th scope="row">{row.label}</th>
                {users.map((u) => (
                  <td key={u.email}>
                    {pct(u.byPrayer[i].ontime, u.byPrayer[i].possible)}%{' '}
                    <span className="muted">
                      ({u.byPrayer[i].ontime}/{u.byPrayer[i].possible} on time)
                    </span>
                  </td>
                ))}
              </tr>
            ))}
            {users[0].byRoutine.map((row, i) => (
              <tr key={row.item}>
                <th scope="row">{row.label}</th>
                {users.map((u) => (
                  <td key={u.email}>
                    {pct(u.byRoutine[i].done, u.byRoutine[i].possible)}%{' '}
                    <span className="muted">
                      ({u.byRoutine[i].done}/{u.byRoutine[i].possible})
                    </span>
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row">In the masjid</th>
              {users.map((u) => (
                <td key={u.email}>
                  {u.levels.sholat.includes('masjid') ? u.last30.masjid : <span className="muted">not tracked</span>}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </details>
    </div>
  )
}

function Bars({ users, title, description, rows }) {
  const narrow = useNarrow()
  const reduced = useReducedMotion()
  const data = users.map((u) => ({ ...u, rows: rows(u) }))
  const labels = data[0].rows

  const W = 640
  const LEFT = narrow ? 168 : 190
  const RIGHT = narrow ? 76 : 52
  const plot = W - LEFT - RIGHT
  const groupH = narrow ? 58 : 46
  const barH = narrow ? 20 : 16
  const H = labels.length * groupH + 24

  return (
    <section className="chart">
      <h2>{title}</h2>
      <p className="muted">{description}</p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}, per person`}>
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}>
            <line x1={LEFT + (plot * t) / 100} y1={8} x2={LEFT + (plot * t) / 100} y2={H - 22} className="grid" />
            <text x={LEFT + (plot * t) / 100} y={H - 6} className="axis" textAnchor="middle">
              {t}%
            </text>
          </g>
        ))}
        {labels.map((row, gi) => {
          const top = gi * groupH + 10
          const inner = data.length * barH + (data.length - 1) * 2
          return (
            <g key={row.key}>
              <text x={LEFT - 10} y={top + inner / 2 + 4} className="cat" textAnchor="end">
                {row.label}
              </text>
              {data.map((u, ui) => {
                const cell = u.rows[gi]
                const value = pct(cell.value, cell.total)
                const w = (plot * value) / 100
                const y = top + ui * (barH + 2)
                return (
                  <g key={u.email}>
                    {w >= 1 && (
                      <motion.path
                        initial={reduced ? false : { opacity: 0 }}
                        animate={{ d: barPath(LEFT, y, w, barH), opacity: 1 }}
                        transition={{ duration: reduced ? 0 : 0.5, delay: reduced ? 0 : gi * 0.04 }}
                        d={barPath(LEFT, y, w, barH)}
                        fill={u.color}
                      />
                    )}
                    <text x={LEFT + w + 8} y={y + barH - 3} className="value">
                      {value}%
                    </text>
                    <title>
                      {u.name} · {row.label}: {cell.value} of {cell.total} days
                    </title>
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>
    </section>
  )
}

function WeeklyTrend({ users }) {
  const [hover, setHover] = useState(null)
  const narrow = useNarrow()
  const W = 640
  const H = narrow ? 280 : 240
  const LEFT = narrow ? 52 : 40
  // on a phone the legend already names the series, so the end labels come off
  // and give their room back to the plot
  const RIGHT = narrow ? 18 : 56
  const TOP = 12
  const BOTTOM = narrow ? 40 : 30
  const weeks = users[0].weekly
  const plotW = W - LEFT - RIGHT
  const plotH = H - TOP - BOTTOM
  const x = (i) => LEFT + (plotW * i) / Math.max(1, weeks.length - 1)
  const y = (v) => TOP + plotH - (plotH * v) / 100

  const at = (clientX, target) => {
    const box = target.getBoundingClientRect()
    const px = ((clientX - box.left) / box.width) * W
    setHover(Math.max(0, Math.min(weeks.length - 1, Math.round(((px - LEFT) / plotW) * (weeks.length - 1)))))
  }
  const move = (e) => at(e.clientX, e.currentTarget)
  const touch = (e) => at(e.touches[0].clientX, e.currentTarget)

  return (
    <section className="chart">
      <h2>Weekly sholat on-time rate</h2>
      <p className="muted">Last eight weeks. The current week counts only the days so far.</p>
      <div className="plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Weekly on-time rate per person, last eight weeks">
          {[0, 25, 50, 75, 100].map((t) => (
            <g key={t}>
              <line x1={LEFT} y1={y(t)} x2={W - RIGHT} y2={y(t)} className="grid" />
              <text x={LEFT - 8} y={y(t) + 4} className="axis" textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          {weeks.map((w, i) =>
            // every other label on a phone, or they collide
            narrow && i % 2 ? null : (
              <text key={w.week} x={x(i)} y={H - 10} className="axis" textAnchor="middle">
                {weekLabel(w.week)}
              </text>
            )
          )}

          {hover !== null && <line x1={x(hover)} y1={TOP} x2={x(hover)} y2={TOP + plotH} className="crosshair" />}

          {users.map((u) => {
            const d = u.weekly.map((w, i) => `${i ? 'L' : 'M'}${x(i)},${y(pct(w.ontime, w.possible))}`).join(' ')
            const last = u.weekly.length - 1
            return (
              <g key={u.email}>
                <motion.path
                  d={d}
                  fill="none"
                  stroke={u.color}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                />
                {u.weekly.map((w, i) => (
                  <circle
                    key={w.week}
                    cx={x(i)}
                    cy={y(pct(w.ontime, w.possible))}
                    r={hover === i ? 6 : 4.5}
                    fill={u.color}
                    className="marker"
                  />
                ))}
                {!narrow && (
                  <text
                    x={x(last) + 10}
                    y={y(pct(u.weekly[last].ontime, u.weekly[last].possible)) + 4}
                    className="value"
                  >
                    {u.name}
                  </text>
                )}
              </g>
            )
          })}
          <rect
            x={LEFT}
            y={TOP}
            width={plotW}
            height={plotH}
            fill="transparent"
            onMouseMove={move}
            onMouseLeave={() => setHover(null)}
            onTouchStart={touch}
            onTouchMove={touch}
            onTouchEnd={() => setHover(null)}
          />
        </svg>
        {hover !== null && (
          <div className="tooltip" style={{ left: `${Math.min(82, Math.max(18, (x(hover) / W) * 100))}%` }}>
            <strong>Week of {weekLabel(weeks[hover].week)}</strong>
            {users.map((u) => (
              <span key={u.email}>
                <i style={{ background: u.color }} />
                {u.name}: {pct(u.weekly[hover].ontime, u.weekly[hover].possible)}%{' '}
                <span className="muted">
                  ({u.weekly[hover].ontime}/{u.weekly[hover].possible})
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
