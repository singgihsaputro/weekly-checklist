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

export const PRAYERS = [
  { key: 'subuh', label: 'Subuh', short: 'Sb' },
  { key: 'dzuhur', label: 'Dzuhur', short: 'Dz' },
  { key: 'ashar', label: 'Ashar', short: 'As' },
  { key: 'maghrib', label: 'Maghrib', short: 'Mg' },
  { key: 'isya', label: 'Isya', short: 'Is' },
]

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

// Worst to best; the empty key is "nothing recorded", which is no row at all.
// Glyphs differ in shape as well as colour, so the scale survives a greyscale
// screen or a colourblind reader.
export const LEVEL_INFO = {
  '': { label: 'nothing recorded', mark: '–' },
  sholat: { label: 'sholat, not on time', mark: '○' },
  ontime: { label: 'on time', mark: '●' },
  masjid: { label: 'on time in masjid', mark: '◉' },
}

export const nextLevel = (level, allowed) => {
  const order = ['', ...allowed]
  return order[(order.indexOf(level || '') + 1) % order.length]
}

export const dayIndex = (week, date) =>
  Math.round((new Date(`${date}T12:00:00`) - new Date(`${week}T12:00:00`)) / 86400000)

export const fmtLong = (d) =>
  d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
