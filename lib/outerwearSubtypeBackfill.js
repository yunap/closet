// One-time backfill of outerwear_subtype from names and tagger text — see lib/subtypeBackfill.js for
// the shared rules (name decides, disagreement or silence becomes an owner task).
import { inferSubtype, backfillSubtypes } from './subtypeBackfill.js'

export const OUTERWEAR_SUBTYPE_BACKFILL_MARKER = 'outerwear_subtype_backfill'

const OUTERWEAR_CONFIG = {
  category: 'outerwear',
  field: 'outerwear_subtype',
  marker: OUTERWEAR_SUBTYPE_BACKFILL_MARKER,
  taskLabel: 'outerwear type',
  // Owner ruling 2026-10-18: sporty zip layers are 'hoodie', not 'jacket'.
  phrases: [
    ['hoodie', /\b(hoodie|hoody|track jacket|zip-up sweatshirt|sweatshirt)\b/g],
  ],
  words: [
    ['coat',     /\b(coat|overcoat|raincoat|topcoat|peacoat|trench|parka|duster)\b/],
    ['jacket',   /\b(jacket|bomber|windbreaker|anorak|shacket|blouson)\b/],
    ['blazer',   /\bblazer\b/],
    ['cardigan', /\bcardigan\b/],
    ['vest',     /\b(vest|gilet)\b/],
    ['shrug',    /\b(shrug|bolero)\b/],
  ],
  // Material/construction words that only suggest a type when no garment noun is present
  // ("grey textured fleece", but "fleece vest" is a vest).
  weakWords: [
    ['jacket', /\b(fleece|puffer)\b/],
  ],
}

export function inferOuterwearSubtype(piece = {}) {
  return inferSubtype(piece, OUTERWEAR_CONFIG)
}

export function backfillOuterwearSubtypes(db) {
  return backfillSubtypes(db, OUTERWEAR_CONFIG)
}
