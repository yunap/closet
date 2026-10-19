// One-time backfill of top_subtype from names and tagger text — see lib/subtypeBackfill.js for the
// shared rules (name decides, disagreement becomes an owner task).
//
// Tops differ from outerwear in one way: many are named generically ("black asymmetrical top") and
// the tagger read is just as generic, so an unnamed type falls back to structured fields the tagger
// already filled (owner ruling 2026-10-18):
//   sleeveless → shell when formality is elevated/dressy, tank when everyday/lounge (owner drew the
//                tank/shell line at dressiness, which is what formality records)
//   sleeved    → knit_top in a knit-family fabric, blouse in a woven one
// Anything the fallback cannot place (no formality, an ambiguous fabric like cotton) is a task.
import { inferSubtype, backfillSubtypes } from './subtypeBackfill.js'

export const TOP_SUBTYPE_BACKFILL_MARKER = 'top_subtype_backfill'

const KNIT_FABRICS = new Set(['jersey', 'knit', 'rib knit', 'ponte', 'cashmere', 'wool', 'boucle', 'crochet', 'sweatshirt fleece', 'fleece', 'modal'])
const WOVEN_FABRICS = new Set(['poplin', 'linen', 'linen blend', 'rayon', 'viscose', 'silk', 'satin', 'crepe', 'chiffon', 'organza', 'twill', 'lace'])

function topFallback(piece) {
  const sleeve = String(piece.sleeve_length || '').toLowerCase().trim()
  const formality = String(piece.formality || '').toLowerCase().trim()
  const fabric = String(piece.fabric_category || '').toLowerCase().trim()
  if (!sleeve || sleeve === 'unknown') return null
  if (sleeve === 'sleeveless') {
    if (formality === 'elevated' || formality === 'dressy') return 'shell'
    if (formality === 'everyday' || formality === 'lounge') return 'tank'
    return null
  }
  if (KNIT_FABRICS.has(fabric)) return 'knit_top'
  if (WOVEN_FABRICS.has(fabric)) return 'blouse'
  return null
}

const TOP_CONFIG = {
  category: 'top',
  field: 'top_subtype',
  marker: TOP_SUBTYPE_BACKFILL_MARKER,
  taskLabel: 'top type',
  phrases: [
    ['tee',        /\b(t-shirt|tshirt|tee)\b/g],
    ['tank',       /\b(tank top|tank)\b/g],
    ['sweatshirt', /\b(sweatshirt|hoodie|hoody)\b/g],
    ['knit_top',   /\b(knit top|ribbed[\w -]*top|mock[- ]neck[\w -]*top)\b/g],
  ],
  words: [
    ['tank',     /\b(cami|camisole)\b/],
    ['shell',    /\bshell\b/],
    ['blouse',   /\b(blouse|popover)\b/],
    ['shirt',    /\b(button-up|button-down|button-front|shirt)\b/],
    ['sweater',  /\b(sweater|pullover|jumper)\b/],
    ['knit_top', /\bturtleneck\b/],
    ['vest',     /\bvest\b/],
  ],
  fallback: topFallback,
  columns: ['sleeve_length', 'formality', 'fabric_category'],
}

export function inferTopSubtype(piece = {}) {
  return inferSubtype(piece, TOP_CONFIG)
}

export function backfillTopSubtypes(db) {
  return backfillSubtypes(db, TOP_CONFIG)
}
