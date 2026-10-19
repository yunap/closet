import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { inferOuterwearSubtype, backfillOuterwearSubtypes } from '../lib/outerwearSubtypeBackfill.js'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-outerwear-subtype-'))
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

test('the name decides the type when the tagger text agrees or is silent', () => {
  assert.equal(inferOuterwearSubtype({ name: 'cream trench coat with belt', reads_as: 'classic khaki trench coat' }).value, 'coat')
  assert.equal(inferOuterwearSubtype({ name: 'striped knit cardigan', reads_as: 'textured relaxed cardigan' }).value, 'cardigan')
  assert.equal(inferOuterwearSubtype({ name: 'Duster', reads_as: '', notes: '' }).value, 'coat')
  assert.equal(inferOuterwearSubtype({ name: 'thin UPF technical hoodie' }).value, 'hoodie')
  assert.equal(inferOuterwearSubtype({ name: 'activewear zip-up track jacket' }).value, 'hoodie',
    'owner ruling: a track jacket is a sporty zip layer, not a jacket — the word "jacket" inside the phrase does not count')
  assert.equal(inferOuterwearSubtype({ name: 'reversible hooded windbreaker' }).value, 'jacket', '"hooded" is not a hoodie')
})

test('a material word only decides when no garment noun is present', () => {
  assert.equal(inferOuterwearSubtype({ name: 'grey textured fleece', reads_as: 'heathered grey textured fleece' }).value, 'jacket', 'owner ruling: a fleece stays a jacket')
  assert.equal(inferOuterwearSubtype({ name: 'rust fleece vest' }).value, 'vest')
})

test('the tagger text fills in when the name names no type', () => {
  assert.equal(inferOuterwearSubtype({ name: 'gray layer', reads_as: 'earthy patterned jacket' }).value, 'jacket')
  assert.equal(inferOuterwearSubtype({ name: 'navy layer', notes: 'A navy blazer in wool. Pairs with a cardigan underneath.' }).value, 'blazer',
    'only the first sentence of the notes is read — later prose mentions other garments')
})

test('disagreement or silence leaves the value for the owner instead of guessing', () => {
  const conflict = inferOuterwearSubtype({ name: 'light oatmeal knit open vest', reads_as: 'chunky knit open cardigan' })
  assert.equal(conflict.value, null)
  assert.equal(conflict.reason, 'name says vest, tagger read says cardigan')

  const silent = inferOuterwearSubtype({ name: 'patchwork knit buttoned top', reads_as: 'textured layered knit' })
  assert.equal(silent.value, null)
  assert.match(silent.reason, /no outerwear type named/)
})

function scratchDb() {
  const scratch = new Database(':memory:')
  scratch.exec(`
    CREATE TABLE pieces (id INTEGER PRIMARY KEY, name TEXT, category TEXT, reads_as TEXT, notes TEXT, outerwear_subtype TEXT);
    CREATE TABLE todos (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, description TEXT NOT NULL, linked_piece_id INTEGER, completed INTEGER DEFAULT 0, field TEXT);
    CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT);
  `)
  const insert = scratch.prepare('INSERT INTO pieces (id, name, category, reads_as, outerwear_subtype) VALUES (?, ?, ?, ?, ?)')
  insert.run(1, 'black wool coat', 'outerwear', 'tailored coat', null)
  insert.run(2, 'open knit vest', 'outerwear', 'chunky knit cardigan', null)
  insert.run(3, 'red jacket', 'outerwear', null, 'blazer') // already set: never overwritten
  insert.run(4, 'wide leg jeans', 'bottom', null, null)
  return scratch
}

test('backfill fills clean pieces, files one task per disagreement, and runs once', () => {
  const scratch = scratchDb()
  assert.deepEqual(backfillOuterwearSubtypes(scratch), { filled: 1, fromFallback: 0, needsOwner: 1 })

  const value = id => scratch.prepare('SELECT outerwear_subtype FROM pieces WHERE id = ?').get(id).outerwear_subtype
  assert.equal(value(1), 'coat')
  assert.equal(value(2), null)
  assert.equal(value(3), 'blazer')
  assert.equal(value(4), null, 'non-outerwear is never touched')

  const todos = scratch.prepare('SELECT * FROM todos').all()
  assert.equal(todos.length, 1)
  assert.equal(todos[0].type, 'metadata')
  assert.equal(todos[0].field, 'outerwear_subtype')
  assert.equal(todos[0].linked_piece_id, 2)
  assert.match(todos[0].description, /open knit vest: pick an outerwear type — name says vest, tagger read says cardigan/)

  scratch.prepare('UPDATE pieces SET outerwear_subtype = NULL WHERE id = 1').run()
  assert.equal(backfillOuterwearSubtypes(scratch), null, 'the app_meta marker makes it one-time')
  assert.equal(value(1), null)
  assert.equal(scratch.prepare('SELECT COUNT(*) AS n FROM todos').get().n, 1)
})

test('outerwear_subtype round-trips, is strictly validated, filters the wardrobe, and closes its task on save', async () => {
  const create = async (name, subtype) => {
    const fd = new FormData()
    fd.append('name', name)
    fd.append('category', 'outerwear')
    if (subtype) fd.append('outerwear_subtype', subtype)
    return (await fetch(`${baseUrl}/api/pieces`, { method: 'POST', body: fd })).json()
  }
  const cardigan = await create('test grey cardigan', 'cardigan')
  const coat = await create('test camel coat', 'coat')
  assert.equal(cardigan.outerwear_subtype, 'cardigan')

  const filtered = await (await fetch(`${baseUrl}/api/pieces?category=outerwear&subtype=cardigan`)).json()
  const ids = filtered.map(p => p.id)
  assert.ok(ids.includes(cardigan.id))
  assert.ok(!ids.includes(coat.id))

  const todo = await (await fetch(`${baseUrl}/api/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'metadata', description: 'test camel coat: pick an outerwear type', linked_piece_id: coat.id, field: 'outerwear_subtype' })
  })).json()

  const put = async value => {
    const fd = new FormData()
    fd.append('name', 'test camel coat')
    fd.append('category', 'outerwear')
    fd.append('outerwear_subtype', value)
    return (await fetch(`${baseUrl}/api/pieces/${coat.id}`, { method: 'PUT', body: fd })).json()
  }
  assert.equal((await put('poncho')).outerwear_subtype, null, 'an unrecognized value is nulled, like bottom_subtype')
  let list = await (await fetch(`${baseUrl}/api/todos`)).json()
  assert.equal(list.find(t => t.id === todo.id).completed, false)

  assert.equal((await put('coat')).outerwear_subtype, 'coat')
  list = await (await fetch(`${baseUrl}/api/todos`)).json()
  assert.equal(list.find(t => t.id === todo.id).completed, true)
})

test('top_subtype round-trips, is strictly validated and filters the wardrobe', async () => {
  const create = async (name, subtype) => {
    const fd = new FormData()
    fd.append('name', name)
    fd.append('category', 'top')
    fd.append('top_subtype', subtype)
    return (await fetch(`${baseUrl}/api/pieces`, { method: 'POST', body: fd })).json()
  }
  const sleeveless = await create('test silk shell', 'sleeveless')
  const tee = await create('test striped tee', 'tee')
  const bogus = await create('test top', 'shell')
  assert.equal(sleeveless.top_subtype, 'sleeveless')
  assert.equal(bogus.top_subtype, null, 'a retired first-list value is nulled like any unrecognized value')

  const ids = (await (await fetch(`${baseUrl}/api/pieces?category=top&subtype=sleeveless`)).json()).map(p => p.id)
  assert.ok(ids.includes(sleeveless.id))
  assert.ok(!ids.includes(tee.id))
})
