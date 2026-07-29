import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-crud-tests-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')

const { app, db } = await import('../server.js')

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

test('POST /api/pieces creates a piece and GET/PUT/PATCH/DELETE verify it', async () => {
  const fd = new FormData()
  fd.append('name', 'test top')
  fd.append('category', 'top')
  fd.append('colors', JSON.stringify(['black']))
  fd.append('tagger_version', 'v1.0.0')
  fd.append('formality', 'everyday')
  
  const res = await fetch(`${baseUrl}/api/pieces`, {
    method: 'POST',
    body: fd
  })
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.name, 'test top')
  assert.equal(data.category, 'top')
  assert.equal(data.tagger_version, 'v1.0.0')
  assert.equal(data.formality, 'everyday')
  assert.ok(data.id)
  
  // GET /api/pieces lists pieces
  const listRes = await fetch(`${baseUrl}/api/pieces`)
  const listData = await listRes.json()
  assert.ok(listData.length >= 1)
  
  // GET /api/pieces/:id gets a specific piece
  const getRes = await fetch(`${baseUrl}/api/pieces/${data.id}`)
  const getData = await getRes.json()
  assert.equal(getData.name, 'test top')
  assert.equal(getData.tagger_version, 'v1.0.0')
  
  // PUT /api/pieces/:id updates a piece
  const fd2 = new FormData()
  fd2.append('name', 'updated top')
  fd2.append('category', 'top')
  fd2.append('tagger_version', 'v1.1.0')
  fd2.append('formality', 'elevated')
  fd2.append('heel_height', 'flat')
  fd2.append('walk_support', 'high')
  const putRes = await fetch(`${baseUrl}/api/pieces/${data.id}`, {
    method: 'PUT',
    body: fd2
  })
  const putData = await putRes.json()
  assert.equal(putData.name, 'updated top')
  assert.equal(putData.tagger_version, 'v1.1.0')
  assert.equal(putData.formality, 'elevated')
  assert.equal(putData.heel_height, 'flat')
  assert.equal(putData.walk_support, 'high')
  
  // PATCH /api/pieces/:id/favorite favorites a piece
  const favRes = await fetch(`${baseUrl}/api/pieces/${data.id}/favorite`, {
    method: 'PATCH'
  })
  const favData = await favRes.json()
  assert.equal(favData.favorite, true)
  
  // DELETE /api/pieces/:id deletes a piece
  const delRes = await fetch(`${baseUrl}/api/pieces/${data.id}`, {
    method: 'DELETE'
  })
  assert.equal(delRes.status, 200)
  const getRes2 = await fetch(`${baseUrl}/api/pieces/${data.id}`)
  assert.equal(getRes2.status, 404)
})

test('POST /api/outfits and GET /api/outfits', async () => {
  const fdPiece = new FormData()
  fdPiece.append('name', 'pants')
  fdPiece.append('category', 'bottom')
  const resPiece = await fetch(`${baseUrl}/api/pieces`, { method: 'POST', body: fdPiece })
  const piece = await resPiece.json()

  const fdPiece2 = new FormData()
  fdPiece2.append('name', 'indoor blouse')
  fdPiece2.append('category', 'top')
  const resPiece2 = await fetch(`${baseUrl}/api/pieces`, { method: 'POST', body: fdPiece2 })
  const piece2 = await resPiece2.json()

  const fdOutfit = new FormData()
  fdOutfit.append('name', 'test outfit')
  fdOutfit.append('occasion', 'casual')
  fdOutfit.append('pieceIds', JSON.stringify([piece.id]))
  fdOutfit.append('mainPieceId', String(piece.id))
  const resOutfit = await fetch(`${baseUrl}/api/outfits`, { method: 'POST', body: fdOutfit })
  const outfit = await resOutfit.json()
  assert.equal(outfit.name, 'test outfit')
  assert.ok(outfit.id)
  assert.equal(outfit.main_piece_id, piece.id)

  const getOutfits = await fetch(`${baseUrl}/api/outfits`)
  const outfits = await getOutfits.json()
  assert.ok(outfits.length >= 1)
  const match = outfits.find(o => o.id === outfit.id)
  assert.ok(match)
  assert.equal(match.pieces[0].id, piece.id)

  const fdUpdate = new FormData()
  fdUpdate.append('name', 'edited indoor outfit')
  fdUpdate.append('occasion', 'evening')
  fdUpdate.append('season', 'indoor')
  fdUpdate.append('notes', 'weather does not apply')
  fdUpdate.append('status', 'confirmed')
  fdUpdate.append('favorite', 'false')
  fdUpdate.append('pieceIds', JSON.stringify([piece2.id]))
  fdUpdate.append('mainPieceId', String(piece2.id))
  const putRes = await fetch(`${baseUrl}/api/outfits/${outfit.id}`, { method: 'PUT', body: fdUpdate })
  assert.equal(putRes.status, 200)
  const updated = await putRes.json()
  assert.equal(updated.name, 'edited indoor outfit')
  assert.equal(updated.occasion, 'evening')
  assert.equal(updated.season, 'indoor')
  assert.equal(updated.notes, 'weather does not apply')
  assert.equal(updated.main_piece_id, piece2.id)
  assert.deepEqual(updated.pieces.map(p => p.id), [piece2.id])

  const indoorFilterRes = await fetch(`${baseUrl}/api/outfits?season=indoor`)
  const indoorFiltered = await indoorFilterRes.json()
  assert.ok(indoorFiltered.some(o => o.id === outfit.id))

  const warmFilterRes = await fetch(`${baseUrl}/api/outfits?season=warm`)
  const warmFiltered = await warmFilterRes.json()
  assert.ok(warmFiltered.some(o => o.id === outfit.id), 'indoor outfits should appear under warm browsing')
})

test('POST, GET, PUT, DELETE todos', async () => {
  const res = await fetch(`${baseUrl}/api/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'todo', description: 'buy buttons' })
  })
  const todo = await res.json()
  assert.equal(todo.description, 'buy buttons')
  assert.ok(todo.id)

  const getRes = await fetch(`${baseUrl}/api/todos`)
  const todos = await getRes.json()
  assert.ok(todos.length >= 1)

  const putRes = await fetch(`${baseUrl}/api/todos/${todo.id}/toggle`, {
    method: 'PATCH'
  })
  const putTodo = await putRes.json()
  assert.equal(putTodo.completed, true)

  const delRes = await fetch(`${baseUrl}/api/todos/${todo.id}`, { method: 'DELETE' })
  assert.equal(delRes.status, 200)
})

test('GET /api/pieces?season=warm filters correctly', async () => {
  const fdPieceWarm = new FormData()
  fdPieceWarm.append('name', 'summer top')
  fdPieceWarm.append('category', 'top')
  fdPieceWarm.append('season', 'warm')
  const resPieceWarm = await fetch(`${baseUrl}/api/pieces`, { method: 'POST', body: fdPieceWarm })
  const pieceWarm = await resPieceWarm.json()

  const fdPieceCool = new FormData()
  fdPieceCool.append('name', 'winter coat')
  fdPieceCool.append('category', 'outerwear')
  fdPieceCool.append('season', 'cool')
  const resPieceCool = await fetch(`${baseUrl}/api/pieces`, { method: 'POST', body: fdPieceCool })
  const pieceCool = await resPieceCool.json()

  const res = await fetch(`${baseUrl}/api/pieces?season=warm`)
  assert.equal(res.status, 200)
  const data = await res.json()
  
  const hasSummerTop = data.some(p => p.id === pieceWarm.id)
  const hasWinterCoat = data.some(p => p.id === pieceCool.id)
  assert.ok(hasSummerTop)
  assert.ok(!hasWinterCoat)

  await fetch(`${baseUrl}/api/pieces/${pieceWarm.id}`, { method: 'DELETE' })
  await fetch(`${baseUrl}/api/pieces/${pieceCool.id}`, { method: 'DELETE' })
})

test('GET /api/pieces/meta and color/fabric filtering', async () => {
  const fd1 = new FormData()
  fd1.append('name', 'special orange sweater')
  fd1.append('category', 'top')
  fd1.append('colors', JSON.stringify(['orange']))
  fd1.append('fabric_category', 'cashmere')
  const res1 = await fetch(`${baseUrl}/api/pieces`, { method: 'POST', body: fd1 })
  const piece1 = await res1.json()

  const fd2 = new FormData()
  fd2.append('name', 'emerald pants')
  fd2.append('category', 'bottom')
  fd2.append('colors', JSON.stringify(['emerald']))
  fd2.append('fabric_category', 'linen')
  const res2 = await fetch(`${baseUrl}/api/pieces`, { method: 'POST', body: fd2 })
  const piece2 = await res2.json()

  const metaRes = await fetch(`${baseUrl}/api/pieces/meta`)
  assert.equal(metaRes.status, 200)
  const meta = await metaRes.json()
  
  assert.ok(meta.colors.includes('orange'))
  assert.ok(meta.colors.includes('emerald'))
  assert.ok(meta.fabrics.includes('cashmere'))
  assert.ok(meta.fabrics.includes('linen'))

  const colorFilterRes = await fetch(`${baseUrl}/api/pieces?color=orange`)
  const colorFiltered = await colorFilterRes.json()
  assert.ok(colorFiltered.some(p => p.id === piece1.id))
  assert.ok(!colorFiltered.some(p => p.id === piece2.id))

  const fabricFilterRes = await fetch(`${baseUrl}/api/pieces?fabric=linen`)
  const fabricFiltered = await fabricFilterRes.json()
  assert.ok(!fabricFiltered.some(p => p.id === piece1.id))
  assert.ok(fabricFiltered.some(p => p.id === piece2.id))

  await fetch(`${baseUrl}/api/pieces/${piece1.id}`, { method: 'DELETE' })
  await fetch(`${baseUrl}/api/pieces/${piece2.id}`, { method: 'DELETE' })
})

test('CRUD operations for /api/chat-threads', async () => {
  const threadId = 'test_thread_' + Date.now()
  const pieceId = db.prepare(`
    INSERT INTO pieces (name, category, colors, status, photo)
    VALUES (?, ?, ?, ?, ?)
  `).run('chat subject blouse', 'top', '[]', 'active', 'chat-subject.jpg').lastInsertRowid
  const payload = {
    messages: [
      { role: 'assistant', text: 'Hi' },
      { role: 'user', text: 'Hello' }
    ],
    activeContext: { type: 'piece', id: pieceId, name: 'chat subject blouse' },
    threadMemory: {
      source: 'whole_wardrobe',
      stylingContext: {
        occasion: 'smart-casual',
        activity: 'walking',
        season: 'warm',
        mood: 'relaxed',
        request: 'city outfits',
        unusedLargeField: 'do not return this'
      },
      latestOutfits: [{
        title: 'City Walk',
        label: 'Everyday City',
        bestFor: 'walking',
        previewOnly: true,
        pieces: [{ id: 1, embeddedPayload: 'do not return this' }]
      }],
      unusedLargeField: 'do not return this'
    }
  }

  // Create/Upsert Thread
  const upsertRes = await fetch(`${baseUrl}/api/chat-threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: threadId,
      title: 'Test Thread',
      user_renamed: 0,
      kind: 'chat',
      payload
    })
  })
  assert.equal(upsertRes.status, 200)
  const upserted = await upsertRes.json()
  assert.equal(upserted.id, threadId)
  assert.equal(upserted.title, 'Test Thread')

  // List Threads
  const listRes = await fetch(`${baseUrl}/api/chat-threads`)
  assert.equal(listRes.status, 200)
  const list = await listRes.json()
  const found = list.find(t => t.id === threadId)
  assert.ok(found)
  assert.equal(found.title, 'Test Thread')
  assert.equal(found.message_count, 2)
  assert.equal(found.subjectType, 'piece')
  assert.equal(found.subjectPhoto, '/uploads/.thumbnails/subject/chat-subject.jpg.webp')
  assert.deepEqual(found.threadMemory, {
    source: 'whole_wardrobe',
    stylingContext: {
      occasion: 'smart-casual',
      activity: 'walking',
      season: 'warm',
      mood: 'relaxed',
      request: 'city outfits'
    },
    latestOutfits: [{
      title: 'City Walk',
      label: 'Everyday City',
      bestFor: 'walking',
      previewOnly: true
    }]
  })
  assert.ok(!JSON.stringify(found).includes('do not return this'))

  // Get Single Thread Detail
  const getRes = await fetch(`${baseUrl}/api/chat-threads/${threadId}`)
  assert.equal(getRes.status, 200)
  const detail = await getRes.json()
  assert.equal(detail.id, threadId)
  assert.deepEqual(detail.payload, payload)

  // Delete Thread
  const deleteRes = await fetch(`${baseUrl}/api/chat-threads/${threadId}`, {
    method: 'DELETE'
  })
  assert.equal(deleteRes.status, 200)

  // Verify Deleted
  const getRes2 = await fetch(`${baseUrl}/api/chat-threads/${threadId}`)
  assert.equal(getRes2.status, 404)
})

test('Pinning, archiving, unpinning, unarchiving, and metadata checks for /api/chat-threads', async () => {
  const threadId = 'test_thread_meta_' + Date.now()
  const payload = {
    messages: [
      { role: 'assistant', text: 'Hi' }
    ],
    activeContext: {
      type: 'outfit',
      id: 999,
      name: 'Rioja outfit'
    }
  }

  // Create
  const upsertRes = await fetch(`${baseUrl}/api/chat-threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: threadId,
      title: 'Meta Thread',
      user_renamed: 0,
      kind: 'chat',
      payload
    })
  })
  assert.equal(upsertRes.status, 200)

  // Verify initial states
  const listRes = await fetch(`${baseUrl}/api/chat-threads`)
  const list = await listRes.json()
  const found = list.find(t => t.id === threadId)
  assert.ok(found)
  assert.equal(found.pinned, false)
  assert.equal(found.archived, false)
  assert.deepEqual(found.activeContext, { type: 'outfit', id: 999, name: 'Rioja outfit' })
  assert.ok(!found.payload, 'Returned metadata should not contain the full payload')

  // Pin it
  const pinRes1 = await fetch(`${baseUrl}/api/chat-threads/${threadId}/pin`, {
    method: 'PATCH'
  })
  assert.equal(pinRes1.status, 200)
  const pinData1 = await pinRes1.json()
  assert.equal(pinData1.pinned, true)

  // Verify pinned in list
  const listRes2 = await fetch(`${baseUrl}/api/chat-threads`)
  const list2 = await listRes2.json()
  const found2 = list2.find(t => t.id === threadId)
  assert.equal(found2.pinned, true)

  // Archive it (should also clear pin)
  const arcRes = await fetch(`${baseUrl}/api/chat-threads/${threadId}/archive`, {
    method: 'PATCH'
  })
  assert.equal(arcRes.status, 200)
  const arcData = await arcRes.json()
  assert.equal(arcData.archived, true)
  assert.equal(arcData.pinned, false) // should clear pin!

  // Verify excluded from default list
  const listRes3 = await fetch(`${baseUrl}/api/chat-threads`)
  const list3 = await listRes3.json()
  const found3 = list3.find(t => t.id === threadId)
  assert.ok(!found3, 'Archived thread should be excluded from default list')

  // Verify included in archived list
  const listResArc = await fetch(`${baseUrl}/api/chat-threads?archived=true`)
  const listArc = await listResArc.json()
  const foundArc = listArc.find(t => t.id === threadId)
  assert.ok(foundArc)
  assert.equal(foundArc.archived, true)
  assert.equal(foundArc.pinned, false)

  // Unarchive it
  const unarcRes = await fetch(`${baseUrl}/api/chat-threads/${threadId}/archive`, {
    method: 'PATCH'
  })
  assert.equal(unarcRes.status, 200)
  const unarcData = await unarcRes.json()
  assert.equal(unarcData.archived, false)

  // Verify returned to default list
  const listRes4 = await fetch(`${baseUrl}/api/chat-threads`)
  const list4 = await listRes4.json()
  const found4 = list4.find(t => t.id === threadId)
  assert.ok(found4)
  assert.equal(found4.archived, false)

  // Clean up
  await fetch(`${baseUrl}/api/chat-threads/${threadId}`, {
    method: 'DELETE'
  })
})

test('Payload fields round-trip survival test for /api/chat-threads', async () => {
  const threadId = 'test_thread_roundtrip_' + Date.now()
  const payload = {
    messages: [
      { role: 'assistant', text: 'Hi' }
    ],
    chatHistory: [{ query: 'foo', response: 'bar' }],
    threadMemory: { context: 'test' },
    activeContext: { type: 'outfit', id: 123, name: 'Rioja Vineyard' },
    evaluatedKeys: ['key1', 'key2'],
    boardResults: { '0': [{ id: 1 }] },
    editorialVisualResults: { '0': [{ id: 2 }] },
    evaluationResultsByKey: { 'key1': { score: 90 } },
    savedBoardKeys: ['board_123', 'board_456'],
    feedbackSaved: ['feed_1', 'feed_2'],
    savedIndices: [1, 2],
    feedbackIdsByKey: { 'feed_1': 999 },
    boardFeedbackLabels: { 'board_123': ['great'] }
  }

  // Create
  const upsertRes = await fetch(`${baseUrl}/api/chat-threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: threadId,
      title: 'Roundtrip Thread',
      user_renamed: 0,
      kind: 'chat',
      payload
    })
  })
  assert.equal(upsertRes.status, 200)

  // Get Detail
  const getRes = await fetch(`${baseUrl}/api/chat-threads/${threadId}`)
  assert.equal(getRes.status, 200)
  const detail = await getRes.json()
  
  assert.equal(detail.id, threadId)
  assert.deepEqual(detail.payload.messages, payload.messages)
  assert.deepEqual(detail.payload.chatHistory, payload.chatHistory)
  assert.deepEqual(detail.payload.threadMemory, payload.threadMemory)
  assert.deepEqual(detail.payload.activeContext, payload.activeContext)
  assert.deepEqual(detail.payload.evaluatedKeys, payload.evaluatedKeys)
  assert.deepEqual(detail.payload.boardResults, payload.boardResults)
  assert.deepEqual(detail.payload.editorialVisualResults, payload.editorialVisualResults)
  assert.deepEqual(detail.payload.evaluationResultsByKey, payload.evaluationResultsByKey)
  assert.deepEqual(detail.payload.savedBoardKeys, payload.savedBoardKeys)
  assert.deepEqual(detail.payload.feedbackSaved, payload.feedbackSaved)
  assert.deepEqual(detail.payload.savedIndices, payload.savedIndices)
  assert.deepEqual(detail.payload.feedbackIdsByKey, payload.feedbackIdsByKey)
  assert.deepEqual(detail.payload.boardFeedbackLabels, payload.boardFeedbackLabels)

  // Clean up
  await fetch(`${baseUrl}/api/chat-threads/${threadId}`, {
    method: 'DELETE'
  })
})

test('POST /api/ai/ask error boundary surfaces the real error message, not a suppressed generic one', async () => {
  // 2026-07-10: this used to assert the OLD behavior (a hardcoded "Something went wrong — try again"
  // that suppressed the real error) — /ask was the one AI-backed route in this codebase that did this;
  // every other route already surfaces err.message. Found live via a real OpenAI 429 quota error that
  // got reduced to the useless generic string. describeAiError now passes real, non-rate-limit errors
  // through directly (and gives rate-limit/quota errors a clearer, dedicated message instead).
  const res = await fetch(`${baseUrl}/api/ai/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: 'test error',
      history: 'malformed_non_array_triggering_type_error'
    })
  })

  assert.equal(res.status, 500)
  const data = await res.json()
  assert.match(data.error, /map is not a function/)
})

test('GET /api/pieces search by ID matches correctly', async () => {
  const fd1 = new FormData()
  fd1.append('name', 'unique orange top')
  fd1.append('category', 'top')
  const res1 = await fetch(`${baseUrl}/api/pieces`, { method: 'POST', body: fd1 })
  const piece1 = await res1.json()

  const fd2 = new FormData()
  fd2.append('name', 'unique blue pants')
  fd2.append('category', 'bottom')
  const res2 = await fetch(`${baseUrl}/api/pieces`, { method: 'POST', body: fd2 })
  const piece2 = await res2.json()

  // Search by exact numeric ID of piece1
  const searchRes = await fetch(`${baseUrl}/api/pieces?search=${piece1.id}`)
  assert.equal(searchRes.status, 200)
  const searchData = await searchRes.json()
  
  const hasPiece1 = searchData.some(p => p.id === piece1.id)
  const hasPiece2 = searchData.some(p => p.id === piece2.id)
  assert.ok(hasPiece1, 'Should find piece 1')
  assert.ok(!hasPiece2, 'Should not find piece 2')

  // Clean up
  await fetch(`${baseUrl}/api/pieces/${piece1.id}`, { method: 'DELETE' })
  await fetch(`${baseUrl}/api/pieces/${piece2.id}`, { method: 'DELETE' })
})

// 2026-07-10: real, structured home location replacing the model's prior (wrong) habit of inferring
// one from the app's hardcoded timezone string. Server-injected default for /ask's toolContext, never
// left to the model — see routes/ai.js's getHomeLocation().
test('GET /api/settings/home-location returns empty string when unset', async () => {
  const res = await fetch(`${baseUrl}/api/settings/home-location`)
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.homeLocation, '')
})

test('PUT /api/settings/home-location saves and GET reflects the new value', async () => {
  const putRes = await fetch(`${baseUrl}/api/settings/home-location`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ homeLocation: 'Seattle' })
  })
  assert.equal(putRes.status, 200)
  const putData = await putRes.json()
  assert.equal(putData.homeLocation, 'Seattle')

  const getRes = await fetch(`${baseUrl}/api/settings/home-location`)
  const getData = await getRes.json()
  assert.equal(getData.homeLocation, 'Seattle')
})

test('PUT /api/settings/home-location can be updated to a new value and trims whitespace', async () => {
  await fetch(`${baseUrl}/api/settings/home-location`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ homeLocation: '  Portland  ' })
  })
  const getRes = await fetch(`${baseUrl}/api/settings/home-location`)
  const getData = await getRes.json()
  assert.equal(getData.homeLocation, 'Portland')
})




test('opacity truth field round-trips through piece create and update', async () => {
  const fd = new FormData()
  fd.append('name', 'sheer test blouse')
  fd.append('category', 'top')
  fd.append('opacity', 'sheer')
  const createRes = await fetch(`${baseUrl}/api/pieces`, { method: 'POST', body: fd })
  assert.equal(createRes.status, 200)
  const created = await createRes.json()
  assert.equal(created.opacity, 'sheer')

  const updateFd = new FormData()
  updateFd.append('name', 'sheer test blouse')
  updateFd.append('category', 'top')
  updateFd.append('opacity', 'open_weave')
  const updateRes = await fetch(`${baseUrl}/api/pieces/${created.id}`, { method: 'PUT', body: updateFd })
  assert.equal(updateRes.status, 200)
  const updated = await updateRes.json()
  assert.equal(updated.opacity, 'open_weave')

  await fetch(`${baseUrl}/api/pieces/${created.id}`, { method: 'DELETE' })
})

// docs/capsule-roster-selection-spec.md §7b: unset must be a strict no-op —
// creating a piece with no needs_base opinion must persist as null/unset,
// not coerced into a truthy or falsy default that would read as evidence.
test('needs_base defaults to unset (null) when not supplied on create', async () => {
  const fd = new FormData()
  fd.append('name', 'unjudged top')
  fd.append('category', 'top')
  const createRes = await fetch(`${baseUrl}/api/pieces`, { method: 'POST', body: fd })
  assert.equal(createRes.status, 200)
  const created = await createRes.json()
  assert.equal(created.needs_base, null, `unset needs_base must persist as null, got ${JSON.stringify(created.needs_base)}`)

  await fetch(`${baseUrl}/api/pieces/${created.id}`, { method: 'DELETE' })
})

test('needs_base round-trips through piece create and update, distinguishing unset from explicit no', async () => {
  const fd = new FormData()
  fd.append('name', 'side-cutout top')
  fd.append('category', 'top')
  fd.append('needs_base', 'yes')
  const createRes = await fetch(`${baseUrl}/api/pieces`, { method: 'POST', body: fd })
  assert.equal(createRes.status, 200)
  const created = await createRes.json()
  assert.equal(created.needs_base, 'yes')

  const updateFd = new FormData()
  updateFd.append('name', 'side-cutout top')
  updateFd.append('category', 'top')
  updateFd.append('needs_base', 'no')
  const updateRes = await fetch(`${baseUrl}/api/pieces/${created.id}`, { method: 'PUT', body: updateFd })
  assert.equal(updateRes.status, 200)
  const updated = await updateRes.json()
  assert.equal(updated.needs_base, 'no', 'an owner-judged "no" must persist distinctly from unset, even though the engine treats them the same today')

  await fetch(`${baseUrl}/api/pieces/${created.id}`, { method: 'DELETE' })
})
