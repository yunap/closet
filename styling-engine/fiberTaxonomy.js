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
  // The warmth-bearing family. `shearling` is a member in its own right, NOT a synonym for
  // fleece: 996868's shearling lining was recorded as ['fleece'] only because this list had no
  // token for it. It already existed as a fabric_category in INSULATING_FABRIC_CATEGORIES
  // (attributes.js), so the vocabularies disagreed about a material the wardrobe actually owns.
  insulating: ['wool', 'merino', 'cashmere', 'alpaca', 'mohair', 'fleece', 'shearling', 'down'],
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

// ── Composition completeness: REMOVED 2026-09-02 ─────────────────────────────────────────────
//
// Removed from this file: `FIBER_COMPLETENESS_VALUES`, `FIBER_COMPLETENESS_WRITERS`,
// `FIBER_COMPLETENESS_SCHEMA_DESCRIPTION`, `normalizeFiberCompleteness()` and
// `compositionEvidenceState()`. Named here so the docs that cite them still resolve to an
// explanation rather than to nothing. Retired on measurement,
// not opinion: `complete` was set on ZERO of 268 active pieces, so the `non_insulating` branch it
// gated had never executed on a real garment, and `partial` had no semantic readers at all — every
// one of its 10 rows already carried "unknown" inside fiber_content.
//
// The question it asked was unanswerable without a care label, which is why nobody ever answered
// it. It is replaced by two questions the owner can answer by opening the coat: interiorConstruction
// (below) and insulatingLayerMaterials. See docs/interior-construction-spec.md §5.
//
// Do NOT reintroduce a derived `partialComposition()` from "fiber_content contains unknown OR a
// layer exists OR construction exists". Those are three facts with three consequences, and
// recombining them rebuilds exactly the abstraction that was removed. Read the specific evidence.

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
  "shearling lining is 'shearling', a fleece one is 'fleece'). NEVER return an empty array: 'this garment " +
  "has no insulating layer' cannot be established from a photograph, so omit the field instead. " +
  "ORDINARY LINING DOES NOT COUNT — a plain lightweight polyester or acetate lining in a blazer, " +
  "dress or unlined-feeling jacket is not an insulating layer and must not be recorded here. " +
  "This is separate from fiber_content, which describes the FACE fabric."


// ── Interior construction: ordinary, non-insulating material assembly ────────────────────────
//
// The fact Closet had no field for. `996764 navy plaid jacket` is reversible — two full fabric
// faces, no fill — and the tagger, having seen substantial material inside, put ['unknown'] in
// insulating_layer_materials because that was the only field that accepts "there is material in
// here". Any non-empty value there means insulating BY DESIGN, so an ordinary construction
// observation was promoted to a thermal claim. See docs/interior-construction-spec.md.
//
// States:
//   unknown           construction not established. NOT equivalent to unlined.
//   unlined           confirmed: no separate ordinary lining and no second fabric face
//   partial_lining    an ordinary non-insulating lining covers part of the garment
//   full_lining       an ordinary lightweight non-insulating lining covers most of it
//   full_second_face  two substantial faces cover the same body area, neither being an
//                     insulating lining or fill — includes reversible construction
//
// ONE canonical state model: missing, null and invalid all collapse to `unknown`. Deliberately no
// null-vs-[] distinction like the insulating layer has — there, [] is a strong human assertion of
// absence; here "no lining" and "nobody has said" differ only in provenance, which the writer
// rules below already carry.
//
// full_second_face is separate from full_lining because the second face is part of the garment's
// PRIMARY fabric construction rather than a thin conventional lining, and carries more thermal
// capacity. The two lining depths are stored separately but scored identically for now (thermal.js)
// — representation may be finer than scoring; do not invent a magnitude for partial_lining until a
// real garment demands one.
//
// The fibre identity of an ordinary lining is NOT recorded and must not be asked. Polyester,
// acetate, silk or viscose are thermally irrelevant here — that is the whole reason this is a
// construction fact and not a second fibre list.
export const INTERIOR_CONSTRUCTION_VALUES = [
  'unknown', 'unlined', 'partial_lining', 'full_lining', 'full_second_face',
]

// Writer rules, mirroring the insulating layer's asymmetry for the same physical reason.
// A photograph can show that a lining or a second face EXISTS. It can never show that one is
// ABSENT: absence of a visible lining is not evidence of no lining, it is evidence of an exterior
// photograph. So `unlined` is owner-only.
// DERIVED, not hand-kept: the tagger may write everything except the one claim a photograph cannot
// support. Re-listing the permitted values would let this drift from INTERIOR_CONSTRUCTION_VALUES
// the moment a sixth value is added — the fibre taxonomy's §7.1 failure, in miniature.
export const INTERIOR_CONSTRUCTION_WRITERS = {
  tagger: INTERIOR_CONSTRUCTION_VALUES.filter(v => v !== 'unlined'),
  manual: INTERIOR_CONSTRUCTION_VALUES,
}

// Downgrade, not reject — the convention normalizeInsulatingLayerMaterials already follows when it
// turns a tagger's [] into null. A tagger asserting `unlined` becomes `unknown` ("not
// established"), never a different positive claim.
export function normalizeInteriorConstruction(value, { source = 'manual' } = {}) {
  const token = String(value ?? '').toLowerCase().trim()
  if (!INTERIOR_CONSTRUCTION_VALUES.includes(token)) return null
  const permitted = INTERIOR_CONSTRUCTION_WRITERS[source] || INTERIOR_CONSTRUCTION_WRITERS.manual
  return permitted.includes(token) ? token : 'unknown'
}

// THE canonical reader. Every consumer goes through this rather than touching the raw column, so
// the missing/null/invalid → 'unknown' collapse lives in exactly one place.
export function interiorConstruction(piece = {}) {
  const stored = String(piece?.interior_construction ?? '').toLowerCase().trim()
  return INTERIOR_CONSTRUCTION_VALUES.includes(stored) ? stored : 'unknown'
}

// Owner-facing wording, owned HERE rather than in the editor — the same reason FIBER_FAMILY_LABELS
// lives in this file. A second intake surface (BatchAdd, a future bulk editor) must show the same
// words, and a locally-maintained option list in a component is how the fibre vocabulary ended up
// with four disagreeing copies. The stored vocabulary never reaches the screen: no "interlining",
// "material assembly", "facing" or "batting". See docs/interior-construction-spec.md §8.
export const INTERIOR_CONSTRUCTION_LABELS = {
  unlined: 'Unlined',
  partial_lining: 'Regular lining — part of the garment',
  full_lining: 'Regular lining — most/all of the garment',
  full_second_face: 'Reversible / two full fabric layers',
  unknown: 'Not sure',
}

// The order the owner sees: the positive answers first, "Not sure" last. Derived from the canonical
// list so a new value appears in the editor automatically instead of being silently unofferable.
export const INTERIOR_CONSTRUCTION_OPTIONS = [
  ...INTERIOR_CONSTRUCTION_VALUES.filter(v => v !== 'unknown'),
  'unknown',
].map(value => ({ value, label: INTERIOR_CONSTRUCTION_LABELS[value] }))

export const INTERIOR_CONSTRUCTION_SCHEMA_DESCRIPTION =
  "unknown|partial_lining|full_lining|full_second_face — ordinary, NON-INSULATING interior " +
  "construction, which is a different question from insulating_layer_materials. Use 'full_lining' " +
  "when a separate ordinary lightweight lining covers most of the garment, 'partial_lining' when " +
  "it covers only part, and 'full_second_face' when the garment is reversible or built from two " +
  "substantial fabric faces covering the same area. Emit these ONLY with positive visual evidence " +
  "of the construction; otherwise 'unknown'. NEVER emit 'unlined' — the absence of a visible " +
  "lining in a photograph is not evidence that there is no lining, and only a person handling the " +
  "garment can establish that. Do not record a warm/fuzzy/pile lining or a quilted fill here; " +
  "that is insulating_layer_materials. Do not report the lining's fibre — it is not asked for."
