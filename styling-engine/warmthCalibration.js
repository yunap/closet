// Warmth-calibration evidence policy.
//
// Owns ONE question: given the evidence Closet actually stores, is there enough information to
// assign this garment an ordinal warmth level? That is a policy about our data, not a claim about
// garments, and it is deliberately kept out of attributes.js so it cannot harden into one.
//
// History worth keeping, because the first attempt overreached. Migrating the calibration onto
// thermalMaterialVerdict() moved 134 of 268 pieces (52%) into UNKNOWN — medium cotton tees, linen
// and silk blouses. So `verdict === 'unknown'` alone is NOT enough to decide unscoreable. The old
// hand-rolled NONCOMMITTAL_FABRIC set was carrying a real second distinction, and the first fix
// named it `fabricAdmitsHiddenMaterial()` — "can this fabric hide another material?" That name
// claimed physics the data does not establish: denim can be quilted, leather jackets can be
// padded, cotton jackets can hold batting, knit outerwear can be lined. What the measurement
// actually supports is narrower and is stated as such below.
import { thermalMaterialVerdict } from './attributes.js'

// A MEASURED CALIBRATION FINDING about this taxonomy, not a physical property of fabric.
//
// These are the fabric_category values for which `fabric_weight` + known fibres most often fail to
// characterize a garment thermally — because each describes a face fabric or declines to describe
// one at all, leaving construction unstated. Everything else in the taxonomy names a construction
// that our stored weight and fibre facts already characterize well enough to score.
//
// Measured on the real wardrobe: the medium/heavy population is dominated by knit (39), cotton
// (29), leather (16), denim (11) — all scoreable; these three categories plus an untagged one
// account for the entire ambiguous band. Re-derive with scratch/inspect_piece.js rather than
// trusting these counts, and revisit the set if the taxonomy changes.
//
// When Closet gains a real construction fact — visible padding, quilting, a lining — thermal
// ambiguity should be read off THAT, and this set should shrink or disappear.
const THERMALLY_UNCHARACTERIZED_FABRIC_CATEGORIES = new Set([
  'synthetic', 'other', 'technical/performance', '',
])

const SUBSTANCE = { light: 0, medium: 1, heavy: 2 }

// scoreable            → an ordinal warmth level can be assigned
// thermally_ambiguous  → substantial garment whose stored evidence does not characterize it
// insufficient_evidence → not even the starting fact (fabric_weight) is present
export function warmthCalibrationEvidenceState(piece = {}) {
  const substance = SUBSTANCE[piece?.fabric_weight] ?? null
  if (substance === null) return 'insufficient_evidence'
  if (thermalMaterialVerdict(piece) !== 'unknown') return 'scoreable'
  // Light garments are exempt: whatever is unstated cannot move an ultralight or light piece far
  // enough up the scale to matter, so refusing to score them buys nothing.
  if (substance < 1) return 'scoreable'
  const fabric = String(piece?.fabric_category || '').toLowerCase().trim()
  return THERMALLY_UNCHARACTERIZED_FABRIC_CATEGORIES.has(fabric) ? 'thermally_ambiguous' : 'scoreable'
}

export const WARMTH_LEVELS = ['very light', 'light', 'moderate', 'warm', 'very warm']

// The candidate ordinal scale from docs/garment-warmth-calibration.md §2. Returns null when the
// evidence state says it cannot be assigned — callers decide how to present that, rather than
// having a sentinel string baked in here.
export function proposedWarmthLevel(piece = {}) {
  if (warmthCalibrationEvidenceState(piece) !== 'scoreable') return null
  const substance = SUBSTANCE[piece?.fabric_weight] ?? 0
  const bonus = thermalMaterialVerdict(piece) === 'insulating' ? 2 : 0
  return WARMTH_LEVELS[Math.min(WARMTH_LEVELS.length - 1, substance + bonus)]
}
