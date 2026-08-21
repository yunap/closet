// Attributes Module
// Acts as the single entry point for interpreting garment text when structured metadata is not yet populated.
import { ACCENT_COLOR_NAMES, colorTaxonomyEntry } from '../lib/colorTaxonomy.js'
import { confidenceFromProfile } from './taggerMerge.js'

export const FIBER_VALUES = ['wool', 'merino', 'cashmere', 'alpaca', 'mohair', 'fleece', 'down',
  'cotton', 'linen', 'silk', 'tencel', 'modal', 'rayon', 'viscose', 'polyester', 'nylon',
  'acrylic', 'spandex', 'leather', 'suede', 'denim', 'unknown']
export const INSULATING_FIBERS = new Set(['wool', 'merino', 'cashmere', 'alpaca', 'mohair', 'fleece', 'down'])
export const FORMALITY_VALUES = ['lounge', 'everyday', 'elevated', 'dressy']
export const HEEL_HEIGHT_VALUES = ['flat', 'low', 'mid', 'high']
export const WALK_SUPPORT_VALUES = ['high', 'medium', 'low']
export const GATE_CRITICAL_FIELDS = ['formality', 'fabric_weight', 'visual_weight', 'fiber_content', 'occasions', 'heel_height', 'walk_support']

const STRUCTURE_FIT_CONFIDENCE_FIELDS = new Set([
  'silhouette',
  'fit_on_body',
  'tuck_behavior',
  'waistband_type',
  'sleeve_length',
  'sleeve_shape'
])

export function getFieldConfidence(piece, field) {
  const confidence = String(confidenceFromProfile(piece, field) || '').toLowerCase()
  if (['manual', 'high', 'medium', 'low'].includes(confidence)) return confidence
  return piece?.tag_state === 'provisional' && STRUCTURE_FIT_CONFIDENCE_FIELDS.has(field) ? 'low' : 'medium'
}

function trustedField(piece, field) {
  const confidence = getFieldConfidence(piece, field)
  return confidence === 'manual' || confidence === 'high' || confidence === 'medium'
}

export function attributePieceTextBlob(p) {
  if (!p) return ''
  const colors = Array.isArray(p.colors) ? p.colors : []
  const occasions = Array.isArray(p.occasions) ? p.occasions : []
  const rules = Array.isArray(p.styling_rules_learned) ? p.styling_rules_learned : []
  return [
    p.name || '',
    p.category || '',
    colors.join(' '),
    p.background_color || '',
    p.reads_as || '',
    occasions.join(' '),
    p.season || '',
    p.pattern_type || '',
    p.pattern_scale || '',
    p.pattern_complexity || '',
    trustedField(p, 'silhouette') ? p.silhouette || '' : '',
    p.shoe_type || '',
    p.toe_shape || '',
    p.fabric_category || '',
    p.fabric_weight || '',
    ...(Array.isArray(p.fiber_content) ? p.fiber_content : []),
    trustedField(p, 'fit_on_body') ? p.fit_on_body || '' : '',
    trustedField(p, 'tuck_behavior') ? p.tuck_behavior || '' : '',
    trustedField(p, 'waistband_type') ? p.waistband_type || '' : '',
    p.accessory_subtype || '',
    p.jewelry_type || '',
    p.necklace_length || '',
    p.bottom_subtype || '',
    p.notes || '',
    p.engine_notes || '',
    rules.join(' ')
  ].filter(Boolean).join(' ').toLowerCase()
}

export function textIncludesAny(value, words) {
  const haystack = String(value || '').toLowerCase()
  return words.some(w => haystack.includes(String(w).toLowerCase()))
}

export function fabricWeight(p) {
  if (p.fabric_weight) {
    const fw = String(p.fabric_weight).toLowerCase().trim()
    if (fw === 'heavy') return 'heavy'
    if (fw === 'ultralight' || fw === 'light' || fw === 'lightweight') return 'light'
    if (fw === 'medium') return 'medium'
  }
  return null
}

export const pieceFabricWeight = fabricWeight

const WARMTH_TIER_ORDER = ['light', 'medium', 'heavy']
function stepWarmthTier(tier, delta) {
  const idx = WARMTH_TIER_ORDER.indexOf(tier)
  if (idx === -1) return tier
  return WARMTH_TIER_ORDER[Math.min(WARMTH_TIER_ORDER.length - 1, Math.max(0, idx + delta))]
}

// The single derived garment-warmth interpretation — used by both the wardrobe page's Warmth
// filter and weatherFitForPiece (rules.js), which used to duplicate a slightly different version
// of this same logic.
//
// fabric_weight is textile SUBSTANCE, not a warmth verdict on its own — a medium-weight cotton
// knit made into a sleeveless summer dress is not the same thermal garment as the same fabric
// made into a long-sleeve top. When fabric_weight is directly tagged, it is the starting point,
// then two independent, physically-real signals can move it by a tier each:
//   +1 for an insulating MATERIAL — fiber content (wool, cashmere...) or fabric_category (tweed,
//      corduroy...), since either field alone can carry the signal. A lightweight wool knit still
//      runs warmer than lightweight cotton.
//   -1 for a bare cut (sleeveless, halter/strapless, mini/thigh-length) — skin exposure genuinely
//      reduces how insulating a garment is regardless of the cloth it's cut from. This is the
//      owner-flagged fix for a real gap: a medium-weight sleeveless dress was reading as "medium"
//      warmth with no way for its bare cut to pull that down, the same shape of bug as the
//      hemline-inflates-warmth issue below, just on the low side instead of the high side.
// The two offset when both apply (a medium wool sleeveless dress nets back to medium — the
// insulating fabric and the bare cut roughly cancel), and stepWarmthTier clamps at light/heavy
// either way, so a heavy sleeveless wool dress lands at medium, not light — the exposed skin
// makes it less warm than a heavy long-sleeve wool piece, not as cool as an unlined cotton one.
//
// Coverage (full-length/long-sleeve) and bareness together are consulted as a full FALLBACK only
// when fabric_weight is completely untagged — there is no fabric substance to start from, so hem
// and sleeve length are the only evidence available at all. Once fabric_weight is tagged, coverage
// specifically adds nothing further: a medium-weight ankle-length cotton pant is not heavier for
// reaching the ankle rather than being cropped; it's the same fabric covering more leg. This is
// the owner-ruled fix for a real regression: "full-insulating" coverage was treated as independent
// evidence and could push an already medium-weight piece to "heavy" purely for its hemline (twill
// wide-leg pants, real wardrobe piece 129) — the same flaw already fixed for 'ankle' specifically
// was still live for maxi/floor/full-length. Bareness, unlike coverage, keeps working as a tier
// modifier even once fabric_weight is known, per above — only coverage becomes moot at that point.
//
// Returns null only when fabric_weight, insulating material, coverage, AND bareness are all
// silent — an honest "unknown," never a guess.
export function pieceWarmthTier(p) {
  // fabric_weight on a shoe/accessory describes construction substance (a chunky-heel sandal
  // tagged 'heavy'), not thermal insulation — an open-toe sandal doesn't run warmer for being
  // sturdily built. This is the same category boundary missingGateFields already draws
  // ("visual_weight supersedes fabric_weight for shoes/accessory"); warmth-as-body-insulation
  // just isn't a real axis for footwear/accessories the way it is for garments, so this returns
  // an honest unknown rather than reading a field tagged for a different purpose.
  if (isShoePiece(p) || isAccessoryPiece(p)) return null
  const fw = fabricWeight(p)
  const insulatingMaterial = pieceHasInsulatingMaterial(p)
  const bare = pieceBareness(p) === 'high'
  if (fw) {
    const delta = (insulatingMaterial ? 1 : 0) - (bare ? 1 : 0)
    return delta ? stepWarmthTier(fw, delta) : fw
  }
  if (insulatingMaterial) return 'heavy'
  if (pieceCoverage(p) === 'full') return 'medium'
  if (bare) return 'light'
  return null
}

export function formalityRank(value) {
  const normalized = String(value || '').toLowerCase().trim()
  const idx = FORMALITY_VALUES.indexOf(normalized)
  return idx === -1 ? null : idx
}

export function pieceFormality(p) {
  const normalized = String(p?.formality || '').toLowerCase().trim()
  return formalityRank(normalized) !== null ? normalized : null
}

export function pieceHeelHeight(p) {
  const normalized = String(p?.heel_height || '').toLowerCase().trim()
  return HEEL_HEIGHT_VALUES.includes(normalized) ? normalized : null
}

export function pieceWalkSupport(p) {
  const normalized = String(p?.walk_support || '').toLowerCase().trim()
  return WALK_SUPPORT_VALUES.includes(normalized) ? normalized : null
}

function isPopulated(value) {
  if (Array.isArray(value)) return value.length > 0
  return value !== null && value !== undefined && String(value).trim() !== ''
}

function isShoePiece(piece = {}) {
  const category = String(piece.category || '').toLowerCase().trim()
  return category === 'shoe' || category === 'shoes'
}

function isAccessoryPiece(piece = {}) {
  return String(piece.category || '').toLowerCase().trim() === 'accessory'
}

function isBottomPiece(piece = {}) {
  return String(piece.category || '').toLowerCase().trim() === 'bottom'
}

export function pieceJewelryType(p) {
  if (String(p?.accessory_subtype || '').toLowerCase().trim() !== 'jewelry') return null
  const normalized = String(p?.jewelry_type || '').toLowerCase().trim()
  return normalized || null
}

export function missingGateFields(piece = {}) {
  const missing = []
  if (!isPopulated(piece.formality)) missing.push('formality')
  // visual_weight supersedes fabric_weight for shoes/accessory — the clothing
  // weight scale (ultralight/light/.../heavy) never applied to them; they now
  // have their own gate-critical field instead.
  if (isShoePiece(piece) || isAccessoryPiece(piece)) {
    if (!isPopulated(piece.visual_weight)) missing.push('visual_weight')
  } else if (!isPopulated(piece.fabric_weight)) {
    missing.push('fabric_weight')
  }
  if (!isPopulated(piece.fiber_content)) missing.push('fiber_content')
  // Intake treats empty occasions as a curation prompt; later activity gates may treat absence as a weaker statement.
  if (!isPopulated(piece.occasions)) missing.push('occasions')
  if (isShoePiece(piece)) {
    if (!isPopulated(piece.heel_height)) missing.push('heel_height')
    if (!isPopulated(piece.walk_support)) missing.push('walk_support')
    if (!isPopulated(piece.shoe_type)) missing.push('shoe_type')
  }
  if (isAccessoryPiece(piece)) {
    if (!isPopulated(piece.accessory_subtype)) missing.push('accessory_subtype')
  }
  if (isBottomPiece(piece)) {
    if (!isPopulated(piece.bottom_subtype)) missing.push('bottom_subtype')
  }
  return missing
}

// Deliberately does not read style_profile_json.bareness: bareness/coverage as their own authored
// judgment call were never reliably tagged (audit showed "unknown" confidence wardrobe-wide). These
// are derived only from sleeve_length, neckline, and length_hits_at — concrete, independently-tagged,
// visually checkable fields — per the gate-hardening spec that dropped the vaguer standalone category.
// sleeve_type used to be checked with a regex against tank/strapless/halter/camisole — words that
// were never actually valid sleeve_type values, so only "sleeveless" itself ever matched in
// practice. Now that halter/strapless are real neckline values (not sleeve values), check both
// fields on their own terms instead of hoping one field's free text contains another axis's word.
//
// Real regression: "light grey and brown knit cardigan" (piece 131, category outerwear) — cashmere,
// fabric_weight: medium, length_hits_at: mid_thigh — landed in the "Versatile" weather-fit bucket
// instead of "Good for cold" because this match used to include 'mid_thigh', flipping bareness to
// 'high' and cancelling out the insulating-material tier bump. length_hits_at is a genuinely
// PER-CATEGORY vocabulary (docs/garment-field-reference.md, 2026-08-14 taxonomy split): for
// dress/skirt and pants, a short value like 'mini'/'shorts' means a hem that exposes leg skin, but
// 'mid_thigh' isn't even in that vocabulary — it's outerwear-only, where length_hits_at describes
// how far DOWN a coat/cardigan extends (waist < hip < mid_thigh < knee), the opposite direction
// from bareness — a mid-thigh-length cardigan is a LONGER, more covering piece than a hip-length
// one, not a bare one (confirmed by real data: piece 996760 "fleece coat", length_hits_at:
// mid_thigh). 'upper_thigh' isn't a valid value in any current category's schema at all — dead
// text from before the per-category split. Only 'mini'/'shorts' remain: both are still real,
// current bare-hemline values in the dress/skirt and pants vocabularies respectively.
export function pieceBareness(p) {
  if (p?.sleeve_length === 'sleeveless') return 'high'
  if (p?.neckline && /\b(halter|strapless)\b/i.test(p.neckline)) return 'high'
  // 'shorts' (pants vocab, plural) doesn't match a strict word-boundary regex tuned for the
  // singular spelling — 'short' with a trailing \b never matches inside "shorts" since both are
  // word characters. Match the stem instead.
  if (p?.length_hits_at && /\b(mini|shorts?)\b/i.test(p.length_hits_at)) {
    return 'high'
  }
  return null
}

// Fibers with essentially no natural/cellulosic breathability on their own — a garment made
// ENTIRELY from these (no cotton/linen/wool/rayon/etc mixed in) runs close to airtight against
// skin. Not the same list as INSULATING_FIBERS: spandex/nylon/polyester don't trap body heat the
// way wool does, they just don't wick or breathe — a fully-synthetic piece can be cool in
// substance (fabric_weight: light) and still poor at ventilating a close-fitting cut.
const NON_BREATHABLE_ONLY_FIBERS = new Set(['polyester', 'nylon', 'acrylic', 'spandex', 'leather', 'suede'])

function pieceFiberIsAllNonBreathable(p) {
  const fibers = (Array.isArray(p?.fiber_content) ? p.fiber_content : [])
    .map(f => String(f).toLowerCase().trim())
    .filter(f => f && f !== 'unknown')
  if (!fibers.length) return false
  return fibers.every(f => NON_BREATHABLE_ONLY_FIBERS.has(f))
}

// Real regression: "floral botanical print active leggings" — fabric_weight: light,
// fabric_category: technical/performance, fiber_content: polyester/nylon/spandex, fit_on_body:
// clings_stretchy — scored a full hot-weather "lightweight, good for heat" bonus in
// weatherFitForPiece despite being skin-tight synthetic fabric with essentially no airflow.
// Coverage/insulating-material (pieceCoverage, pieceHasInsulatingMaterial) already capture fabric
// substance and hem/sleeve extent; neither one captures how CLOSE the fabric sits to skin, which
// is a real, independent factor in whether a lightweight piece actually ventilates.
//
// A close fit ALONE is not enough — 26 of the 30 real wardrobe tops/bottoms tagged
// fit_on_body: clings_stretchy/clings_drapey are ordinary cotton tees and knits (a fitted cotton
// crew tee genuinely clings, but cotton still breathes fine). What actually made the leggings
// occlusive was the fabric having NO natural fiber at all — fully synthetic construction, not
// closeness of fit by itself. So this requires both: a close cut, AND either an all-synthetic
// fiber_content or fabric_category: technical/performance (the fallback for pieces where
// fiber_content is untagged but the category itself already says activewear).
export function pieceHasOcclusiveFit(p) {
  const fit = String(p?.fit_on_body || '').toLowerCase().trim()
  const closeFit = fit === 'clings_stretchy' || fit === 'clings_drapey'
  if (!closeFit) return false
  if (pieceFiberIsAllNonBreathable(p)) return true
  return String(p?.fabric_category || '').toLowerCase().trim() === 'technical/performance'
}

// Physical coverage — how much body area the garment's sleeve/hem extends over. Deliberately NOT
// a warmth conclusion: whether "full" coverage actually means anything for warmth depends on the
// fabric it's made of (a full-length silk skirt is not a warm layer), so callers that care about
// warmth read this as one secondary input into pieceWarmthTier, not as its own verdict.
export function pieceCoverage(p) {
  if (p?.sleeve_length === 'long' || p?.sleeve_length === 'extra_long') {
    return 'full'
  }
  // Underscore counts as a word character, so a plain \bfull\b/\bfloor\b never
  // matches inside the new 'full_length'/'floor_length' pants values — there's
  // no \w/\W transition at the underscore for \b to anchor on. Match the
  // underscore-joined forms explicitly instead of relying on \b alone.
  // 'ankle' deliberately excluded (owner ruling): hem length alone isn't coverage evidence worth
  // acting on — ankle is where ordinary trousers end, not an exceptional length. Reserve this for
  // genuinely long coverage (floor-length, maxi).
  if (p?.length_hits_at && /\b(full[-_]length|floor[-_]length|maxi)\b/i.test(p.length_hits_at)) {
    return 'full'
  }
  return null
}

// fabric_category (tweed, corduroy, shearling, flannel — categories, not fiber names) and
// fiber_content (wool, cashmere...) are tagged independently, and real wardrobe data has pieces
// where one names the insulating material and the other reads "unknown" or omits it (a wool
// cardigan tagged fiber_content: ["unknown"], a fleece hoodie tagged fiber_content: ["cotton"]).
// Checking fiber_content alone silently missed those — this checks both, so a piece needs only
// ONE of the two fields to correctly name the material.
const INSULATING_FABRIC_CATEGORIES = new Set(['wool', 'cashmere', 'fleece', 'tweed', 'corduroy', 'shearling', 'flannel', 'sweatshirt fleece'])
export function pieceHasInsulatingMaterial(p) {
  const fibers = Array.isArray(p?.fiber_content) ? p.fiber_content : []
  if (fibers.some(f => INSULATING_FIBERS.has(String(f).toLowerCase().trim()))) return true
  return INSULATING_FABRIC_CATEGORIES.has(String(p?.fabric_category || '').toLowerCase().trim())
}

// Wet-exposure suitability is physical garment truth, not taste. Keep this reader
// strictly on structured material fields so a name or note cannot silently create
// a hard gate. Pieces whose visible name says canvas but whose material metadata
// says cotton must be retagged rather than inferred here.
export function pieceHasWetSensitiveFootwearMaterial(p = {}) {
  if (wardrobeCategoryGroup(p) !== 'shoes') return false
  const materials = new Set([
    String(p.fabric_category || '').toLowerCase().trim(),
    ...(Array.isArray(p.fiber_content) ? p.fiber_content : []).map(value => String(value || '').toLowerCase().trim()),
  ].filter(Boolean))
  return materials.has('canvas') || materials.has('suede') || materials.has('nubuck')
}

export function shoeCoverage(p) {
  if (wardrobeCategoryGroup(p) !== 'shoes') return null
  const structured = String(p?.shoe_coverage || p?.style_profile_json?.shoe_coverage || '').toLowerCase().trim()
  if (['open', 'closed'].includes(structured)) return structured

  // TODO: backfill shoe_coverage. This fallback belongs here because attributes.js
  // is the sole garment-text interpretation boundary.
  const text = `${p?.name || ''} ${p?.reads_as || ''}`.toLowerCase()
  if (/\b(open[- ]toe|peep[- ]toe|sandal|slide)\b/.test(text)) return 'open' // ratchet-allow: TODO backfill shoe_coverage fallback at the garment interpretation boundary
  if (/\b(sneaker|athletic|trainer|loafer|slip[- ]on|boot|closed[- ]toe|lace[- ]up)\b/.test(text)) return 'closed' // ratchet-allow: TODO backfill shoe_coverage fallback at the garment interpretation boundary
  return null
}

const SKIRT_LENGTH_MINI = new Set(['short', 'above-knee', 'knee', 'cropped'])
const SKIRT_LENGTH_MAXI = new Set(['maxi', 'ankle', 'full-length'])

// Length granularity for a skirt/skort comes from length_hits_at (the shared,
// already-tagged field), not from bottom_subtype itself — bottom_subtype is
// deliberately type-only (see db.js), so a skirt's mini/midi/maxi read is
// derived here rather than baked into the subtype enum.
function skirtGranularityFromLength(lengthHitsAt) {
  const length = String(lengthHitsAt || '').toLowerCase().trim()
  if (SKIRT_LENGTH_MINI.has(length)) return 'skirt-mini'
  if (SKIRT_LENGTH_MAXI.has(length)) return 'skirt-maxi'
  return 'skirt-midi'
}

export function bottomKind(p) {
  const category = String(p.category || '').toLowerCase().trim()
  if (category !== 'bottom') return null

  const subtype = String(p.bottom_subtype || '').toLowerCase().trim()
  if (subtype === 'shorts') return 'shorts'
  if (subtype === 'skirt') return skirtGranularityFromLength(p.length_hits_at)
  if (['pants', 'culottes', 'overalls', 'other'].includes(subtype)) return 'pants'

  // Not yet tagged with bottom_subtype (or tagged 'unknown') — fall back to the
  // pre-existing name/reads_as heuristics rather than leaving the piece
  // unclassified.
  if (p.style_profile_json?.bottom_kind) {
    const bk = String(p.style_profile_json.bottom_kind).toLowerCase().trim()
    if (['pants', 'shorts', 'skirt-mini', 'skirt-midi', 'skirt-maxi'].includes(bk)) return bk
  }

  const name = String(p.name || '').toLowerCase()
  const readsAs = String(p.reads_as || '').toLowerCase()
  const combined = `${name} ${readsAs} ${p.length_hits_at || ''}`.toLowerCase()

  if (/\b(shorts?|skort|cut-offs?)\b/i.test(name) || /\b(shorts?|skort)\b/i.test(readsAs)) {
    return 'shorts'
  }

  if (/\b(skirt|skort)\b/i.test(name) || /\bskirt\b/i.test(readsAs)) {
    if (/\b(mini|knee-length|knee length|short|skort)\b/i.test(combined)) {
      return 'skirt-mini'
    }
    if (/\b(maxi|ankle|floor)\b/i.test(combined)) {
      return 'skirt-maxi'
    }
    return 'skirt-midi'
  }

  if (/\b(pants?|jeans?|trousers?|leggings?|tights?|culottes?)\b/i.test(combined)) {
    return 'pants'
  }

  return 'pants' // default bottom is pants
}

export function colorFamily(p) {
  // TODO: backfill color_family
  const colors = (p.colors || []).map(c => String(c).toLowerCase())
  const darkAnchorList = ['black', 'navy', 'denim', 'charcoal', 'dark grey', 'dark gray', 'deep navy', 'chocolate', 'dark blue', 'espresso']
  const warmEarthList = ['brown', 'tan', 'cognac', 'rust', 'terracotta', 'mustard', 'ochre', 'olive', 'amber', 'plum', 'burgundy']
  const softNeutralList = ['white', 'cream', 'beige', 'taupe', 'oatmeal', 'ivory', 'nude', 'light grey', 'light gray', 'soft white', 'sand']
  if (colors.length > 0) {
    if (colors.some(c => darkAnchorList.includes(c))) return 'dark-anchor'
    if (colors.some(c => warmEarthList.includes(c))) return 'warm-earth'
    if (colors.some(c => softNeutralList.includes(c))) return 'soft-neutral'
    if (colors.some(c => colorTaxonomyEntry(c).neutrality === 'accent')) return 'accent'
  }

  const text = `${p.name || ''} ${p.reads_as || ''}`.toLowerCase()
  if (new RegExp(`\\b(${darkAnchorList.join('|')}|dark denim)\\b`).test(text)) return 'dark-anchor'
  if (new RegExp(`\\b(${warmEarthList.join('|')})\\b`).test(text)) return 'warm-earth'
  if (new RegExp(`\\b(${softNeutralList.join('|')}|light)\\b`).test(text)) return 'soft-neutral'
  if (new RegExp(`\\b(${ACCENT_COLOR_NAMES.join('|')})\\b`).test(text)) return 'accent'

  return 'other'
}

export function patternLoudness(p) {
  // TODO: backfill pattern_complexity
  if (p.pattern_complexity) {
    const pc = String(p.pattern_complexity).toLowerCase().trim()
    if (pc === 'solid' || pc === 'plain') return 'solid'
    if (['quiet', 'medium', 'loud'].includes(pc)) return pc
  }
  const text = `${p.name || ''} ${p.reads_as || ''} ${p.pattern_type || ''}`.toLowerCase()
  if (/\b(solid|plain|monochrome|uniform)\b/.test(text)) return 'solid'
  if (/\b(graphic|bold|statement|loud|colorblock|multi|abstract|loud print|contrast stripe)\b/.test(text)) return 'loud'
  if (/\b(floral|print|pattern|stripe|stripes|striped|plaid|polka|check|checked|lace|embroidered|applique|crochet|patterned)\b/.test(text)) return 'medium'
  if (/\b(texture|textured|ribbed|knit|heather|quiet|subtle|marled|waffle|pointelle)\b/.test(text)) return 'quiet'
  return 'solid'
}

export function isExpressiveForAnchor(p) {
  const loudness = patternLoudness(p)
  if (loudness === 'loud' || loudness === 'medium') {
    // Exclude knit casual basics (tees, sweatshirts, hoodies) from anchor-gate expressiveness
    const kind = garmentKind(p)
    if (kind === 'tee' || kind === 'sweatshirt' || kind === 'hoodie') {
      return false
    }
    return pieceSoftness(p) >= 1
  }
  return false
}

export function pieceSoftness(p) {
  const readsAs = String(p.reads_as || '').toLowerCase()
  const name = String(p.name || '').toLowerCase()
  const profile = p.style_profile_json || {}
  const bestUse = String(profile.style_notes?.best_use || '').toLowerCase()
  const lanes = profile.style_lanes || {}
  const drapeNotes = String(profile.real_wear_notes?.drape || '').toLowerCase()
  const fitNotes = String(profile.real_wear_notes?.fit || '').toLowerCase()

  const delicacyKeywords = ['sheer', 'lace', 'silk', 'chiffon', 'gauze', 'drapey', 'drape', 'satin', 'delicate', 'romantic']
  const hasDelicacySignal = 
    textIncludesAny(readsAs, delicacyKeywords) ||
    textIncludesAny(name, delicacyKeywords) ||
    textIncludesAny(bestUse, delicacyKeywords) ||
    (lanes.romantic_soft > 0) ||
    (lanes.boho_romantic > 0) ||
    textIncludesAny(drapeNotes, ['drape', 'fluid', 'soft', 'flow', 'flowing']) ||
    textIncludesAny(fitNotes, ['drape', 'fluid', 'soft', 'flow', 'flowing'])

  let softnessScore = 0
  if (hasDelicacySignal) {
    softnessScore += 2
  }

  // Fabric weight as a secondary contributor
  if (fabricWeight(p) === 'light') {
    softnessScore += 1
  }

  // If there are general softness keywords in reads_as or name but no primary delicacy signal
  if (!hasDelicacySignal) {
    if (textIncludesAny(readsAs, ['relaxed', 'loose', 'soft']) || textIncludesAny(name, ['relaxed', 'loose', 'soft'])) {
      softnessScore += 1
    }
  }

  return softnessScore
}

export function pieceGroundingValue(p) {
  const blob = attributePieceTextBlob(p)
  const colors = (p.colors || []).map(c => String(c).toLowerCase())
  const dark = colors.some(c => ['black','navy','denim','brown','charcoal','dark grey','dark gray','deep navy','chocolate'].includes(c)) || textIncludesAny(blob, ['black','navy','dark denim','dark blue','charcoal','brown','chocolate'])
  const light = colors.some(c => ['white','cream','beige','taupe','oatmeal','ivory','nude'].includes(c)) || textIncludesAny(blob, ['white','cream','beige','oatmeal','ivory','nude','light'])
  const denseTexture = fabricWeight(p) === 'heavy' || textIncludesAny(blob, ['denim','corduroy','wool','twill','utility','canvas','leather','structured','pencil','maxi','crochet','heavy','substantial','ribbed'])
  const airyTexture = fabricWeight(p) === 'light' || textIncludesAny(blob, ['lace','gauzy','chiffon','sheer','silk','satin','delicate','soft floral','airy','lightweight'])

  const bKind = bottomKind(p)
  const isMini = bKind === 'skirt-mini' || bKind === 'shorts'
  const isMaxi = bKind === 'skirt-maxi'
  const isMidi = bKind === 'skirt-midi'

  const longLine = isMaxi || isMidi || textIncludesAny(blob, ['maxi','midi','full length','full-length','long','straight','flare','bootcut','wide-leg','wide leg','column','pencil'])
  const abrupt = isMini || textIncludesAny(blob, ['mini','short','cropped','crop','knee-length','knee length'])

  let grounding = 0
  if (dark) grounding += 3
  if (denseTexture) grounding += 2
  if (longLine) grounding += 2
  if (light) grounding -= 1
  if (airyTexture) grounding -= 2
  if (abrupt) grounding -= 2

  // Fix B: Grounding accounts for garment length/coverage
  // Shorts and mini-length bottoms cap at 2 regardless of fabric density
  if (p.category === 'bottom' && isMini) {
    return Math.min(grounding, 2)
  }

  return grounding
}

export function pieceStructureValue(p) {
  const blob = attributePieceTextBlob(p)
  const denseTexture = fabricWeight(p) === 'heavy' || textIncludesAny(blob, ['denim','corduroy','wool','twill','utility','canvas','leather','structured','pencil','maxi','crochet','heavy','substantial','ribbed'])
  return (denseTexture ? 2 : 0) + (textIncludesAny(blob, ['tailored','structured','utility','straight','pencil','crisp','button-up','button down','button-down']) ? 1 : 0)
}

export function groundingLevel(p) {
  const grounding = pieceGroundingValue(p)
  if (grounding >= 4) return 3
  if (grounding >= 2) return 2
  if (grounding >= 0) return 1
  return 0
}

export function styleLanes(p) {
  const blob = attributePieceTextBlob(p)
  const lanes = []
  if (textIncludesAny(blob, ['utility','olive','canvas','twill','cognac','linen','earthy'])) lanes.push('relaxed earthy')
  if (textIncludesAny(blob, ['tailored','trouser','button-up','button down','pencil','loafer','blazer'])) lanes.push('soft structured')
  if (textIncludesAny(blob, ['crochet','appliqué','applique','lace','embroidered','woven','artisan','textured'])) lanes.push('artistic textured')
  if (textIncludesAny(blob, ['pink','pastel','kawaii','mini','playful','bright floral'])) lanes.push('controlled playful')
  if (textIncludesAny(blob, ['navy','pinstripe','loafer','pencil','button-up','button down','preppy'])) lanes.push('modern preppy')
  return [...new Set(lanes)].slice(0, 3)
}

export function garmentKind(p) {
  const category = String(p.category || '').toLowerCase().trim()
  if (category === 'shoes') return 'shoes'
  if (category === 'accessory') return 'accessory'
  if (category === 'dress' || category === 'jumpsuit') return 'dress'

  const text = `${p.name || ''} ${p.reads_as || ''}`.toLowerCase()

  if (category === 'outerwear') {
    if (/\bcoat\b/.test(text)) return 'coat'
    if (/\bblazer\b/.test(text)) return 'blazer'
    if (/\bcardigan\b/.test(text)) return 'cardigan'
    if (/\bvest\b/.test(text)) return 'vest'
    if (/\b(jacket|bomber|trench|parka|windbreaker)\b/.test(text)) return 'jacket'
    return 'jacket'
  }

  if (category === 'top') {
    if (/\b(button-up|button-down|button shirt|buttonup|buttondown|button-front|button front|collared shirt)\b/.test(text)) return 'button-shirt'
    if (/\b(t-shirt|tee|graphic tee)\b/.test(text)) return 'tee'
    if (/\btunic\b/.test(text)) return 'tunic'
    if (/\b(tank|cami|camisole|shell|sleeveless top|halter)\b/.test(text)) return 'tank'
    if (/\b(sweater|knitwear|pullover|turtleneck)\b/.test(text)) return 'sweater'
    if (/\bcardigan\b/.test(text)) return 'cardigan'
    if (/\bhoodie\b/.test(text)) return 'hoodie'
    if (/\bsweatshirt\b/.test(text)) return 'sweatshirt'
    return 'tee'
  }

  return 'other'
}

export function wardrobeCategoryGroup(pieceOrCategory = '') {
  const raw = typeof pieceOrCategory === 'string'
    ? pieceOrCategory
    : (pieceOrCategory?.category || pieceOrCategory?.type || pieceOrCategory?.name || '')
  const value = String(raw || '').toLowerCase().trim()
  if (/\b(top|shirt|blouse|tee|t-shirt|tank|shell|sweater|knit|cardigan as top|tunic|hoodie|sweatshirt)\b/.test(value) || /tops?/.test(value)) return 'top'
  if (/\b(bottom|pant|trouser|jean|skirt|short|culotte|legging)\b/.test(value) || /bottoms?/.test(value)) return 'bottom'
  if (/\b(dress|jumpsuit)\b/.test(value) || /dresses/.test(value)) return 'dress'
  if (/\b(outerwear|jacket|cardigan|coat|blazer|vest|overshirt|kimono)\b/.test(value)) return 'outerwear'
  if (/\b(shoe|boot|flat|loafer|sandal|sneaker|heel|mule|clog)\b/.test(value) || /shoes/.test(value)) return 'shoes'
  if (/\b(accessor|necklace|pendant|earring|bracelet|bag|tote|belt|scarf|watch|ring)\b/.test(value)) return 'accessory'
  return value || 'other'
}

export function isAccessory(p) {
  return wardrobeCategoryGroup(p) === 'accessory'
}

export function isOuterwear(p) {
  return wardrobeCategoryGroup(p) === 'outerwear'
}

export function isTop(p) {
  return wardrobeCategoryGroup(p) === 'top'
}

function getOccasionConfidence(piece, occasion) {
  try {
    const profile = typeof piece?.style_profile_json === 'string'
      ? JSON.parse(piece.style_profile_json)
      : piece?.style_profile_json
    const info = profile?.garment_intelligence || {}
    const confMap = info.occasion_confidence || {}
    return String(confMap[occasion] || '').toLowerCase().trim()
  } catch (err) {
    return ''
  }
}

export function pieceOccasionScore(piece = {}, occasion = '') {
  const requested = String(occasion || '').toLowerCase().trim()
  if (!requested) return 0
  
  const occasions = Array.isArray(piece.occasions) 
    ? piece.occasions.map(o => String(o).toLowerCase()) 
    : []
  const confidence = getOccasionConfidence(piece, requested)
  
  if (confidence === 'high') return 15
  if (occasions.includes(requested) && confidence !== 'low') return 12
  if (confidence === 'medium') return 10
  if (confidence === 'low') return -15
  return 0
}

export function isDarkPiece(p) {
  if (!p) return false
  const colors = (p.colors || []).map(c => String(c).toLowerCase())
  const lightColors = ['white', 'cream', 'beige', 'taupe', 'oatmeal', 'ivory', 'nude', 'light grey', 'light gray', 'soft white', 'sand', 'light blue']
  if (colors.some(c => lightColors.includes(c))) return false

  const blob = attributePieceTextBlob(p)
  if (/\b(white|cream|beige|taupe|oatmeal|ivory|nude|light|pale|sand)\b/i.test(blob)) return false

  const darkColors = ['black', 'navy', 'denim', 'charcoal', 'dark grey', 'dark gray', 'deep navy', 'chocolate', 'dark blue', 'espresso', 'brown']
  if (colors.some(c => darkColors.includes(c))) return true

  return /\b(black|navy|dark|charcoal|brown|chocolate|espresso)\b/i.test(blob)
}

export function pieceMatchesMaterial(p, material) {
  const blob = attributePieceTextBlob(p)
  const cleanMat = material.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
  const regex = new RegExp(`\\b${cleanMat}\\b`, 'i')
  return regex.test(blob)
}

export function pieceMatchesFootwear(p, footwear) {
  const blob = attributePieceTextBlob(p)
  const cleanFw = footwear.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
  const regex = new RegExp(`\\b${cleanFw}\\b`, 'i')
  return regex.test(blob)
}

export function pieceMatchesPieceName(p, name) {
  const blob = attributePieceTextBlob(p)
  const cleanName = name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
  const regex = new RegExp(`\\b${cleanName}\\b`, 'i')
  return regex.test(blob)
}

export function necklineWarmth(p) {
  if (!p) return 'neutral'
  const neck = String(p.neckline || '').toLowerCase().trim()
  if (/\b(mock|cowl|turtle)\b/i.test(neck)) return 'warm'
  return 'neutral'
}

export function sleeveCoverage(p) {
  if (!p || !p.sleeve_length) return null
  if (getFieldConfidence(p, 'sleeve_length') === 'low') return null
  const s = String(p.sleeve_length || '').toLowerCase().trim()
  if (s === '3/4' || s === 'long' || s === 'extra_long') return 'long'
  if (s === 'short' || s === 'cap' || s === 'elbow') return 'short'
  if (s === 'sleeveless') return 'none'
  return null
}

// Construction fact for hard pairing constraints. Unlike sleeveCoverage,
// this intentionally does not discard a populated structured sleeve_length
// merely because its tagger confidence is low: "sleeveless" is cheap to
// verify from the garment photo, and treating it as covered creates the
// higher-cost failure (an unwearable cold-weather outfit).
export function hasSleevelessConstruction(p) {
  return String(p?.sleeve_length || '').toLowerCase().trim() === 'sleeveless'
}

function pieceLayerIntentText(piece = {}) {
  const styleProfile = piece.style_profile_json && typeof piece.style_profile_json === 'object'
    ? JSON.stringify(piece.style_profile_json)
    : piece.style_profile_json
  return [piece.name, piece.category, piece.reads_as, piece.garment_type, piece.silhouette,
    piece.notes, piece.engine_notes, styleProfile].filter(Boolean).join(' ').toLowerCase()
}

// TODO: backfill a structured layering_role field. Until then, keep this
// fallback centralized here: attributes.js is the only layer allowed to
// interpret garment text.
export function pieceHasExplicitTopLayerEvidence(piece = {}) {
  const text = pieceLayerIntentText(piece)
  return /\b(cardigan|jacket|overshirt|button[- ]?(up|down)|shirt[- ]?jacket|vest|kimono|wrap|coat|blazer)\b/.test(text) || // ratchet-allow: fallback for missing layering_role
    /\b(layering|layer|top layer|overlayer|overlay|over-piece|over piece)\b/.test(text) || // ratchet-allow: fallback for missing layering_role
    /\b(worn|wear)\s+(open|over)\b/.test(text) || // ratchet-allow: fallback for missing layering_role
    /\b(over|on top of)\s+(a\s+)?(tee|t-shirt|t shirt|tank|camisole|base|dress)\b/.test(text) // ratchet-allow: fallback for missing layering_role
}

export function pieceHasExplicitBaseLayerEvidence(piece = {}) {
  const text = pieceLayerIntentText(piece)
  return /\b(base layer|underlayer|under-layer)\b/.test(text) || // ratchet-allow: fallback for missing layering_role
    /\b(worn|wear)\s+under\b/.test(text) || // ratchet-allow: fallback for missing layering_role
    /\bunder\s+(a\s+)?(dress|pinafore|jumper dress)\b/.test(text) // ratchet-allow: fallback for missing layering_role
}

export function pieceDressSupportsUnderlayer(piece = {}) {
  const text = pieceLayerIntentText(piece)
  return /\b(pinafore|jumper dress)\b/.test(text) || // ratchet-allow: fallback for missing layering_role
    /\b(worn|wear)\s+over\s+(a\s+)?(top|tee|t-shirt|t shirt|tank|camisole|base layer)\b/.test(text) // ratchet-allow: fallback for missing layering_role
}

export function pieceReadsAsStandaloneBaseTop(piece = {}) {
  const text = pieceLayerIntentText(piece)
  return /\b(tee|t-shirt|t shirt|crew tee|graphic tee|tank|camisole|cami|shell)\b/.test(text) && // ratchet-allow: fallback for missing layering_role
    !pieceHasExplicitTopLayerEvidence(piece)
}

/**
 * Shared, deterministic image detail policy for Anthropic candidate thumbnails.
 * High visual complexity (hero/accent roles, non-solid patterns, textured weaves)
 * gets 800px maxPx with 'auto' detail for drape/print clarity.
 * Solid neutral basics get 448px maxPx with 'low' detail to optimize input tokens.
 */
// Which garments deserve the limited photo slots on an image or critique call. Those calls attach
// at most five references, and array order used to decide — so a loud patterned hero piece could be
// rendered from prose while a plain shoe kept its photo. That inverts this project's founding
// visual-grounding lesson: models compose badly from text alone, so the pieces hardest to describe
// are exactly the ones that must be shown.
//
// Order: photographed complex pieces (the same hero/accent/pattern/texture test that decides 800px
// vs 448px), then photographed plain ones, then anything without a usable photo — those contribute
// no reference at all and must not consume a slot. Stable within each tier, so equal pieces keep
// their original order.
export function visuallyPrioritizedPieces(pieces = [], limit = Infinity) {
  const tier = piece => {
    if (!(piece?.photo || piece?.worn_photo)) return 2
    return pieceVisualDetailPolicy(piece).maxPx === 800 ? 0 : 1
  }
  return (Array.isArray(pieces) ? pieces : [])
    .map((piece, index) => ({ piece, index, tier: tier(piece) }))
    .sort((left, right) => (left.tier - right.tier) || (left.index - right.index))
    .slice(0, limit)
    .map(entry => entry.piece)
}

export function pieceVisualDetailPolicy(p, { allowLow = true } = {}) {
  if (!p) return { maxPx: 448, detail: 'low' }
  if (!allowLow) return { maxPx: 768, detail: 'auto' }
  const pattern = String(p.pattern_complexity || '').toLowerCase().trim()
  const hasComplexPattern = pattern === 'loud' || pattern === 'medium'
  const visualRoles = Array.isArray(p.style_profile_json?.visual_roles) ? p.style_profile_json.visual_roles : []
  const isExpressiveRole = visualRoles.some(r => r === 'hero_piece' || r === 'color_accent' || r === 'sharpener_piece')
  const fabric = String(p.fabric_category || p.fabric_weight || '').toLowerCase().trim()
  const isTexturedFabric = /\b(tweed|jacquard|crochet|knit|lace|embroidery|sequin)\b/i.test(fabric)

  if (hasComplexPattern || isExpressiveRole || isTexturedFabric) {
    return { maxPx: 800, detail: 'auto' }
  }
  return { maxPx: 448, detail: 'low' }
}
