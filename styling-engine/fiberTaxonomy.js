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

// Verdict 1 of 2. Answers ONLY: how complete is the recorded fibre composition?
// It says nothing about warmth — see thermalMaterialVerdict() in attributes.js for that.
//
// Reads the stored fact rather than inferring one. The absence of an "unknown" marker is not
// evidence of completeness, which is the whole reason fiber_content_completeness exists; a row
// that predates the column, or one nobody has answered for, is 'unknown'.
export function compositionEvidenceState(piece = {}) {
  const stored = String(piece?.fiber_content_completeness ?? '').toLowerCase().trim()
  return FIBER_COMPLETENESS_VALUES.includes(stored) ? stored : 'unknown'
}

// Values inside jewelry_material that are genuinely jewellery-specific. The tagger prompt already
// draws this line in its own wording — pearl/crystal/enamel are described as jewellery beads,
// accents and findings, while horn/shell/resin are described as "buttons, buckles, and hardware"
// and metal/wood are ordinary accessory hardware. Real usage agrees: across the wardrobe's 18
// accessories, jewellery-family values appear on the 8 jewelry pieces (stone, metal, glass, pearl,
// shell) and on NONE of the belts, bags, glasses or scarves.
//
// Kept as a filter rather than a family split, so the canonical FIBER_VALUES ordering — which the
// tagger prompt and VALID_FIBERS both project — is untouched.
const JEWELRY_ONLY_VALUES = new Set(['stone', 'ceramic', 'glass', 'pearl', 'crystal', 'enamel'])

// THE projection both intake surfaces use: which fibre families, and which members of them, this
// piece may be tagged with. Returns [family, values] pairs in canonical family order.
//
// `accessory` is a catch-all covering belts, bags, hats, scarves, watches, glasses and gloves as
// well as jewelry, so category alone is too coarse — offering `pearl` and `enamel` on a scarf is
// the same defect as offering them on a coat, just less obvious. Subtype narrows it.
export function fiberFamiliesForPiece(piece = {}) {
  const category = String(piece?.category || '').toLowerCase().trim()
  const isJewelry = String(piece?.accessory_subtype || '').toLowerCase().trim() === 'jewelry'
  const groups = []
  for (const [family, values] of Object.entries(FIBER_FAMILIES)) {
    if (!(FIBER_FAMILY_APPLICABILITY[family] || []).includes(category)) continue
    const usable = family === 'jewelry_material' && !isJewelry
      ? values.filter(v => !JEWELRY_ONLY_VALUES.has(v))
      : values
    if (usable.length) groups.push([family, usable])
  }
  return groups
}

// Presentation labels for the families, so both intake surfaces show the same headings rather than
// each inventing its own.
export const FIBER_FAMILY_LABELS = {
  plant_cellulose: 'Plant fibres',
  filament_protein: 'Silk',
  insulating: 'Warm / insulating',
  regenerated_cellulose: 'Regenerated cellulose',
  synthetic: 'Synthetics',
  constructed_textile: 'Leather & constructed textiles',
  jewelry_material: 'Jewellery & hardware',
  unresolved: 'Not determinable',
}

// ── The insulating layer ─────────────────────────────────────────────────────────────────────
//
// Materials of a thermally functional internal layer whose material may differ from the face
// fabric: a coat's fill, a warm boot's lining. Kept OUT of fiber_content, which has its own job as
// face-material evidence — pieceFiberBreathability() reads it to ask what the fabric does against
// skin, and 14 outerwear pieces have breathable shell fibres a fill entry would dilute.
//
// States, all distinct and all meaningful:
//   null          presence/composition unrecorded
//   []            explicitly verified: there is no insulating layer
//   ['unknown']   an insulating layer definitely exists; material unidentified
//   ['polyester'] an insulating layer exists, of polyester
//
// The name matters. This is not "fill" — naming it for one of its two cases would force exceptions
// like "a shearling lining counts as fill". And it makes the thermal rule true by definition: the
// engine never claims polyester is intrinsically warm, it reads that polyester OCCUPIES the
// insulating-layer role. See docs/material-role-representation-spec.md.
//
// ORDINARY LINING DOES NOT BELONG HERE. A plain polyester or acetate lining in a blazer is not an
// insulating layer. Recording one would make every lined garment read as insulated — the failure
// this field exists to prevent, inverted.

// Writer rules. A photograph can establish that an insulating layer EXISTS — quilting, baffles,
// visible loft, a pile lining — and usually cannot identify what it is made of. It can never
// establish ABSENCE: "there is no fill in here" is not observable from outside, so a tagger
// asserting [] is downgraded to null (unrecorded). Only a person, or a care label, can say [].
export function normalizeInsulatingLayerMaterials(value, { source = 'manual' } = {}) {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) return null
  if (!value.length) return source === 'tagger' ? null : []
  const { values } = fiberContentNormalization(value)
  // Everything dropped as out-of-vocabulary still means "a layer is there" — do not silently
  // collapse a positive observation into nothing because its material was misspelled.
  return values.length ? values : ['unknown']
}

// Reads the stored fact. Returns null when unrecorded, so callers can tell it from an explicit [].
export function insulatingLayerMaterials(piece = {}) {
  const raw = piece?.insulating_layer_materials
  if (raw === undefined || raw === null) return null
  if (Array.isArray(raw)) return raw
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export const INSULATING_LAYER_SCHEMA_DESCRIPTION =
  "array of materials from the same canonical list, describing a thermally functional INTERNAL " +
  "layer whose material differs from the face fabric — a coat's fill or wadding, a warm boot's " +
  "pile/shearling lining. Omit the field entirely (null) when you cannot tell. Use ['unknown'] " +
  "when construction positively shows an insulating layer — quilting, baffles, visible loft, a " +
  "fuzzy or pile interior — but you cannot identify what it is made of; that is a POSITIVE " +
  "answer and the common one. Name the material only when it is visually supportable (a visible " +
  "shearling or fleece lining is 'wool' or 'fleece'). NEVER return an empty array: 'this garment " +
  "has no insulating layer' cannot be established from a photograph, so omit the field instead. " +
  "ORDINARY LINING DOES NOT COUNT — a plain lightweight polyester or acetate lining in a blazer, " +
  "dress or unlined-feeling jacket is not an insulating layer and must not be recorded here. " +
  "This is separate from fiber_content, which describes the FACE fabric."
