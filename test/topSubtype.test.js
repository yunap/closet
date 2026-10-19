import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { inferTopSubtype, backfillTopSubtypes } from '../lib/topSubtypeBackfill.js'

test('named types: a phrase wins over the word inside it', () => {
  assert.equal(inferTopSubtype({ name: 'white octopus graphic t-shirt', reads_as: 'playful graphic tee' }).value, 'tee')
  assert.equal(inferTopSubtype({ name: 'orange ribbed tank top', reads_as: 'bright orange ribbed tank' }).value, 'tank',
    '"ribbed tank top" is a tank, not a ribbed knit top')
  assert.equal(inferTopSubtype({ name: 'Brown shell', formality: 'everyday', sleeve_length: 'sleeveless' }).value, 'shell',
    'a name beats the formality fallback')
  assert.equal(inferTopSubtype({ name: 'multicolor floral hooded sweatshirt', reads_as: 'vibrant floral hoodie' }).value, 'sweatshirt')
  assert.equal(inferTopSubtype({ name: 'navy cream striped button-up shirt' }).value, 'shirt')
})

test('owner ruling: a generic sleeveless top is a shell when dressy, a tank when casual', () => {
  const dressy = inferTopSubtype({ name: 'black solid sleeveless top', sleeve_length: 'sleeveless', formality: 'dressy' })
  assert.deepEqual([dressy.value, dressy.source], ['shell', 'fallback'])
  assert.equal(inferTopSubtype({ name: 'olive ruffled sleeveless top', sleeve_length: 'sleeveless', formality: 'everyday' }).value, 'tank')
  assert.equal(inferTopSubtype({ name: 'plain sleeveless top', sleeve_length: 'sleeveless' }).value, null, 'no formality → owner picks')
})

test('a generic sleeved top falls back to fabric: knit family → knit top, woven → blouse, unclear → owner', () => {
  assert.equal(inferTopSubtype({ name: 'black asymmetrical top', sleeve_length: 'short', fabric_category: 'knit' }).value, 'knit_top')
  assert.equal(inferTopSubtype({ name: 'vibrant floral print top', sleeve_length: 'cap', fabric_category: 'rayon' }).value, 'blouse')
  const cotton = inferTopSubtype({ name: 'red white striped short sleeve top', sleeve_length: 'short', fabric_category: 'cotton' })
  assert.equal(cotton.value, null, 'cotton is both jersey and woven — not guessed')
  assert.match(cotton.reason, /no top type named/)
})

test('disagreement between name and tagger text is never resolved by the fallback', () => {
  const r = inferTopSubtype({ name: 'mustard knit sweater', reads_as: 'textured knit top', sleeve_length: 'short', fabric_category: 'knit' })
  assert.equal(r.value, null)
  assert.equal(r.reason, 'name says sweater, tagger read says knit_top')
})

test('top backfill fills, counts fallback fills, files tasks, and runs once', () => {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE pieces (id INTEGER PRIMARY KEY, name TEXT, category TEXT, reads_as TEXT, notes TEXT,
      sleeve_length TEXT, formality TEXT, fabric_category TEXT, top_subtype TEXT);
    CREATE TABLE todos (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, description TEXT NOT NULL, linked_piece_id INTEGER, completed INTEGER DEFAULT 0, field TEXT);
    CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT);
  `)
  const insert = db.prepare('INSERT INTO pieces (id, name, category, sleeve_length, formality, fabric_category, top_subtype) VALUES (?, ?, ?, ?, ?, ?, ?)')
  insert.run(1, 'band tee', 'top', 'short', 'everyday', 'jersey', null)
  insert.run(2, 'ruffled plum sleeveless top', 'top', 'sleeveless', 'elevated', 'crepe', null)
  insert.run(3, 'striped short sleeve top', 'top', 'short', 'everyday', 'cotton', null)
  insert.run(4, 'silk blouse', 'top', 'long', 'elevated', 'silk', 'shirt') // already set: never overwritten
  insert.run(5, 'black jeans', 'bottom', null, null, null, null)

  assert.deepEqual(backfillTopSubtypes(db), { filled: 2, fromFallback: 1, needsOwner: 1 })
  const value = id => db.prepare('SELECT top_subtype FROM pieces WHERE id = ?').get(id).top_subtype
  assert.deepEqual([value(1), value(2), value(3), value(4), value(5)], ['tee', 'shell', null, 'shirt', null])
  const todos = db.prepare('SELECT * FROM todos').all()
  assert.equal(todos.length, 1)
  assert.equal(todos[0].field, 'top_subtype')
  assert.match(todos[0].description, /^striped short sleeve top: pick a top type — /)
  assert.equal(backfillTopSubtypes(db), null)
})
