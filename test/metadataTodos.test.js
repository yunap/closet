import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-todo-tests-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')

const { app, db } = await import('../server.js')

const server = app.listen(0, '127.0.0.1')
await once(server, 'listening')
const baseUrl = `http://127.0.0.1:${server.address().port}`

after(async () => {
  if (server) {
    await new Promise(resolve => server.close(resolve))
  }
  db.close()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

test('Metadata Todos End-to-End API contracts', async () => {
  // 1. Setup active and inactive/archived pieces
  const fdActive = new FormData()
  fdActive.append('name', 'Active Linen Shirt')
  fdActive.append('category', 'top')
  fdActive.append('status', 'active')
  const resActive = await fetch(`${baseUrl}/api/pieces`, { method: 'POST', body: fdActive })
  const activePiece = await resActive.json()
  assert.equal(activePiece.status, 'active')

  const fdInactive = new FormData()
  fdInactive.append('name', 'Old Silk Blouse')
  fdInactive.append('category', 'top')
  fdInactive.append('status', 'archived')
  const resInactive = await fetch(`${baseUrl}/api/pieces`, { method: 'POST', body: fdInactive })
  const inactivePiece = await resInactive.json()
  assert.equal(inactivePiece.status, 'archived')

  const fdToDelete = new FormData()
  fdToDelete.append('name', 'To Be Deleted Piece')
  fdToDelete.append('category', 'top')
  fdToDelete.append('status', 'active')
  const resToDelete = await fetch(`${baseUrl}/api/pieces`, { method: 'POST', body: fdToDelete })
  const toDeletePiece = await resToDelete.json()

  // 2. Create metadata todos
  // Todo 1: Valid active piece linkage, field = 'formality'
  const resT1 = await fetch(`${baseUrl}/api/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'metadata',
      description: 'Active Linen Shirt: missing formality',
      linked_piece_id: activePiece.id,
      field: 'formality'
    })
  })
  const t1 = await resT1.json()
  assert.equal(t1.type, 'metadata')
  assert.equal(t1.field, 'formality')
  assert.equal(t1.piece.id, activePiece.id)
  assert.equal(t1.piece.status, 'active')

  // Todo 2: Valid active piece linkage, field = 'fabric_weight'
  const resT2 = await fetch(`${baseUrl}/api/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'metadata',
      description: 'Active Linen Shirt: missing fabric_weight',
      linked_piece_id: activePiece.id,
      field: 'fabric_weight'
    })
  })
  const t2 = await resT2.json()
  assert.equal(t2.field, 'fabric_weight')

  // Todo 3: Orphaned/Inactive piece linkage, field = 'formality'
  const resT3 = await fetch(`${baseUrl}/api/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'metadata',
      description: 'Old Silk Blouse: missing formality',
      linked_piece_id: inactivePiece.id,
      field: 'formality'
    })
  })
  const t3 = await resT3.json()
  assert.equal(t3.piece.status, 'archived')

  // Todo 4: Orphaned deleted piece linkage, field = 'formality'
  // Create first with valid piece, then delete the piece
  const resT4 = await fetch(`${baseUrl}/api/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'metadata',
      description: 'Deleted Piece: missing formality',
      linked_piece_id: toDeletePiece.id,
      field: 'formality'
    })
  })
  const t4 = await resT4.json()
  assert.equal(t4.piece.id, toDeletePiece.id)

  // Delete the piece now
  const resDelPiece = await fetch(`${baseUrl}/api/pieces/${toDeletePiece.id}`, { method: 'DELETE' })
  assert.equal(resDelPiece.status, 200)

  // 3. GET /api/todos list verification
  const resList = await fetch(`${baseUrl}/api/todos`)
  const list = await resList.json()
  
  // Verify all exist in response list
  const ids = list.map(t => t.id)
  assert.ok(ids.includes(t1.id))
  assert.ok(ids.includes(t2.id))
  assert.ok(ids.includes(t3.id))
  assert.ok(ids.includes(t4.id))

  // Verify structure of active linkage
  const listT1 = list.find(t => t.id === t1.id)
  assert.equal(listT1.field, 'formality')
  assert.deepEqual(listT1.piece, {
    id: activePiece.id,
    name: 'Active Linen Shirt',
    photo: null,
    status: 'active'
  })

  // Verify structure of deleted linkage (t4 piece should be null because of ON DELETE SET NULL)
  const listT4 = list.find(t => t.id === t4.id)
  assert.equal(listT4.linked_piece_id, null)
  assert.equal(listT4.piece, null)

  // 4. POST /api/todos/clear-orphaned verification
  const resClear = await fetch(`${baseUrl}/api/todos/clear-orphaned`, { method: 'POST' })
  assert.equal(resClear.status, 200)
  const clearResult = await resClear.json()
  assert.equal(clearResult.success, true)
  assert.equal(clearResult.deletedCount, 2) // t3 (inactive) and t4 (deleted/null) should be cleared

  // Refetch list and verify t1 and t2 remain, t3 and t4 are gone
  const resListPostClear = await fetch(`${baseUrl}/api/todos`)
  const listPostClear = await resListPostClear.json()
  const idsPostClear = listPostClear.map(t => t.id)
  
  assert.ok(idsPostClear.includes(t1.id))
  assert.ok(idsPostClear.includes(t2.id))
  assert.ok(!idsPostClear.includes(t3.id))
  assert.ok(!idsPostClear.includes(t4.id))
})
