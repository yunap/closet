// Spec 32 — contract tests for the profile + constitution settings routes: defaults on a
// fresh instance, history append on every write, and live prompt refresh without restart.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-profile-routes-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const { app } = await import('../server.js')
const runtime = await import('../styling-engine/promptRuntime.js')
const { DEFAULT_CONSTITUTION, DEFAULT_PROFILE } = await import('../styling-engine/prompts.js')

const server = app.listen(0)
await once(server, 'listening')
const baseUrl = `http://127.0.0.1:${server.address().port}`

after(async () => {
  await new Promise(resolve => server.close(resolve))
})

const getJson = async (route) => (await fetch(`${baseUrl}${route}`)).json()
const putJson = async (route, body) => {
  const res = await fetch(`${baseUrl}${route}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: res.status, body: await res.json() }
}

test('fresh instance needs onboarding until completed; profile PUT alone also satisfies it', async () => {
  const before = await getJson('/api/settings/onboarding-status')
  assert.equal(before.needsOnboarding, true)
  const res = await fetch(`${baseUrl}/api/settings/onboarding-complete`, { method: 'POST' })
  assert.equal(res.status, 200)
  const afterComplete = await getJson('/api/settings/onboarding-status')
  assert.equal(afterComplete.needsOnboarding, false)
})

test('fresh instance serves the generic profile and default constitution layers', async () => {
  const profile = await getJson('/api/settings/profile')
  assert.equal(profile.displayName, DEFAULT_PROFILE.displayName)
  assert.equal(profile.pronouns.subject, 'they')

  const constitution = await getJson('/api/settings/constitution')
  const body = Object.fromEntries(constitution.layers.map(l => [l.layer, l]))
  assert.equal(body.body_contract.body, DEFAULT_CONSTITUTION.body_contract)
  assert.equal(body.body_contract.isDefault, true)
  assert.ok(runtime.STYLIST_SYSTEM.includes("the user's personal stylist"))
})

test('profile PUT updates the live prompt bindings without restart', async () => {
  const { status } = await putJson('/api/settings/profile', {
    displayName: 'Maya',
    pronouns: { subject: 'she', object: 'her', possessive: 'her', plural: false }
  })
  assert.equal(status, 200)
  assert.equal(runtime.PROFILE_NAME, 'Maya')
  assert.ok(runtime.STYLIST_SYSTEM.includes("Maya's personal stylist"))
  assert.ok(runtime.STYLIST_SYSTEM.includes('You know her wardrobe'))
})

test('constitution PUT persists, appends history, and re-assembles prompts', async () => {
  const newLayer = 'Layer 1 — Body & Comfort Contract (hard rules):\n- Custom test rule: no test garments.'
  const first = await putJson('/api/settings/constitution/body_contract', { body: newLayer })
  assert.equal(first.status, 200)
  assert.ok(runtime.STYLIST_SYSTEM.includes('Custom test rule: no test garments'))

  const second = await putJson('/api/settings/constitution/body_contract', { body: newLayer + '\n- Second rule.', source: 'interview' })
  assert.equal(second.status, 200)

  const history = await getJson('/api/settings/constitution/body_contract/history')
  assert.equal(history.history.length, 2)
  assert.equal(history.history[0].source, 'interview')
  assert.equal(history.history[0].prior_body, newLayer)
  assert.equal(history.history[1].prior_body, null)

  const constitution = await getJson('/api/settings/constitution')
  const layer = constitution.layers.find(l => l.layer === 'body_contract')
  assert.equal(layer.isDefault, false)
  assert.ok(layer.body.includes('Second rule.'))
})

test('constitution PUT rejects unknown layers and empty bodies', async () => {
  const bad = await putJson('/api/settings/constitution/not_a_layer', { body: 'x' })
  assert.equal(bad.status, 400)
  const empty = await putJson('/api/settings/constitution/working_style', { body: '   ' })
  assert.equal(empty.status, 400)
})

test('demo wardrobe: fresh instances start empty; demo is opt-in, refuses double-load, removable', async () => {
  const { db } = await import('../db.js')
  const before = db.prepare('SELECT COUNT(*) AS n FROM pieces WHERE is_demo = 1').get().n
  assert.equal(before, 0, 'fresh instance has no demo pieces (empty-wardrobe ruling)')

  const status = await getJson('/api/settings/demo-wardrobe')
  assert.equal(status.count, 0)
  assert.ok(status.available >= 60, 'demo set advertised')

  const load = await fetch(`${baseUrl}/api/settings/demo-wardrobe`, { method: 'POST' })
  assert.equal(load.status, 200)
  assert.equal((await load.json()).loaded, status.available)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pieces WHERE is_demo = 1').get().n, status.available)

  const doubleLoad = await fetch(`${baseUrl}/api/settings/demo-wardrobe`, { method: 'POST' })
  assert.equal(doubleLoad.status, 400, 'refuses to load twice')

  // Removal targets exactly the demo rows; user-created pieces survive.
  const userPiece = db.prepare("INSERT INTO pieces (name, category) VALUES ('my real top', 'top')").run().lastInsertRowid
  const remove = await fetch(`${baseUrl}/api/settings/demo-wardrobe`, { method: 'DELETE' })
  assert.equal((await remove.json()).removed, status.available)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pieces WHERE is_demo = 1').get().n, 0)
  assert.ok(db.prepare('SELECT id FROM pieces WHERE id = ?').get(userPiece), 'user piece untouched')
})
