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
