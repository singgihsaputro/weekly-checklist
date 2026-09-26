// Smoke check: Google sign-in, the allowlist, tasks, sholat, stats.
// Run: node test_api.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com'
const SINGGIH = 'singgih.rochmad@gmail.com'
const TITIS = 'titis.ekaaprilia@gmail.com'

// --- a stand-in for Google's token endpoint ---------------------------------
let respond = () => ({ status: 200, body: {} })
let lastForm = null
const stub = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    lastForm = Object.fromEntries(new URLSearchParams(raw))
    const { status, body } = respond()
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  })
})
await new Promise((r) => stub.listen(3398, r))

const dbPath = join(tmpdir(), `checklist-test-${Date.now()}.db`)
Object.assign(process.env, {
  DB_PATH: dbPath,
  PORT: '3399',
  APP_TZ: 'UTC',
  SESSION_SECRET: 'test-secret-not-a-real-one',
  CRON_SECRET: 'test-cron-secret',
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  OAUTH_TOKEN_ENDPOINT: 'http://127.0.0.1:3398/token',
  OAUTH_REDIRECT_URI: 'http://localhost:3399/api/auth/callback',
})
delete process.env.TURSO_DATABASE_URL

const { buildReport } = await import('./server.js')

const base = 'http://localhost:3399'
let cookie = ''
const call = (p, o = {}) =>
  fetch(base + p, {
    redirect: 'manual',
    ...o,
    headers: { 'Content-Type': 'application/json', ...(cookie && { cookie }), ...o.headers },
  })
const json = async (p, o) => (await call(p, o)).json()

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const idToken = (claims) => `${b64({ alg: 'RS256' })}.${b64(claims)}.not-checked-see-server-comment`
const baseClaims = (over = {}) => ({
  aud: CLIENT_ID,
  iss: 'https://accounts.google.com',
  exp: Math.floor(Date.now() / 1000) + 3600,
  email: SINGGIH,
  email_verified: true,
  ...over,
})
const pick = (r, name) =>
  (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith(`${name}=`) && c.length > name.length + 1)

// Walks the whole flow: start → carry the flow cookie → callback. Returns the
// session cookie, or null when the server refused.
async function signIn({ claims = {}, tamperState, dropFlowCookie } = {}) {
  const start = await fetch(`${base}/api/auth/google`, { redirect: 'manual' })
  const authorize = new URL(start.headers.get('location'))
  const flow = (start.headers.getSetCookie() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('oauth_flow='))
  const state = tamperState ?? authorize.searchParams.get('state')
  const nonce = authorize.searchParams.get('nonce')
  respond = () => ({ status: 200, body: { id_token: idToken(baseClaims({ nonce, ...claims })) } })
  const cb = await fetch(`${base}/api/auth/callback?code=fake-code&state=${encodeURIComponent(state)}`, {
    redirect: 'manual',
    headers: dropFlowCookie ? {} : { cookie: flow },
  })
  return { authorize, session: pick(cb, 'session') ?? null, location: cb.headers.get('location') }
}

try {
  // ---- the gate -----------------------------------------------------------
  for (const path of ['/api/tasks?week=2026-09-21', '/api/stats', '/api/routines?week=2026-09-21', '/api/me'])
    assert.equal((await call(path)).status, 401, `${path} needs a session`)

  // ---- the authorize request ---------------------------------------------
  const { authorize } = await signIn()
  const q = authorize.searchParams
  assert.equal(authorize.origin + authorize.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
  assert.equal(q.get('client_id'), CLIENT_ID)
  assert.equal(q.get('response_type'), 'code')
  assert.equal(q.get('code_challenge_method'), 'S256', 'PKCE is on')
  assert.ok(q.get('code_challenge'), 'sends a challenge')
  assert.ok(q.get('state') && q.get('nonce'), 'sends state and nonce')
  assert.match(q.get('scope'), /openid/, 'asks for openid')
  assert.equal(lastForm.code_verifier?.length > 20, true, 'exchange sends the PKCE verifier')
  assert.equal(lastForm.grant_type, 'authorization_code')

  // ---- who gets refused ---------------------------------------------------
  const refused = {
    'an uninvited google account': { claims: { email: 'someone.else@gmail.com' } },
    'an unverified email': { claims: { email_verified: false } },
    'a token minted for another app': { claims: { aud: 'someone-elses-client-id' } },
    'a replayed nonce': { claims: { nonce: 'not-the-one-we-sent' } },
    'an expired token': { claims: { exp: Math.floor(Date.now() / 1000) - 60 } },
    'a wrong issuer': { claims: { iss: 'https://evil.example' } },
    'a forged state (CSRF)': { tamperState: 'attacker-chosen-state' },
    'a missing flow cookie': { dropFlowCookie: true },
  }
  for (const [label, opts] of Object.entries(refused)) {
    const { session, location } = await signIn(opts)
    assert.equal(session, null, `refuses ${label}`)
    assert.equal(location, '/?auth=denied', `${label} lands on the generic notice`)
  }

  // a token endpoint that errors must not let anyone through
  {
    const start = await fetch(`${base}/api/auth/google`, { redirect: 'manual' })
    const flow = (start.headers.getSetCookie() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('oauth_flow='))
    const state = new URL(start.headers.get('location')).searchParams.get('state')
    respond = () => ({ status: 400, body: { error: 'invalid_grant' } })
    const cb = await fetch(`${base}/api/auth/callback?code=x&state=${state}`, {
      redirect: 'manual',
      headers: { cookie: flow },
    })
    assert.equal(pick(cb, 'session') ?? null, null, 'refuses when the exchange fails')
  }

  // ---- who gets in --------------------------------------------------------
  const good = await signIn()
  assert.ok(good.session, 'the invited account is let in')
  assert.equal(good.location, '/', 'lands back on the app')
  cookie = good.session

  const me = await json('/api/me')
  assert.equal(me.email, SINGGIH)
  assert.equal(me.name, 'Singgih')
  assert.equal(me.users.length, 2, 'roster carries both people')
  const rosterOf = (email) => me.users.find((u) => u.email === email)
  assert.deepEqual(rosterOf(SINGGIH).levels.sholat, ['sholat', 'ontime', 'masjid'], 'masjid is his to use')
  assert.deepEqual(rosterOf(TITIS).levels.sholat, ['sholat', 'ontime'], 'and not hers')
  assert.deepEqual(rosterOf(TITIS).levels.done, ['done'], 'the plain routines are the same for both')
  assert.deepEqual(rosterOf(TITIS).levels.haid, ['haid'], 'haid is hers')
  assert.deepEqual(rosterOf(SINGGIH).levels.haid, [], 'and does not apply to him at all')
  assert.equal(me.routines.length, 13, 'twelve routines plus the haid flag')
  assert.equal(me.routines.filter((r) => r.kind === 'sholat').length, 5)
  assert.ok(
    me.routines.some((r) => r.key === 'tidur_sebelum_10' && r.kind === 'done'),
    'the catalogue carries the non-sholat routines'
  )

  const forged = cookie
  cookie = 'session=eyJlbWFpbCI6InNpbmdnaWgucm9jaG1hZEBnbWFpbC5jb20ifQ.deadbeef'
  assert.equal((await call('/api/me')).status, 401, 'rejects a tampered session signature')
  cookie = forged

  // ---- tasks --------------------------------------------------------------
  const mondayOf = (s) => {
    const d = new Date(`${s}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
    return d.toISOString().slice(0, 10)
  }
  const iso = (n = 0) => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
  }
  const week = mondayOf(iso())

  const made = await json('/api/tasks', { method: 'POST', body: JSON.stringify({ week, day: 0, text: '  ship it  ' }) })
  assert.equal(made.text, 'ship it', 'trims text')
  assert.equal((await json(`/api/tasks/${made.id}`, { method: 'PATCH', body: JSON.stringify({ done: true }) })).done, 1)
  assert.equal((await call(`/api/tasks/${made.id}`, { method: 'DELETE' })).status, 204)
  assert.equal((await json(`/api/tasks?week=${week}`)).length, 0)

  // ---- routines -----------------------------------------------------------
  assert.deepEqual(await json(`/api/routines?week=${week}`), [], 'nothing is recorded to start with')
  const put = (body) => call('/api/routines', { method: 'PUT', body: JSON.stringify(body) })
  assert.equal((await put({ date: iso(), item: 'invented', level: 'done' })).status, 400, 'rejects an unknown routine')
  assert.equal((await put({ date: iso(3), item: 'sholat_subuh', level: 'ontime' })).status, 400, 'rejects a future day')
  assert.equal(
    (await put({ date: iso(), item: 'sholat_subuh', level: 'invented' })).status,
    400,
    'rejects an unknown level'
  )
  // the two kinds do not share a scale
  assert.equal((await put({ date: iso(), item: 'olahraga_pagi', level: 'masjid' })).status, 400, 'a habit is not a prayer')
  assert.equal((await put({ date: iso(), item: 'sholat_subuh', level: 'done' })).status, 400, 'a prayer is not a habit')
  assert.equal((await put({ date: iso(), item: 'haid', level: 'haid' })).status, 400, 'haid does not apply to him')

  await put({ date: iso(), item: 'sholat_subuh', level: 'sholat' })
  await put({ date: iso(), item: 'sholat_isya', level: 'ontime' })
  await put({ date: iso(), item: 'sholat_maghrib', level: 'masjid' })
  await put({ date: iso(), item: 'olahraga_pagi', level: 'done' })
  await put({ date: iso(), item: 'tidur_sebelum_10', level: 'done' })
  let marks = await json(`/api/routines?week=${week}`)
  assert.equal(marks.length, 5, 'five marks stored')
  assert.ok(marks.every((m) => m.email === SINGGIH), 'marks belong to the signed-in user')
  assert.equal(marks.find((m) => m.item === 'sholat_maghrib').level, 'masjid', 'level is stored, not just presence')

  // changing a level replaces it rather than adding a second row
  await put({ date: iso(), item: 'sholat_subuh', level: 'ontime' })
  marks = await json(`/api/routines?week=${week}`)
  assert.equal(marks.length, 5, 'still five rows')
  assert.equal(marks.find((m) => m.item === 'sholat_subuh').level, 'ontime', 'the level moved up')

  await put({ date: iso(), item: 'sholat_isya', level: null })
  assert.equal((await json(`/api/routines?week=${week}`)).length, 4, 'clearing removes the row')

  // ---- stats --------------------------------------------------------------
  const stats = await json('/api/stats')
  assert.deepEqual(Object.keys(stats.byUser).sort(), [SINGGIH, TITIS].sort(), 'both users appear')
  const mine = stats.byUser[SINGGIH]
  assert.equal(mine.last30.ontime, 2, 'ontime and masjid both count as on time')
  assert.equal(mine.last30.masjid, 1, 'masjid counted separately too')
  assert.equal(mine.last30.prayed, 2, 'prayed counts every level')
  assert.equal(mine.last30.possible, 150, '30 days x 5 prayers — habits are not in this number')
  assert.equal(mine.byPrayer.find((p) => p.item === 'sholat_subuh').ontime, 1)
  assert.equal(mine.byRoutine.length, 7, 'the seven other routines are reported')
  assert.equal(mine.byRoutine.find((r) => r.item === 'olahraga_pagi').done, 1)
  assert.equal(mine.byRoutine.find((r) => r.item === 'mandi_pagi').done, 0)
  assert.equal(mine.byRoutine.find((r) => r.item === 'tidur_sebelum_10').possible, 30)
  assert.equal(mine.weekly.length, 8, 'eight weeks of trend')
  assert.equal(mine.streak, 0, 'two prayers today is not a complete day')
  assert.ok(mine.weekly[7].possible <= 35, 'the current week counts only the days so far')

  // ---- the second account is isolated ------------------------------------
  cookie = (await signIn({ claims: { email: TITIS } })).session
  assert.ok(cookie, 'the other invited account is let in too')
  assert.equal((await json('/api/me')).name, 'Titis')
  assert.equal((await json(`/api/routines?week=${week}`)).length, 4, "sees the other person's marks")

  // the masjid level is his, not hers — the server decides, not the client
  assert.equal(
    (await put({ date: iso(), item: 'sholat_ashar', level: 'masjid' })).status,
    400,
    'masjid is refused for her'
  )
  assert.equal((await json(`/api/routines?week=${week}`)).length, 4, 'and nothing was written')

  await put({ date: iso(), item: 'sholat_ashar', level: 'ontime' })
  const after = await json('/api/stats')
  assert.equal(after.byUser[TITIS].last30.ontime, 1, 'writes land on the signed-in user')
  assert.equal(after.byUser[TITIS].last30.masjid, 0, 'she has no masjid prayers')
  assert.equal(after.byUser[SINGGIH].last30.ontime, 2, "and not on the other's")

  // ---- the nightly report -------------------------------------------------
  {
    const saved = cookie
    cookie = '' // the cron runs with no session at all

    const bearer = (token) => call('/api/cron/daily-report?dry=1', { headers: token ? { authorization: token } : {} })
    assert.equal((await bearer(null)).status, 401, 'the report needs the cron secret')
    assert.equal((await bearer('Bearer wrong')).status, 401, 'and the right one')

    const r = await bearer('Bearer test-cron-secret')
    assert.equal(r.status, 200, 'the scheduler gets in')
    const report = await r.json()
    assert.match(report.subject, /^SingFams Daily Routines - /)
    assert.ok(report.html.includes('Shubuh') && report.html.includes('Maghrib'), 'pills carry full prayer names')
    assert.equal(report.people.length, 2, 'both people are in the report')

    const him = report.people.find((p) => p.email === SINGGIH)
    // he ended the run with subuh on time, maghrib in the masjid, and two habits
    assert.equal(him.kept, 4, `counts what was recorded, got ${him.kept}`)
    assert.equal(him.total, 12)
    assert.equal(him.onTime, 2, 'ontime and masjid both count as on time')
    assert.equal(him.masjid, 1)
    assert.equal(him.missed.length, 8, 'and names what was missed')
    assert.ok(him.missed.includes('Mandi Pagi'))
    assert.match(report.text, /Singgih — 4\/12 routines/)
    assert.match(report.text, /in the masjid/)
    assert.ok(!report.html.includes('<script'), 'the html is escaped')

    // a day nobody touched still renders, rather than throwing
    const empty = await (await bearer('Bearer test-cron-secret')).json()
    assert.ok(empty.text.length > 0)

    cookie = saved
  }

  // ---- haid ---------------------------------------------------------------
  // (still signed in as Titis from the isolation block above)
  {
    const day = iso(-1) // yesterday, so today's marks are left alone
    for (const item of ['sholat_subuh', 'sholat_dzuhur']) await put({ date: day, item, level: 'ontime' })

    const before = (await json('/api/stats')).byUser[TITIS]
    assert.equal(before.last30.possible, 150, 'every day is owed to start with')

    assert.equal((await put({ date: day, item: 'haid', level: 'haid' })).status, 200, 'she can set it')
    const marks = await json(`/api/routines?week=${mondayOf(day)}`)
    assert.ok(marks.some((m) => m.item === 'haid' && m.email === TITIS), 'stored as one row, not five')
    assert.ok(
      marks.some((m) => m.item === 'sholat_subuh' && m.email === TITIS && m.level === 'ontime'),
      'her existing prayer marks are kept, not destroyed'
    )

    const after = (await json('/api/stats')).byUser[TITIS]
    assert.equal(after.last30.possible, 145, 'that day leaves the denominator (29 days x 5)')
    assert.equal(after.last30.haidDays, 1, 'and is reported as such')
    assert.equal(after.last30.ontime, before.last30.ontime - 2, 'its prayers leave the numerator too')
    assert.equal(
      after.byPrayer.find((p) => p.item === 'sholat_subuh').possible,
      29,
      'per-prayer denominators drop as well'
    )
    // the habits still count — only the prayers are excused
    assert.equal(after.byRoutine.find((r) => r.item === 'puasa_sunnah').possible, 30)

    const him = (await json('/api/stats')).byUser[SINGGIH]
    assert.equal(him.last30.possible, 150, 'his days are untouched by her flag')

    // clearing it puts the day back
    await put({ date: day, item: 'haid', level: null })
    const cleared = (await json('/api/stats')).byUser[TITIS]
    assert.equal(cleared.last30.possible, 150, 'the day is owed again')
    assert.equal(cleared.last30.ontime, before.last30.ontime, 'and the kept marks come back')
  }

  // ---- logout -------------------------------------------------------------
  assert.equal((await call('/api/logout', { method: 'POST' })).status, 204)
  cookie = ''
  assert.equal((await call('/api/me')).status, 401, 'signed out again')

  console.log('ok')
} catch (err) {
  // without this the finally below exits 0 before the throw is ever reported,
  // so a failing test looks exactly like a passing one
  console.error('\nFAILED:', err.message)
  if (err.expected !== undefined) console.error('  expected:', err.expected, '\n  actual:  ', err.actual)
  process.exitCode = 1
} finally {
  stub.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true })
  process.exit(process.exitCode ?? 0)
}
