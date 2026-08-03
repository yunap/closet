import { normalizeColorName } from './colorTaxonomy.js'

export function queueColorTaxonomyReviews(db, { pieceId, pieceName, colors = [] }) {
  const normalizedColors = [...new Set(colors.map(normalizeColorName).filter(Boolean))]
  if (!pieceId || !normalizedColors.length) return []

  const existing = db.prepare(`
    SELECT id FROM todos
    WHERE completed = 0 AND type = 'retag-suggestion'
      AND linked_piece_id = ? AND field = 'colors'
      AND source_type = 'tagger-taxonomy' AND source_id = ?
      AND json_extract(payload, '$.color') = ?
  `)
  const insert = db.prepare(`
    INSERT INTO todos
      (type, description, linked_piece_id, completed, field, source_type, source_id, payload)
    VALUES ('retag-suggestion', ?, ?, 0, 'colors', 'tagger-taxonomy', ?, ?)
  `)
  const added = []
  for (const color of normalizedColors) {
    const sourceId = Number(pieceId)
    if (existing.get(Number(pieceId), sourceId, color)) continue
    const description = `Color taxonomy review for ${pieceName || `piece #${pieceId}`}: AI identified unsupported shade “${color}”. It was not added to the garment.`
    const result = insert.run(description, Number(pieceId), sourceId, JSON.stringify({
      issue: 'unsupported_color', color, piece_id: Number(pieceId), piece_name: pieceName || null,
    }))
    added.push(Number(result.lastInsertRowid))
  }
  return added
}
