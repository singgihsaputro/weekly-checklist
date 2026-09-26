import { useEffect, useState } from 'react'
import { api, PRAYERS, pct } from './api.js'

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
        {users.map((u) => (
          <div className="tile" key={u.email}>
            <h3>
              <i style={{ background: u.color }} />
              {u.name}
            </h3>
            <div className="hero">{pct(u.last30.ontime, u.last30.possible)}%</div>
            <p className="muted">
              on time · {u.last30.ontime} of {u.last30.possible} prayers, last 30 days
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
              {u.levels.includes('masjid') && (
                <div>
                  <dt>In the masjid</dt>
                  <dd>
                    <strong>{u.last30.masjid}</strong> prayers
                  </dd>
                </div>
              )}
            </dl>
          </div>
        ))}
      </div>

      <PrayerBars users={users} />
      <WeeklyTrend users={users} />

      <details className="tableview">
        <summary>Table view</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Prayer</th>
              {users.map((u) => (
                <th scope="col" key={u.email}>
                  {u.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PRAYERS.map(({ key, label }) => (
              <tr key={key}>
                <th scope="row">{label}</th>
                {users.map((u) => {
                  const row = u.byPrayer.find((p) => p.prayer === key)
                  return (
                    <td key={u.email}>
                      {pct(row.ontime, row.possible)}% <span className="muted">({row.ontime}/{row.possible})</span>
                    </td>
                  )
                })}
              </tr>
            ))}
            <tr>
              <th scope="row">On time, last 30 days</th>
              {users.map((u) => (
                <td key={u.email}>
                  <strong>{pct(u.last30.ontime, u.last30.possible)}%</strong>{' '}
                  <span className="muted">({u.last30.ontime}/{u.last30.possible})</span>
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Prayed at all</th>
              {users.map((u) => (
                <td key={u.email}>
                  {pct(u.last30.prayed, u.last30.possible)}%{' '}
                  <span className="muted">({u.last30.prayed}/{u.last30.possible})</span>
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">In the masjid</th>
              {users.map((u) => (
                <td key={u.email}>
                  {u.levels.includes('masjid') ? u.last30.masjid : <span className="muted">not tracked</span>}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </details>
    </div>
  )
}

function PrayerBars({ users }) {
  const narrow = useNarrow()
  const W = 640
  const LEFT = narrow ? 96 : 76
  const RIGHT = narrow ? 76 : 52
  const plot = W - LEFT - RIGHT
  const groupH = narrow ? 58 : 46
  const barH = narrow ? 20 : 16
  const H = PRAYERS.length * groupH + 24

  return (
    <section className="chart">
      <h2>On time by prayer</h2>
      <p className="muted">Share of the last 30 days each prayer was marked on time.</p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="On-time rate by prayer, per person">
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}>
            <line x1={LEFT + (plot * t) / 100} y1={8} x2={LEFT + (plot * t) / 100} y2={H - 22} className="grid" />
            <text x={LEFT + (plot * t) / 100} y={H - 6} className="axis" textAnchor="middle">
              {t}%
            </text>
          </g>
        ))}
        {PRAYERS.map(({ key, label }, gi) => {
          const top = gi * groupH + 10
          const inner = users.length * barH + (users.length - 1) * 2
          return (
            <g key={key}>
              <text x={LEFT - 10} y={top + inner / 2 + 4} className="cat" textAnchor="end">
                {label}
              </text>
              {users.map((u, ui) => {
                const row = u.byPrayer.find((p) => p.prayer === key)
                const value = pct(row.ontime, row.possible)
                const w = (plot * value) / 100
                const y = top + ui * (barH + 2)
                return (
                  <g key={u.email}>
                    {w >= 1 && <path d={barPath(LEFT, y, w, barH)} fill={u.color} />}
                    <text x={LEFT + w + 8} y={y + barH - 3} className="value">
                      {value}%
                    </text>
                    <title>
                      {u.name} · {label}: {row.ontime} of {row.possible} days on time
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
      <h2>Weekly on-time rate</h2>
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
                <path d={d} fill="none" stroke={u.color} strokeWidth="2" strokeLinejoin="round" />
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
          <div
            className="tooltip"
            style={{ left: `${Math.min(82, Math.max(18, (x(hover) / W) * 100))}%` }}
          >
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
