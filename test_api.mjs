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
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  OAUTH_TOKEN_ENDPOINT: 'http://127.0.0.1:3398/token',
  OAUTH_REDIRECT_URI: 'http://localhost:3399/api/auth/callback',
})
delete process.env.TURSO_DATABASE_URL

await import('./server.js')

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
  for (const path of ['/api/tasks?week=2026-09-21', '/api/stats', '/api/sholat?week=2026-09-21', '/api/me'])
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

  // ---- sholat -------------------------------------------------------------
  assert.deepEqual(await json(`/api/sholat?week=${week}`), [], 'every prayer starts unchecked')
  const put = (body) => call('/api/sholat', { method: 'PUT', body: JSON.stringify(body) })
  assert.equal((await put({ date: iso(), prayer: 'nope', ontime: true })).status, 400, 'rejects an unknown prayer')
  assert.equal((await put({ date: iso(3), prayer: 'subuh', ontime: true })).status, 400, 'rejects a future day')

  await put({ date: iso(), prayer: 'subuh', ontime: true })
  await put({ date: iso(), prayer: 'isya', ontime: true })
  await put({ date: iso(), prayer: 'subuh', ontime: true }) // twice must not double-count
  let marks = await json(`/api/sholat?week=${week}`)
  assert.equal(marks.length, 2, 'two marks, no duplicate')
  assert.ok(marks.every((m) => m.email === SINGGIH), 'marks belong to the signed-in user')

  await put({ date: iso(), prayer: 'isya', ontime: false })
  assert.equal((await json(`/api/sholat?week=${week}`)).length, 1, 'unchecking removes the mark')

  // ---- stats --------------------------------------------------------------
  const stats = await json('/api/stats')
  assert.deepEqual(Object.keys(stats.byUser).sort(), [SINGGIH, TITIS].sort(), 'both users appear')
  const mine = stats.byUser[SINGGIH]
  assert.equal(mine.last30.ontime, 1)
  assert.equal(mine.last30.possible, 150, '30 days x 5 prayers')
  assert.equal(mine.byPrayer.find((p) => p.prayer === 'subuh').ontime, 1)
  assert.equal(mine.weekly.length, 8, 'eight weeks of trend')
  assert.equal(mine.streak, 0, 'one prayer today is not a complete day')
  assert.ok(mine.weekly[7].possible <= 35, 'the current week counts only the days so far')

  // ---- the second account is isolated ------------------------------------
  cookie = (await signIn({ claims: { email: TITIS } })).session
  assert.ok(cookie, 'the other invited account is let in too')
  assert.equal((await json('/api/me')).name, 'Titis')
  assert.equal((await json(`/api/sholat?week=${week}`)).length, 1, "sees the other person's mark")
  await put({ date: iso(), prayer: 'ashar', ontime: true })
  const after = await json('/api/stats')
  assert.equal(after.byUser[TITIS].last30.ontime, 1, 'writes land on the signed-in user')
  assert.equal(after.byUser[SINGGIH].last30.ontime, 1, "and not on the other's")

  // ---- logout -------------------------------------------------------------
  assert.equal((await call('/api/logout', { method: 'POST' })).status, 204)
  cookie = ''
  assert.equal((await call('/api/me')).status, 401, 'signed out again')

  console.log('ok')
} finally {
  stub.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true })
  process.exit(process.exitCode ?? 0)
}
