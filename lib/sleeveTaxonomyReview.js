// Sleeve-shape taxonomy migration review queue: `relaxed`/`raglan` predate the functional
// sleeve-volume taxonomy (see docs/garment-field-reference.md's "Sleeve taxonomy" writeup) and
// cannot be translated deterministically — `raglan` names armhole attachment construction, not a
// volume profile, and `relaxed` conflated "no meaningful excess volume" with several genuinely
// voluminous garments. Flags them via the existing retag-suggestion queue (the same `todos`
// mechanism `queueColorTaxonomyReviews` uses) for the owner to reclassify manually. Deliberately
// does not propose a specific replacement value or make any model call — the owner asked for these
// left untouched until they can look at each garment themselves.
export function queueSleeveTaxonomyReviews(db) {
  const rows = db.prepare(`
    SELECT id, name, sleeve_shape FROM pieces WHERE sleeve_shape IN ('relaxed', 'raglan')
  `).all()
  if (!rows.length) return []

  const existing = db.prepare(`
    SELECT id FROM todos
    WHERE completed = 0 AND type = 'retag-suggestion'
      AND linked_piece_id = ? AND field = 'sleeve_shape'
      AND source_type = 'sleeve-taxonomy-migration'
  `)
  const insert = db.prepare(`
    INSERT INTO todos
      (type, description, linked_piece_id, completed, field, source_type, source_id, payload)
    VALUES ('retag-suggestion', ?, ?, 0, 'sleeve_shape', 'sleeve-taxonomy-migration', ?, ?)
  `)
  const added = []
  for (const piece of rows) {
    if (existing.get(piece.id)) continue
    const label = piece.name || `piece #${piece.id}`
    const description = `Sleeve shape taxonomy review for ${label}: current value "${piece.sleeve_shape}" predates the functional sleeve-volume taxonomy and needs visual reclassification into fitted, straight, puff_shoulder, gathered_ruched, voluminous, flared, deep_armhole, other, or unknown.`
    const result = insert.run(description, piece.id, piece.id, JSON.stringify({
      issue: 'legacy_sleeve_shape_value',
      current_value: piece.sleeve_shape,
      piece_id: piece.id,
      piece_name: piece.name || null,
    }))
    added.push(Number(result.lastInsertRowid))
  }
  return added
}
