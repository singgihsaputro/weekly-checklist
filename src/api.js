// Same-origin, so the session cookie rides along without any extra config.
export async function api(url, opts) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!r.ok) {
    const body = await r.json().catch(() => ({}))
    const err = new Error(body.error || r.statusText)
    err.status = r.status
    throw err
  }
  return r.status === 204 ? null : r.json()
}

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

// local calendar date, not UTC — the day must not flip at 07:00 Jakarta time
export const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function mondayOf(d) {
  const m = new Date(d)
  m.setHours(12, 0, 0, 0)
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7))
  return ymd(m)
}

export const shiftWeek = (week, n) => {
  const d = new Date(`${week}T12:00:00`)
  d.setDate(d.getDate() + n * 7)
  return mondayOf(d)
}

export const dateOf = (week, day) => {
  const d = new Date(`${week}T12:00:00`)
  d.setDate(d.getDate() + day)
  return d
}

export const fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0)

// Worst to best; the empty key is "not recorded", which is no row at all. The
// wording is what the dropdown shows, so it has to read on its own.
export const LEVEL_INFO = {
  '': { label: 'Not recorded' },
  sholat: { label: 'Sholat, late' },
  ontime: { label: 'On time' },
  masjid: { label: 'On time in masjid' },
  done: { label: 'Done' },
  haid: { label: 'Dalam haid' },
}

// Anything recorded counts towards the day's progress — a late prayer is still a
// prayer. Lateness is surfaced separately rather than by withholding the tick.
export const kept = (level) => Boolean(level)

export const dayIndex = (week, date) =>
  Math.round((new Date(`${date}T12:00:00`) - new Date(`${week}T12:00:00`)) / 86400000)

export const fmtLong = (d) =>
  d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
