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
  
  const res = await fetch(`${baseUrl}/api/pieces`, {
    method: 'POST',
    body: fd
  })
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.name, 'test top')
  assert.equal(data.category, 'top')
  assert.ok(data.id)
  
  // GET /api/pieces lists pieces
  const listRes = await fetch(`${baseUrl}/api/pieces`)
  const listData = await listRes.json()
  assert.ok(listData.length >= 1)
  
  // GET /api/pieces/:id gets a specific piece
  const getRes = await fetch(`${baseUrl}/api/pieces/${data.id}`)
  const getData = await getRes.json()
  assert.equal(getData.name, 'test top')
  
  // PUT /api/pieces/:id updates a piece
  const fd2 = new FormData()
  fd2.append('name', 'updated top')
  fd2.append('category', 'top')
  const putRes = await fetch(`${baseUrl}/api/pieces/${data.id}`, {
    method: 'PUT',
    body: fd2
  })
  const putData = await putRes.json()
  assert.equal(putData.name, 'updated top')
  
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

  const fdOutfit = new FormData()
  fdOutfit.append('name', 'test outfit')
  fdOutfit.append('occasion', 'casual')
  fdOutfit.append('pieceIds', JSON.stringify([piece.id]))
  const resOutfit = await fetch(`${baseUrl}/api/outfits`, { method: 'POST', body: fdOutfit })
  const outfit = await resOutfit.json()
  assert.equal(outfit.name, 'test outfit')
  assert.ok(outfit.id)

  const getOutfits = await fetch(`${baseUrl}/api/outfits`)
  const outfits = await getOutfits.json()
  assert.ok(outfits.length >= 1)
  const match = outfits.find(o => o.id === outfit.id)
  assert.ok(match)
  assert.equal(match.pieces[0].id, piece.id)
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

