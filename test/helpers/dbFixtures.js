import { db } from '../../db.js'

// Some older tests hardcode real IDs from the developer's personal wardrobe
// (wardrobe.db is gitignored — a fresh clone starts with an empty table).
// This helper seeds exactly those IDs, but ONLY when they're missing. Callers
// that need synthetic pieces must set WARDROBE_DB_PATH before importing any
// DB-bound modules so fixture rows land in an isolated test database.
//
// Usage: const cleanup = ensureFixturePieces([{ id, name, category, ... }])
//        ... run test ...
//        cleanup() // deletes only the rows this call actually inserted

export function ensureFixturePieces(pieces) {
  const insertedIds = []
  for (const piece of pieces) {
    const existing = db.prepare('SELECT id FROM pieces WHERE id = ?').get(piece.id)
    if (existing) continue

    const columns = Object.keys(piece)
    const placeholders = columns.map(() => '?').join(', ')
    const values = columns.map(col => piece[col])
    db.prepare(`INSERT INTO pieces (${columns.join(', ')}) VALUES (${placeholders})`).run(...values)
    insertedIds.push(piece.id)
  }
  return function cleanupFixturePieces() {
    for (const id of insertedIds) {
      db.prepare('DELETE FROM outfit_pieces WHERE piece_id = ?').run(id)
      db.prepare('DELETE FROM pieces WHERE id = ?').run(id)
    }
  }
}
