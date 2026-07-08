import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'saved-boards-visibility-tests-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')

const { app, db } = await import('../server.js')
const { getSavedBoardMemory } = await import('../styling-engine/rules.js')

const server = app.listen(0)
await once(server, 'listening')
const baseUrl = `http://127.0.0.1:${server.address().port}`

after(async () => {
  if (server) {
    await new Promise(resolve => server.close(resolve))
  }
  db.close()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

test('database table saved_boards has hidden_from_lookbook column', () => {
  const info = db.prepare('PRAGMA table_info(saved_boards)').all()
  const hasCol = info.some(col => col.name === 'hidden_from_lookbook')
  assert.ok(hasCol, 'saved_boards should have hidden_from_lookbook column')
})

test('POST /api/saved-boards defaults hidden_from_lookbook to false', async () => {
  const res = await fetch(`${baseUrl}/api/saved-boards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageUrl: 'test_url.jpg',
      title: 'Default Visibility Board'
    })
  })
  assert.equal(res.status, 200)
  const board = await res.json()
  assert.equal(board.hidden_from_lookbook, false)
})

test('PATCH /api/saved-boards/:id allows independent toggling of hidden_from_lookbook, favorite, and archived', async () => {
  // Create a board
  const res = await fetch(`${baseUrl}/api/saved-boards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageUrl: 'test_combo.jpg',
      title: 'Combo Test Board'
    })
  })
  const board = await res.json()
  const id = board.id

  const testStates = [
    { hidden_from_lookbook: true, favorite: true, archived: false },
    { hidden_from_lookbook: true, favorite: false, archived: true },
    { hidden_from_lookbook: false, favorite: false, archived: true },
    { hidden_from_lookbook: false, favorite: true, archived: false }
  ]

  for (const state of testStates) {
    const patchRes = await fetch(`${baseUrl}/api/saved-boards/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    })
    assert.equal(patchRes.status, 200)
    const updated = await patchRes.json()
    assert.equal(updated.hidden_from_lookbook, state.hidden_from_lookbook)
    assert.equal(updated.favorite, state.favorite)
    assert.equal(updated.archived, state.archived)
  }
})

test('GET /api/saved-boards with excludeHidden=true filters out hidden boards, while default GET returns them', async () => {
  // Create board 1: visible
  const res1 = await fetch(`${baseUrl}/api/saved-boards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageUrl: 'visible.jpg',
      title: 'Visible Board',
      hidden_from_lookbook: false
    })
  })
  const visibleBoard = await res1.json()

  // Create board 2: hidden
  const res2 = await fetch(`${baseUrl}/api/saved-boards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageUrl: 'hidden.jpg',
      title: 'Hidden Board',
      hidden_from_lookbook: true
    })
  })
  const hiddenBoard = await res2.json()

  // 1. Fetch with excludeHidden=true (Lookbook query)
  const lookbookRes = await fetch(`${baseUrl}/api/saved-boards?excludeHidden=true`)
  const lookbookBoards = await lookbookRes.json()
  const hasVisibleInLookbook = lookbookBoards.some(b => b.id === visibleBoard.id)
  const hasHiddenInLookbook = lookbookBoards.some(b => b.id === hiddenBoard.id)
  assert.ok(hasVisibleInLookbook, 'Lookbook should include visible boards')
  assert.ok(!hasHiddenInLookbook, 'Lookbook should exclude hidden boards')

  // 2. Fetch standard (Visual Lab query)
  const visualLabRes = await fetch(`${baseUrl}/api/saved-boards`)
  const visualLabBoards = await visualLabRes.json()
  const hasVisibleInVisual = visualLabBoards.some(b => b.id === visibleBoard.id)
  const hasHiddenInVisual = visualLabBoards.some(b => b.id === hiddenBoard.id)
  assert.ok(hasVisibleInVisual, 'Visual Lab should include visible boards')
  assert.ok(hasHiddenInVisual, 'Visual Lab should include hidden boards')
})

test('DELETE /api/saved-boards/:id performs a true deletion of the row', async () => {
  // Create a board
  const res = await fetch(`${baseUrl}/api/saved-boards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageUrl: 'todelete.jpg',
      title: 'To Be Deleted'
    })
  })
  const board = await res.json()
  const id = board.id

  // Verify it exists in db
  const checkBefore = db.prepare('SELECT * FROM saved_boards WHERE id = ?').get(id)
  assert.ok(checkBefore)

  // Call DELETE
  const delRes = await fetch(`${baseUrl}/api/saved-boards/${id}`, {
    method: 'DELETE'
  })
  assert.equal(delRes.status, 200)

  // Verify it is completely gone from db (not archived, but deleted)
  const checkAfter = db.prepare('SELECT * FROM saved_boards WHERE id = ?').get(id)
  assert.equal(checkAfter, undefined)
})

test('Hidden but favorite board continues to inform calibration/memory', async () => {
  // Create a hidden, favorite board
  db.prepare(`
    INSERT INTO saved_boards (title, image_url, favorite, hidden_from_lookbook, reason)
    VALUES (?, ?, ?, ?, ?)
  `).run('Calibration Board', 'calib.jpg', 1, 1, 'Specific calibration details')

  const memory = getSavedBoardMemory()
  assert.ok(memory.includes('Calibration Board'), 'Calibration/memory should still include hidden boards')
  assert.ok(memory.includes('Specific calibration details'))
})

test('Lookbook board removal (PATCH hidden_from_lookbook = true) hides it from Lookbook query but retains it in Visual Lab', async () => {
  // Create a board
  const res = await fetch(`${baseUrl}/api/saved-boards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageUrl: 'lookbook_hide.jpg',
      title: 'Lookbook Hide Test'
    })
  })
  const board = await res.json()
  const id = board.id

  // Simulate Lookbook's handleBoardDelete (PATCH)
  const removeRes = await fetch(`${baseUrl}/api/saved-boards/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hidden_from_lookbook: true })
  })
  assert.equal(removeRes.status, 200)

  // Verify hidden from Lookbook query
  const lookbookRes = await fetch(`${baseUrl}/api/saved-boards?excludeHidden=true`)
  const lookbookBoards = await lookbookRes.json()
  assert.ok(!lookbookBoards.some(b => b.id === id), 'Should be hidden from Lookbook')

  // Verify visible in Visual Lab query
  const visualLabRes = await fetch(`${baseUrl}/api/saved-boards`)
  const visualLabBoards = await visualLabRes.json()
  assert.ok(visualLabBoards.some(b => b.id === id), 'Should remain in Visual Lab')
})

test('POST /api/saved-boards stores threadId in payload and returns it in responses', async () => {
  const res = await fetch(`${baseUrl}/api/saved-boards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageUrl: 'with_thread.jpg',
      title: 'Threaded Board',
      payload: { threadId: 'thread_xyz123' }
    })
  })
  assert.equal(res.status, 200)
  const board = await res.json()
  assert.equal(board.payload.threadId, 'thread_xyz123')

  // Get and check
  const getRes = await fetch(`${baseUrl}/api/saved-boards`)
  const boards = await getRes.json()
  const matched = boards.find(b => b.id === board.id)
  assert.ok(matched)
  assert.equal(matched.payload.threadId, 'thread_xyz123')
})


