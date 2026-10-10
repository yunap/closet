import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-usage-stats-tests-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')

const { app, db } = await import('../server.js')

const server = app.listen(0, '127.0.0.1')
await once(server, 'listening')
const baseUrl = `http://127.0.0.1:${server.address().port}`

after(async () => {
  await new Promise(resolve => server.close(resolve))
  db.close()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

const saveThread = (id, outfits, extra = {}) => fetch(`${baseUrl}/api/chat-threads`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id, title: id, payload: { messages: [{ role: 'assistant', structuredOutfits: outfits }] }, ...extra })
})
const usageStats = async () => {
  const res = await fetch(`${baseUrl}/api/pieces/usage-stats`)
  assert.equal(res.status, 200)
  return res.json()
}
const storedPieceIds = id => db.prepare('SELECT piece_ids FROM chat_threads WHERE id = ?').get(id).piece_ids

// The Wardrobe grid waits on this endpoint. It used to parse every thread's whole payload on each
// call; it now reads a per-thread list of piece ids that is rebuilt only when a payload changes.
test('usage stats count each thread once per piece, from pieceIds and from pieces', async () => {
  await saveThread('usage_a', [{ pieceIds: [101, 102] }, { pieces: [{ id: 102 }, { id: 103 }] }])
  await saveThread('usage_b', [{ pieceIds: [101] }])

  const stats = await usageStats()
  assert.equal(stats[101].count, 2)
  assert.equal(stats[102].count, 1, 'a piece in two looks of one thread counts once for that thread')
  assert.equal(stats[103].count, 1)
  assert.ok(stats[101].lastUsedAt)
  assert.deepEqual(JSON.parse(storedPieceIds('usage_a')), [101, 102, 103])
})

test('usage stats follow a thread whose looks change after it was indexed', async () => {
  await saveThread('usage_c', [{ pieceIds: [201] }])
  assert.equal((await usageStats())[201].count, 1)

  await saveThread('usage_c', [{ pieceIds: [202] }])
  const stats = await usageStats()
  assert.equal(stats[201], undefined, 'a piece dropped from the thread no longer counts')
  assert.equal(stats[202].count, 1)
})

test('usage stats follow a payload rewritten outside the save endpoint', async () => {
  await saveThread('usage_d', [{ pieceIds: [301] }])
  await usageStats()
  db.prepare('UPDATE chat_threads SET payload = ? WHERE id = ?')
    .run(JSON.stringify({ messages: [{ structuredOutfits: [{ pieceIds: [302] }] }] }), 'usage_d')
  const stats = await usageStats()
  assert.equal(stats[301], undefined)
  assert.equal(stats[302].count, 1)
})

test('usage stats leave out archived threads and keep the index across pin changes', async () => {
  await saveThread('usage_e', [{ pieceIds: [401] }])
  assert.equal((await usageStats())[401].count, 1)

  await fetch(`${baseUrl}/api/chat-threads/usage_e/pin`, { method: 'PATCH' })
  assert.notEqual(storedPieceIds('usage_e'), null, 'pinning does not discard the index')

  await fetch(`${baseUrl}/api/chat-threads/usage_e/archive`, { method: 'PATCH' })
  assert.equal((await usageStats())[401], undefined)
})
