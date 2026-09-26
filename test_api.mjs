// Smoke check for the API: auth gate, tasks, sholat, stats. Run: node test_api.mjs
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dbPath = join(tmpdir(), `checklist-test-${Date.now()}.db`)
Object.assign(process.env, {
  DB_PATH: dbPath,
  PORT: '3399',
  APP_TZ: 'UTC',
  SESSION_SECRET: 'test-secret-not-a-real-one',
  PASSWORD_SINGGIH: 'correct-horse-battery-staple',
  PASSWORD_TITIS: 'a-different-one-entirely',
})
delete process.env.TURSO_DATABASE_URL

await import('./server.js')

const base = 'http://localhost:3399'
const SINGGIH = 'singgih.rochmad@gmail.com'
const TITIS = 'titis.ekaaprilia@gmail.com'
let cookie = ''

const call = (path, opts = {}) =>
  fetch(base + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...opts.headers },
  })

const json = async (path, opts) => {
  const r = await call(path, opts)
  return r.json()
}

const iso = (offsetDays = 0) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}
const mondayOf = (s) => {
  const d = new Date(`${s}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

try {
  // ---- the gate -----------------------------------------------------------
  assert.equal((await call('/api/tasks?week=2026-09-21')).status, 401, 'tasks need a session')
  assert.equal((await call('/api/stats')).status, 401, 'stats need a session')
  assert.equal((await call('/api/sholat?week=2026-09-21')).status, 401, 'sholat needs a session')
  assert.equal((await call('/api/me')).status, 401, 'me needs a session')

  const tryLogin = (email, password) =>
    call('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) })

  assert.equal((await tryLogin('someone.else@gmail.com', 'whatever')).status, 401, 'rejects other emails')
  assert.equal((await tryLogin(SINGGIH, 'wrong')).status, 401, 'rejects a wrong password')
  assert.equal(
    (await tryLogin(SINGGIH, 'a-different-one-entirely')).status,
    401,
    "rejects the other user's password"
  )

  const ok = await tryLogin(SINGGIH.toUpperCase(), 'correct-horse-battery-staple')
  assert.equal(ok.status, 200, 'accepts the right pair, case-insensitive email')
  const setCookie = ok.headers.get('set-cookie')
  assert.match(setCookie, /^session=/, 'sets a session cookie')
  assert.match(setCookie, /HttpOnly/i, 'cookie is HttpOnly')
  assert.ok(Number(setCookie.match(/Max-Age=(\d+)/i)[1]) > 60 * 60 * 24 * 365 * 5, 'session effectively never expires')
  cookie = setCookie.split(';')[0]

  const me = await json('/api/me')
  assert.equal(me.email, SINGGIH)
  assert.equal(me.name, 'Singgih')
  assert.equal(me.users.length, 2, 'roster carries both people')

  // a forged cookie must not get in
  const good = cookie
  cookie = 'session=eyJlbWFpbCI6InNpbmdnaWgucm9jaG1hZEBnbWFpbC5jb20ifQ.deadbeef'
  assert.equal((await call('/api/me')).status, 401, 'rejects a tampered signature')
  cookie = good

  // ---- tasks --------------------------------------------------------------
  const week = mondayOf(iso())
  const made = await json('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ week, day: 0, text: '  ship it  ' }),
  })
  assert.equal(made.text, 'ship it', 'trims text')
  assert.ok(Number.isInteger(made.id))
  const patched = await json(`/api/tasks/${made.id}`, { method: 'PATCH', body: JSON.stringify({ done: true }) })
  assert.equal(patched.done, 1)
  assert.equal((await call(`/api/tasks/${made.id}`, { method: 'DELETE' })).status, 204)
  assert.equal((await json(`/api/tasks?week=${week}`)).length, 0)

  // ---- sholat -------------------------------------------------------------
  assert.deepEqual(await json(`/api/sholat?week=${week}`), [], 'every prayer starts unchecked')

  assert.equal(
    (await call('/api/sholat', { method: 'PUT', body: JSON.stringify({ date: iso(), prayer: 'nope', ontime: true }) }))
      .status,
    400,
    'rejects an unknown prayer'
  )
  assert.equal(
    (await call('/api/sholat', { method: 'PUT', body: JSON.stringify({ date: iso(3), prayer: 'subuh', ontime: true }) }))
      .status,
    400,
    'rejects a future day'
  )

  await json('/api/sholat', { method: 'PUT', body: JSON.stringify({ date: iso(), prayer: 'subuh', ontime: true }) })
  await json('/api/sholat', { method: 'PUT', body: JSON.stringify({ date: iso(), prayer: 'isya', ontime: true }) })
  // marking twice must not double-count
  await json('/api/sholat', { method: 'PUT', body: JSON.stringify({ date: iso(), prayer: 'subuh', ontime: true }) })

  let marks = await json(`/api/sholat?week=${week}`)
  assert.equal(marks.length, 2, 'two marks stored, no duplicate')
  assert.ok(marks.every((m) => m.email === SINGGIH), 'marks belong to the signed-in user')

  await json('/api/sholat', { method: 'PUT', body: JSON.stringify({ date: iso(), prayer: 'isya', ontime: false }) })
  marks = await json(`/api/sholat?week=${week}`)
  assert.equal(marks.length, 1, 'unchecking removes the mark')

  // ---- stats --------------------------------------------------------------
  const stats = await json('/api/stats')
  assert.deepEqual(Object.keys(stats.byUser).sort(), [SINGGIH, TITIS].sort(), 'both users appear')
  const mine = stats.byUser[SINGGIH]
  assert.equal(mine.last30.ontime, 1)
  assert.equal(mine.last30.possible, 150, '30 days x 5 prayers')
  assert.equal(mine.byPrayer.find((p) => p.prayer === 'subuh').ontime, 1)
  assert.equal(mine.byPrayer.find((p) => p.prayer === 'isya').ontime, 0)
  assert.equal(mine.weekly.length, 8, 'eight weeks of trend')
  assert.equal(mine.streak, 0, 'one prayer today is not a complete day')
  assert.equal(stats.byUser[TITIS].last30.ontime, 0, 'the other user has nothing yet')

  // the current week is only counted up to today
  const current = mine.weekly[7]
  assert.ok(current.possible <= 35 && current.possible >= 5, `current week partial, got ${current.possible}`)

  // ---- the other user is isolated ----------------------------------------
  const titis = await tryLogin(TITIS, 'a-different-one-entirely')
  cookie = titis.headers.get('set-cookie').split(';')[0]
  assert.equal((await json('/api/me')).name, 'Titis')
  const seen = await json(`/api/sholat?week=${week}`)
  assert.equal(seen.length, 1, "sees the other person's mark")
  await json('/api/sholat', { method: 'PUT', body: JSON.stringify({ date: iso(), prayer: 'ashar', ontime: true }) })
  const after = await json('/api/stats')
  assert.equal(after.byUser[TITIS].last30.ontime, 1, 'writes land on the signed-in user')
  assert.equal(after.byUser[SINGGIH].last30.ontime, 1, "and not on the other's")

  // ---- logout -------------------------------------------------------------
  assert.equal((await call('/api/logout', { method: 'POST' })).status, 204)
  cookie = ''
  assert.equal((await call('/api/me')).status, 401, 'signed out again')

  console.log('ok')
} finally {
  for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true })
  process.exit(process.exitCode ?? 0)
}
