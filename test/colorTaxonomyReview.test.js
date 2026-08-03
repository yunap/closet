import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { queueColorTaxonomyReviews } from '../lib/colorTaxonomyReview.js'

test('unsupported tagger shades create one deduplicated linked review each', () => {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE todos (
    id INTEGER PRIMARY KEY, type TEXT, description TEXT, linked_piece_id INTEGER,
    completed INTEGER DEFAULT 0, field TEXT, source_type TEXT, source_id INTEGER, payload TEXT
  )`)
  const input = { pieceId: 237, pieceName: 'Tropical pants', colors: [' Mint ', 'mint'] }
  assert.equal(queueColorTaxonomyReviews(db, input).length, 1)
  assert.equal(queueColorTaxonomyReviews(db, input).length, 0)
  const row = db.prepare('SELECT * FROM todos').get()
  assert.equal(row.linked_piece_id, 237)
  assert.equal(row.field, 'colors')
  assert.equal(row.source_type, 'tagger-taxonomy')
  assert.equal(row.source_id, 237)
  assert.equal(JSON.parse(row.payload).color, 'mint')
  assert.match(row.description, /was not added to the garment/)
  db.close()
})
