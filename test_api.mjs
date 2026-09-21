// Smoke check for the task API. Run: node test_api.mjs
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dbPath = join(tmpdir(), `checklist-test-${Date.now()}.db`)
process.env.DB_PATH = dbPath
process.env.PORT = '3399'
delete process.env.TURSO_DATABASE_URL

const { default: app } = await import('./server.js')
const base = 'http://localhost:3399'
const api = (path, opts) =>
  fetch(base + path, { headers: { 'Content-Type': 'application/json' }, ...opts })

try {
  const week = '2026-09-21'

  assert.equal((await api(`/api/tasks?week=nope`)).status, 400, 'rejects a malformed week')
  assert.deepEqual(await (await api(`/api/tasks?week=${week}`)).json(), [], 'starts empty')

  const made = await (
    await api('/api/tasks', { method: 'POST', body: JSON.stringify({ week, day: 0, text: '  ship it  ' }) })
  ).json()
  assert.equal(made.text, 'ship it', 'trims the text')
  assert.equal(made.done, 0)
  assert.ok(Number.isInteger(made.id), `id is a real number, got ${typeof made.id}`)

  assert.equal(
    (await api('/api/tasks', { method: 'POST', body: JSON.stringify({ week, day: 9, text: 'x' }) })).status,
    400,
    'rejects a day outside 0..6'
  )

  const toggled = await (
    await api(`/api/tasks/${made.id}`, { method: 'PATCH', body: JSON.stringify({ done: true }) })
  ).json()
  assert.equal(toggled.done, 1, 'marks done')
  assert.equal(toggled.text, 'ship it', 'keeps the text when only done is sent')

  assert.equal((await api('/api/tasks/99999', { method: 'PATCH', body: '{}' })).status, 404)

  assert.equal((await api(`/api/tasks?week=${week}`)).status, 200)
  assert.equal((await (await api(`/api/tasks?week=${week}`)).json()).length, 1, 'lists the week')
  assert.equal((await (await api('/api/tasks?week=2026-09-28')).json()).length, 0, 'other weeks stay empty')

  assert.equal((await api(`/api/tasks/${made.id}`, { method: 'DELETE' })).status, 204)
  assert.equal((await (await api(`/api/tasks?week=${week}`)).json()).length, 0, 'deletes')

  console.log('ok')
} finally {
  rmSync(dbPath, { force: true })
  rmSync(dbPath + '-wal', { force: true })
  rmSync(dbPath + '-shm', { force: true })
  process.exit(process.exitCode ?? 0)
}
