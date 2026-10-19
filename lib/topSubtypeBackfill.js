// One-time backfill of top_subtype from names, tagger text and structured fields — see
// lib/subtypeBackfill.js for the shared rules (name decides, disagreement becomes an owner task).
//
// Tops add two structured rules (owner rulings 2026-10-18/19, see styling-engine/topSubtype.js):
//   preempt:  sleeve_length 'sleeveless' → 'sleeveless', whatever the text says, unless the text
//             names a sweater, sweatshirt or vest (a vest stays 'other'). "No sleeves wins" — it is the most visible fact.
//   fallback: a sleeved top whose name and tagger text name no type → 'knit_top' in a knit-family
//             fabric_category, 'shirt_blouse' in a woven one. Anything else (cotton, synthetic,
//             mesh — each can be either) is an owner task.
//
// remapTopSubtypesV1 converts values stored under the first top list (tank/shell/shirt/blouse/vest)
// for databases that already ran the backfill under it.
import { inferSubtype, backfillSubtypes } from './subtypeBackfill.js'
import { TOP_SUBTYPE_V1_REMAP, SLEEVELESS_KEEPS_TYPE } from '../styling-engine/topSubtype.js'

export const TOP_SUBTYPE_BACKFILL_MARKER = 'top_subtype_backfill'
export const TOP_SUBTYPE_V1_REMAP_MARKER = 'top_subtype_v1_remap'

const KNIT_FABRICS = new Set(['jersey', 'knit', 'rib knit', 'ponte', 'cashmere', 'wool', 'boucle', 'crochet', 'sweatshirt fleece', 'fleece', 'modal'])
const WOVEN_FABRICS = new Set(['poplin', 'linen', 'linen blend', 'rayon', 'viscose', 'silk', 'satin', 'crepe', 'chiffon', 'organza', 'twill', 'lace'])

const isSleeveless = piece => String(piece.sleeve_length || '').toLowerCase().trim() === 'sleeveless'

function topPreempt(piece, namedTypes) {
  if (!isSleeveless(piece)) return null
  if (namedTypes.some(type => SLEEVELESS_KEEPS_TYPE.has(type))) return null
  return 'sleeveless'
}

function topFallback(piece) {
  const sleeve = String(piece.sleeve_length || '').toLowerCase().trim()
  const fabric = String(piece.fabric_category || '').toLowerCase().trim()
  if (!sleeve || sleeve === 'unknown') return null
  if (KNIT_FABRICS.has(fabric)) return 'knit_top'
  if (WOVEN_FABRICS.has(fabric)) return 'shirt_blouse'
  return null
}

const TOP_CONFIG = {
  category: 'top',
  field: 'top_subtype',
  marker: TOP_SUBTYPE_BACKFILL_MARKER,
  taskLabel: 'top type',
  phrases: [
    ['tee',        /\b(t-shirt|tshirt|tee)\b/g],
    ['sleeveless', /\b(tank top|tank)\b/g],
    ['sweatshirt', /\b(sweatshirt|hoodie|hoody)\b/g],
    ['knit_top',   /\b(knit top|ribbed[\w -]*top|mock[- ]neck[\w -]*top)\b/g],
  ],
  words: [
    ['sleeveless',   /\b(cami|camisole|shell)\b/],
    ['shirt_blouse', /\b(blouse|popover|button-up|button-down|button-front|shirt)\b/],
    ['sweater',      /\b(sweater|pullover|jumper)\b/],
    ['knit_top',     /\bturtleneck\b/],
    ['other',        /\bvest\b/],
  ],
  preempt: topPreempt,
  fallback: topFallback,
  columns: ['sleeve_length', 'fabric_category'],
}

export function inferTopSubtype(piece = {}) {
  return inferSubtype(piece, TOP_CONFIG)
}

export function backfillTopSubtypes(db) {
  return backfillSubtypes(db, TOP_CONFIG)
}

// One-time (app_meta marker). Maps first-list values to the current list, then applies "no sleeves
// wins" to every top — including the owner's own earlier picks, which is the ruling — and fills
// still-empty sleeveless tops, closing their open "pick a top type" tasks. Values that are already
// current and pieces with sleeves are left exactly as they are.
export function remapTopSubtypesV1(db) {
  const done = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(TOP_SUBTYPE_V1_REMAP_MARKER)
  if (done) return null
  const summary = { remapped: 0, toSleeveless: 0, tasksClosed: 0 }
  const set = db.prepare('UPDATE pieces SET top_subtype = ? WHERE id = ?')
  db.transaction(() => {
    const rows = db.prepare("SELECT id, top_subtype, sleeve_length FROM pieces WHERE category = 'top'").all()
    for (const piece of rows) {
      const current = String(piece.top_subtype || '').toLowerCase().trim()
      let next = TOP_SUBTYPE_V1_REMAP[current] || current
      if (isSleeveless(piece) && !SLEEVELESS_KEEPS_TYPE.has(next)) next = 'sleeveless'
      if (next === current) continue
      set.run(next || null, piece.id)
      if (!current) summary.toSleeveless++
      else summary.remapped++
    }
    summary.tasksClosed = db.prepare(`
      UPDATE todos SET completed = 1
      WHERE type = 'metadata' AND completed = 0 AND field = 'top_subtype'
        AND linked_piece_id IN (SELECT id FROM pieces WHERE TRIM(COALESCE(top_subtype, '')) NOT IN ('', 'unknown'))
    `).run().changes
    db.prepare('INSERT OR IGNORE INTO app_meta (key, value) VALUES (?, ?)')
      .run(TOP_SUBTYPE_V1_REMAP_MARKER, JSON.stringify({ ...summary, at: new Date().toISOString() }))
  })()
  return summary
}
