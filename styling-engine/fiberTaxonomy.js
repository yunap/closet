// Canonical fibre/material taxonomy.
//
// A dependency-free leaf module on purpose. attributes.js imports confidenceFromProfile from
// taggerMerge.js, so taggerMerge cannot import attributes back without a cycle — and this
// vocabulary has to be readable from both, plus the tagger prompt and both intake forms. Same
// extraction the thermal model needed for the same reason (see thermal.js).
//
export const ALL_PIECE_CATEGORIES = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory']

// Canonical fibre/material taxonomy — the single owner of this vocabulary.
//
// Until 2026-09-01 the same 35 values were maintained as FIVE separate copies: the tagger prompt
// enum (prompts.js), VALID_FIBERS (taggerMerge.js), FIBER_OPTIONS in PieceForm.jsx and again in
// BatchAdd.jsx, and a FIBER_VALUES here that no code imported. The four live copies agreed; the
// dead one had silently drifted 13 values behind (no hemp, tweed, or any of the jewellery
// materials) — which is what an unowned vocabulary looks like before it causes a visible bug.
// See docs/fiber-evidence-completeness-spec.md §7.1. Same single-owner pattern as
// SLEEVE_SHAPE_VALUES below.
//
// Members are grouped by FAMILY. Both consumer orderings in use are permutations of these same
// family blocks, so each is expressed as a family sequence rather than a hand-kept list:
//   - FIBER_VALUES         insulating first — the tagger prompt and write-path validation order
//   - FIBER_OPTIONS_ORDER  plant first — the order both intake forms render
// fiberValuesInFamilyOrder() derives either. Tests assert both reproduce today's literals exactly.
//
// `appliesTo` is metadata for the editor's category filtering (spec §7.5) and is deliberately not
// consumed yet — §7.1 is a behaviour-preserving consolidation, so nothing reads it in this change.
export const FIBER_FAMILIES = {
  // Plant cellulose.
  plant_cellulose: ['cotton', 'linen', 'hemp'],
  // Filament protein. Not grouped with the insulating protein fibres: silk does not trap body heat.
  filament_protein: ['silk'],
  // The warmth-bearing family. INSULATING_FIBERS is derived from exactly this list.
  insulating: ['wool', 'merino', 'cashmere', 'alpaca', 'mohair', 'fleece', 'down'],
  // Regenerated cellulose. `lyocell` is not a member — it normalizes to `tencel` (see FIBER_SYNONYMS).
  regenerated_cellulose: ['tencel', 'modal', 'rayon', 'viscose'],
  synthetic: ['polyester', 'nylon', 'acrylic', 'spandex'],
  // Not literal fibres. This field is a functional material classification, which is why a woven
  // structure (denim, tweed) and a hide (leather, suede) are legitimate values here.
  constructed_textile: ['leather', 'suede', 'denim', 'tweed'],
  // Jewellery/accessory hardware materials. Present so an accessory has a real value to align its
  // fabric_category against instead of collapsing to `unknown`.
  jewelry_material: ['metal', 'stone', 'wood', 'ceramic', 'glass', 'horn', 'shell', 'resin',
    'pearl', 'crystal', 'enamel'],
  unresolved: ['unknown'],
}

export const FIBER_FAMILY_APPLICABILITY = {
  plant_cellulose: ALL_PIECE_CATEGORIES,
  filament_protein: ALL_PIECE_CATEGORIES,
  insulating: ALL_PIECE_CATEGORIES,
  regenerated_cellulose: ALL_PIECE_CATEGORIES,
  synthetic: ALL_PIECE_CATEGORIES,
  constructed_textile: ALL_PIECE_CATEGORIES,
  jewelry_material: ['accessory'],
  unresolved: ALL_PIECE_CATEGORIES,
}

function fiberValuesInFamilyOrder(familyOrder) {
  return familyOrder.flatMap(family => FIBER_FAMILIES[family])
}

// Insulating-first. The tagger prompt enum and taggerMerge's VALID_FIBERS both derive from this.
export const FIBER_VALUES = fiberValuesInFamilyOrder([
  'insulating', 'plant_cellulose', 'filament_protein', 'regenerated_cellulose',
  'synthetic', 'constructed_textile', 'jewelry_material', 'unresolved',
])

// Plant-first. Both intake forms render this order.
export const FIBER_OPTIONS_ORDER = fiberValuesInFamilyOrder([
  'plant_cellulose', 'filament_protein', 'insulating', 'regenerated_cellulose',
  'synthetic', 'constructed_textile', 'jewelry_material', 'unresolved',
])

export const FIBER_FAMILY_BY_VALUE = Object.fromEntries(
  Object.entries(FIBER_FAMILIES).flatMap(([family, values]) => values.map(v => [v, family]))
)

// Derived, not hand-kept: "which fibres trap body heat" is the definition of the insulating family.
export const INSULATING_FIBERS = new Set(FIBER_FAMILIES.insulating)

// lyocell is the generic fibre name; tencel is its branded form, and this app stores one concept
// for both. Remapped before validation rather than treated as a distinct value.
export const FIBER_SYNONYMS = { lyocell: 'tencel' }

const FIBER_CANONICAL_INDEX = new Map(FIBER_VALUES.map((v, i) => [v, i]))

// THE normalizer for this field. Lives with the taxonomy, not in either write path: routes/crud.js
// (manual edit) and taggerMerge.js (tagger output) are adapters that call it, so the same logical
// input persists the same bytes whichever wrote it. See docs/fiber-evidence-completeness-spec.md §10.
//
// Contract:
//   - empty/missing input  → [], on BOTH paths. Not ['unknown']: that is an assertion of
//     uncertainty, and nothing about an empty input says anyone looked. It also matters
//     operationally — isPopulated(['unknown']) is true, so the old tagger-side default silently
//     suppressed fiber_content's own gate-critical review chip. Same choice, for the same reason,
//     that normalizeWeatherProtection() already documents.
//   - out-of-vocabulary tokens are NOT rewritten to 'unknown'. Invalid evidence and honest
//     uncertainty are different states and the responsibility census requires they stay distinct;
//     collapsing them turned a spelling failure into a valid-looking answer. They are dropped from
//     the stored value and returned separately so a caller can queue them for review.
//   - 'unknown' alongside resolved fibres is PRESERVED — it is the partial-evidence marker.
//   - deterministic: deduped and emitted in canonical taxonomy order, so ['down','polyester'] and
//     ['polyester','down'] store identically.
//
// Deliberately does NOT infer completeness or thermal sufficiency. Those are §5's verdict layer,
// and deriving them here would put semantics back inside the write path.
export function fiberContentNormalization(value) {
  const raw = Array.isArray(value) ? value : []
  const seen = new Set()
  const invalid = []
  for (const entry of raw) {
    const token = String(entry ?? '').toLowerCase().trim()
    if (!token) continue
    const canonical = FIBER_SYNONYMS[token] || token
    if (!FIBER_CANONICAL_INDEX.has(canonical)) {
      if (!invalid.includes(token)) invalid.push(token)
      continue
    }
    seen.add(canonical)
  }
  const values = [...seen].sort((a, b) => FIBER_CANONICAL_INDEX.get(a) - FIBER_CANONICAL_INDEX.get(b))
  return { values, invalid }
}

export function normalizeFiberContent(value = []) {
  return fiberContentNormalization(value).values
}

// ── Completeness: is the recorded composition the WHOLE composition? ─────────────────────────
//
// A separate, irreducible fact from the fibre list and from provenance. Three states, and the
// distinction that keeps them durable:
//
//   unknown   completeness was never established
//   partial   KNOWN to be incomplete — someone said "plus something I could not identify"
//   complete  explicitly VERIFIED complete
//
// 'partial' does not mean "contains some values". A list with fibres in it says nothing about
// whether more exist; if the writer does not know, the honest state is 'unknown'. And 'complete'
// is never inferred from the absence of an uncertainty marker — absence means the writer did not
// emit one. See docs/fiber-evidence-completeness-spec.md §6 and §11.
export const FIBER_COMPLETENESS_VALUES = ['unknown', 'partial', 'complete']

// Writer rules. Photo-only inference cannot see a lining or a fill, so it is not permitted to
// assert 'complete' no matter how confident it sounds — that is precisely the claim the black
// puffer's ["polyester","nylon"] made implicitly and got wrong. A tagger proposing 'complete' is
// downgraded to 'unknown' ("not established"), not to 'partial': proposing completeness is not
// evidence of incompleteness either.
//
// Only a human confirming the composition — reading a care label, or answering the editor's
// "is this the complete material composition?" — can write 'complete'. A manual assertion is
// protected from later retagging by the existing manual_overrides machinery, the same way every
// other manually-owned field is; this function deliberately does not reimplement that.
export const FIBER_COMPLETENESS_WRITERS = {
  tagger: ['unknown', 'partial'],
  manual: ['unknown', 'partial', 'complete'],
}

export function normalizeFiberCompleteness(value, { source = 'manual' } = {}) {
  const token = String(value ?? '').toLowerCase().trim()
  if (!FIBER_COMPLETENESS_VALUES.includes(token)) return null
  const permitted = FIBER_COMPLETENESS_WRITERS[source] || FIBER_COMPLETENESS_WRITERS.manual
  if (!permitted.includes(token)) return 'unknown'
  return token
}

// The completeness contract as the model is told it — ONE source for every photo-derived producer.
// Both photo schemas (the tagger in prompts.js and /extract-pieces in routes/ai.js) project this
// rather than restating it; §7.1 is the cautionary tale for what two hand-kept copies become.
//
// The last two sentences are load-bearing, not padding. "Use partial when unsure" or "assume
// partial for coats" would collapse 'partial' back into 'unknown' and undo the whole distinction.
export const FIBER_COMPLETENESS_SCHEMA_DESCRIPTION =
  "partial|unknown — whether the fiber_content list above describes the WHOLE garment. " +
  "Use 'partial' ONLY when the image gives positive evidence that additional material components " +
  "exist whose composition cannot be identified: visible lining, padding, quilting or baffles, " +
  "fill, or clearly distinct unidentified material panels. Otherwise use 'unknown'. Never emit " +
  "'complete' — a photograph cannot verify that nothing is hidden, and only a person reading a " +
  "care label can assert that. 'unknown' means completeness was not established; 'partial' means " +
  "the list is positively known not to describe the whole garment. Do not use 'partial' merely " +
  "because you are unsure, and do not assume it by category."
