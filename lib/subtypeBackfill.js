// Shared engine for the one-time category-subtype backfills (outerwear_subtype, top_subtype) that
// fill a type field from text each piece already has, so the field works without re-tagging (owner
// request 2026-10-18). Never read at styling time: once a backfill has run, the stored field is the
// truth and new pieces get it from the tagger.
//
// The name decides first; the tagger's reads_as and the first sentence of its notes are checked
// against it. When they name different types the piece is left NULL and gets a metadata task asking
// the owner to pick — the backfill never guesses between two readings. When nothing names a type, a
// config may supply a fallback from structured fields; otherwise that is a task too. Tasks close
// themselves when the owner saves a value (completeFilledMetadataTodos in crud.js).
//
// A config is:
//   category, field, marker, taskLabel ("outerwear type")
//   phrases:  [[type, /global regex/]] — specific phrases matched first and removed from the text,
//             so a word inside them cannot also count ("track jacket" is not a jacket)
//   words:    [[type, /regex/]]
//   weakWords (optional): [[type, /regex/]] — only consulted when no word above matched
//   fallback  (optional): piece => type | null — structured-field rule for an unnamed type
//   preempt   (optional): (piece, namedTypes) => type | null — a structured fact that decides before
//             the text is weighed at all (tops: no sleeves → 'sleeveless')
//   columns   (optional): extra piece columns the fallback reads

function typesIn(text, config) {
  let lower = String(text || '').toLowerCase()
  const found = new Set()
  for (const [type, re] of config.phrases || []) {
    if (lower.match(re)) found.add(type)
    lower = lower.replace(re, ' ')
  }
  for (const [type, re] of config.words) if (re.test(lower)) found.add(type)
  if (!found.size) for (const [type, re] of config.weakWords || []) if (re.test(lower)) found.add(type)
  return [...found]
}

function firstSentence(text) {
  return String(text || '').split(/(?<=[.!?])\s/)[0]
}

const SOURCE_LABELS = { name: 'name', reads_as: 'tagger read', notes: 'tagger notes' }
const says = source => `${SOURCE_LABELS[source]} ${source === 'notes' ? 'say' : 'says'}`

// Returns { value, reason, source }. value is a subtype value, or null when the owner must pick;
// reason explains a null in owner-facing words; source says where a value came from.
export function inferSubtype(piece = {}, config) {
  const sources = [
    ['name', typesIn(piece.name, config)],
    ['reads_as', typesIn(piece.reads_as, config)],
    ['notes', typesIn(firstSentence(piece.notes), config)],
  ]
  const preempted = config.preempt?.(piece, sources.flatMap(([, types]) => types)) || null
  if (preempted) return { value: preempted, reason: null, source: 'structured' }
  const ambiguous = sources.find(([, types]) => types.length > 1)
  if (ambiguous) {
    return { value: null, reason: `${SOURCE_LABELS[ambiguous[0]]} ${ambiguous[0] === 'notes' ? 'name' : 'names'} more than one type (${ambiguous[1].join(', ')})` }
  }
  const named = sources.filter(([, types]) => types.length === 1).map(([source, [type]]) => ({ source, type }))
  if (!named.length) {
    const fallback = config.fallback?.(piece) || null
    if (fallback) return { value: fallback, reason: null, source: 'fallback' }
    return { value: null, reason: `no ${config.taskLabel} named in the name or tagger notes` }
  }
  const disagreeing = named.find(n => n.type !== named[0].type)
  if (disagreeing) {
    return {
      value: null,
      reason: `${says(named[0].source)} ${named[0].type}, ${says(disagreeing.source)} ${disagreeing.type}`,
    }
  }
  return { value: named[0].type, reason: null, source: named[0].source }
}

// Runs once per database (app_meta marker). Only touches pieces of the config's category whose
// field is still empty, so a value the owner or the tagger already set is never overwritten.
export function backfillSubtypes(db, config) {
  const done = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(config.marker)
  if (done) return null
  const extra = (config.columns || []).map(c => `, ${c}`).join('')
  const rows = db.prepare(`
    SELECT id, name, reads_as, notes${extra} FROM pieces
    WHERE category = ? AND TRIM(COALESCE(${config.field}, '')) = ''
  `).all(config.category)
  const setSubtype = db.prepare(`UPDATE pieces SET ${config.field} = ? WHERE id = ?`)
  const existingTodo = db.prepare(`
    SELECT id FROM todos WHERE type = 'metadata' AND completed = 0 AND linked_piece_id = ? AND field = ?
  `)
  const insertTodo = db.prepare(`INSERT INTO todos (type, description, linked_piece_id, field) VALUES ('metadata', ?, ?, ?)`)
  const summary = { filled: 0, fromFallback: 0, needsOwner: 0 }
  db.transaction(() => {
    for (const piece of rows) {
      const { value, reason, source } = inferSubtype(piece, config)
      if (value) {
        setSubtype.run(value, piece.id)
        summary.filled++
        if (source === 'fallback' || source === 'structured') summary.fromFallback++
      } else {
        summary.needsOwner++
        if (!existingTodo.get(piece.id, config.field)) {
          insertTodo.run(`${piece.name || `Piece ${piece.id}`}: pick a${/^[aeiou]/i.test(config.taskLabel) ? 'n' : ''} ${config.taskLabel} — ${reason}`, piece.id, config.field)
        }
      }
    }
    db.prepare('INSERT OR IGNORE INTO app_meta (key, value) VALUES (?, ?)')
      .run(config.marker, JSON.stringify({ ...summary, at: new Date().toISOString() }))
  })()
  return summary
}
