import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { inferTopSubtype, backfillTopSubtypes, remapTopSubtypesV1 } from '../lib/topSubtypeBackfill.js'

test('named types: a phrase wins over the word inside it', () => {
  assert.equal(inferTopSubtype({ name: 'white octopus graphic t-shirt', reads_as: 'playful graphic tee', sleeve_length: 'short' }).value, 'tee')
  assert.equal(inferTopSubtype({ name: 'multicolor floral hooded sweatshirt', reads_as: 'vibrant floral hoodie', sleeve_length: 'long' }).value, 'sweatshirt')
  assert.equal(inferTopSubtype({ name: 'olive textured mock neck top', sleeve_length: '3/4' }).value, 'knit_top')
})

test('owner ruling: shirts and blouses are one type — buttons can be decorative', () => {
  assert.equal(inferTopSubtype({ name: 'navy cream striped button-up shirt', sleeve_length: 'long' }).value, 'shirt_blouse')
  assert.equal(inferTopSubtype({ name: 'black satin button-up top', reads_as: 'relaxed button-front top', sleeve_length: '3/4' }).value, 'shirt_blouse')
  assert.equal(inferTopSubtype({ name: 'white button-down blouse', sleeve_length: 'long' }).value, 'shirt_blouse',
    '"button-down blouse" is no longer two types at once')
})

test('owner ruling: no sleeves wins — every sleeveless top is sleeveless, except sweaters and sweatshirts', () => {
  const blouse = inferTopSubtype({ name: 'paisley sleeveless blouse', sleeve_length: 'sleeveless' })
  assert.deepEqual([blouse.value, blouse.source], ['sleeveless', 'structured'])
  assert.equal(inferTopSubtype({ name: 'Brown shell', sleeve_length: 'sleeveless', formality: 'everyday' }).value, 'sleeveless')
  assert.equal(inferTopSubtype({ name: 'orange ribbed tank top', reads_as: 'bright orange ribbed tank', sleeve_length: 'sleeveless' }).value, 'sleeveless')
  assert.equal(inferTopSubtype({ name: 'turquoise ribbed sleeveless cropped top', reads_as: 'simple ribbed tank', sleeve_length: 'sleeveless' }).value, 'sleeveless',
    'a name/read disagreement no longer matters once the sleeves settle it')
  assert.equal(inferTopSubtype({ name: 'cable knit sweater', sleeve_length: 'sleeveless' }).value, 'sweater')
  assert.equal(inferTopSubtype({ name: 'tweed vest', sleeve_length: 'sleeveless' }).value, 'other', 'a vest is not a tank')
})

test('a generic sleeved top falls back to fabric: knit family → knit top, woven → shirts & blouses, unclear → owner', () => {
  assert.equal(inferTopSubtype({ name: 'black asymmetrical top', sleeve_length: 'short', fabric_category: 'knit' }).value, 'knit_top')
  assert.equal(inferTopSubtype({ name: 'vibrant floral print top', sleeve_length: 'cap', fabric_category: 'rayon' }).value, 'shirt_blouse')
  const cotton = inferTopSubtype({ name: 'red white striped short sleeve top', sleeve_length: 'short', fabric_category: 'cotton' })
  assert.equal(cotton.value, null, 'cotton is both jersey and woven — not guessed')
  assert.match(cotton.reason, /no top type named/)
})

test('disagreement on a sleeved top is never resolved by the fallback', () => {
  const r = inferTopSubtype({ name: 'mustard knit sweater', reads_as: 'textured knit top', sleeve_length: 'short', fabric_category: 'knit' })
  assert.equal(r.value, null)
  assert.equal(r.reason, 'name says sweater, tagger read says knit_top')
})

function scratchDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE pieces (id INTEGER PRIMARY KEY, name TEXT, category TEXT, reads_as TEXT, notes TEXT,
      sleeve_length TEXT, formality TEXT, fabric_category TEXT, top_subtype TEXT);
    CREATE TABLE todos (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, description TEXT NOT NULL, linked_piece_id INTEGER, completed INTEGER DEFAULT 0, field TEXT);
    CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT);
  `)
  return db
}

test('top backfill fills, counts structured fills, files tasks, and runs once', () => {
  const db = scratchDb()
  const insert = db.prepare('INSERT INTO pieces (id, name, category, sleeve_length, fabric_category, top_subtype) VALUES (?, ?, ?, ?, ?, ?)')
  insert.run(1, 'band tee', 'top', 'short', 'jersey', null)
  insert.run(2, 'ruffled plum sleeveless top', 'top', 'sleeveless', 'crepe', null)
  insert.run(3, 'striped short sleeve top', 'top', 'short', 'cotton', null)
  insert.run(4, 'silk blouse', 'top', 'long', 'silk', 'sweater') // already set: never overwritten
  insert.run(5, 'black jeans', 'bottom', null, null, null)

  assert.deepEqual(backfillTopSubtypes(db), { filled: 2, fromFallback: 1, needsOwner: 1 })
  const value = id => db.prepare('SELECT top_subtype FROM pieces WHERE id = ?').get(id).top_subtype
  assert.deepEqual([value(1), value(2), value(3), value(4), value(5)], ['tee', 'sleeveless', null, 'sweater', null])
  const todos = db.prepare('SELECT * FROM todos').all()
  assert.equal(todos.length, 1)
  assert.equal(todos[0].field, 'top_subtype')
  assert.match(todos[0].description, /^striped short sleeve top: pick a top type — /)
  assert.equal(backfillTopSubtypes(db), null)
})

test('the one-time remap converts first-list values, applies no-sleeves-wins, closes filled tasks, and runs once', () => {
  const db = scratchDb()
  const insert = db.prepare('INSERT INTO pieces (id, name, category, sleeve_length, top_subtype) VALUES (?, ?, ?, ?, ?)')
  insert.run(1, 'casual tank', 'top', 'sleeveless', 'tank')
  insert.run(2, 'dressy shell', 'top', 'sleeveless', 'shell')
  insert.run(3, 'button-up', 'top', 'long', 'shirt')
  insert.run(4, 'print blouse', 'top', 'long', 'blouse')
  insert.run(5, 'tweed vest', 'top', 'sleeveless', 'vest')
  insert.run(6, 'paisley sleeveless blouse', 'top', 'sleeveless', 'blouse')
  insert.run(7, 'untyped sleeveless top', 'top', 'sleeveless', null)
  insert.run(8, 'untyped lace top', 'top', '3/4', null)
  insert.run(9, 'graphic tee', 'top', 'short', 'tee')
  insert.run(10, 'sleeveless knit sweater', 'top', 'sleeveless', 'sweater')
  const task = db.prepare("INSERT INTO todos (type, description, linked_piece_id, field) VALUES ('metadata', ?, ?, 'top_subtype')")
  task.run('untyped sleeveless top: pick a top type', 7)
  task.run('untyped lace top: pick a top type', 8)

  assert.deepEqual(remapTopSubtypesV1(db), { remapped: 6, toSleeveless: 1, tasksClosed: 1 })
  const value = id => db.prepare('SELECT top_subtype FROM pieces WHERE id = ?').get(id).top_subtype
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(value),
    ['sleeveless', 'sleeveless', 'shirt_blouse', 'shirt_blouse', 'other', 'sleeveless', 'sleeveless', null, 'tee', 'sweater'],
    'a vest stays other — no sleeves, but not a tank')
  const open = db.prepare('SELECT linked_piece_id FROM todos WHERE completed = 0').all().map(t => t.linked_piece_id)
  assert.deepEqual(open, [8])
  assert.equal(remapTopSubtypesV1(db), null)
})
