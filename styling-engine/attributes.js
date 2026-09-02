// Attributes Module
// Acts as the single entry point for interpreting garment text when structured metadata is not yet populated.
import { ACCENT_COLOR_NAMES, colorTaxonomyEntry } from '../lib/colorTaxonomy.js'
import { confidenceFromProfile } from './taggerMerge.js'
import { INSULATING_FIBERS } from './fiberTaxonomy.js'

export {
  ALL_PIECE_CATEGORIES,
  FIBER_FAMILIES,
  FIBER_FAMILY_APPLICABILITY,
  FIBER_FAMILY_BY_VALUE,
  FIBER_VALUES,
  FIBER_OPTIONS_ORDER,
  INSULATING_FIBERS,
} from './fiberTaxonomy.js'
export const FORMALITY_VALUES = ['lounge', 'everyday', 'elevated', 'dressy']
export const OUTERWEAR_ROLE_VALUES = ['indoor_layer', 'transition_layer', 'protective_shell', 'cold_weather_outerwear']
export const WEATHER_PROTECTION_VALUES = ['rain', 'wind']
export const HEEL_HEIGHT_VALUES = ['flat', 'low', 'mid', 'high']
export const WALK_SUPPORT_VALUES = ['high', 'medium', 'low']
export const GATE_CRITICAL_FIELDS = ['formality', 'fabric_weight', 'visual_weight', 'fiber_content', 'occasions', 'heel_height', 'walk_support']

// Canonical sleeve-shape taxonomy: a functional sleeve-VOLUME classification answering "where does
// this sleeve create physical interference when another garment layers over/under it?" — not a
// fashion-history vocabulary. Deliberately excludes `raglan`: that word describes armhole
// attachment construction, not a sleeve-volume profile, so it cannot be mapped into this taxonomy
// mechanically (see docs/garment-field-reference.md). Sleeveless pieces store `sleeve_shape = NULL`,
// not `unknown` — `unknown` means a sleeve exists but its shape could not be determined.
// This is the single canonical owner: the tagger schema/prompt, PieceForm, BatchAdd, the DB
// migration, and pieceSleeveInterference() below must all derive from this list rather than
// maintaining their own copy.
export const SLEEVE_SHAPE_VALUES = [
  'fitted', 'straight', 'puff_shoulder', 'gathered_ruched', 'voluminous', 'flared', 'deep_armhole', 'other', 'unknown',
]
export const SLEEVE_SHAPE_OPTIONS = [
  { value: 'fitted', label: 'Fitted / slim' },
  { value: 'straight', label: 'Straight / standard' },
  { value: 'puff_shoulder', label: 'Puff / shoulder volume' },
  { value: 'gathered_ruched', label: 'Gathered / ruched' },
  { value: 'voluminous', label: 'Voluminous / balloon' },
  { value: 'flared', label: 'Wide / flared' },
  { value: 'deep_armhole', label: 'Batwing / deep armhole' },
  { value: 'other', label: 'Other' },
  { value: 'unknown', label: 'Unknown' },
]

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

// outerwear-weather-capability-spec.md — a second, independent outerwear axis: what weather
// function this outer layer can perform (indoor_layer/transition_layer/protective_shell/
// cold_weather_outerwear), deliberately kept separate from pieceWeatherScores' thermal model (a
// windbreaker can be thermally light while still being a protective_shell). category-gated, not
// tag-gated — a stray value on a non-outerwear piece, or an unrecognized stored value, is an
// honest null rather than trusted data. No consumer reads this yet (see spec §5/§7); this is the
// shared read point so a future consumer never re-derives the category guard.
export function pieceOuterwearRole(p) {
  if (wardrobeCategoryGroup(p) !== 'outerwear') return null
  return OUTERWEAR_ROLE_VALUES.includes(p?.outerwear_role) ? p.outerwear_role : null
}

// weather_protection — a second, independent outerwear axis alongside outerwear_role: which
// specific hazard (rain/wind), if any, this layer reliably protects against. A protective_shell
// role does not imply either value by itself (a windbreaker isn't automatically rain-protective,
// a raincoat isn't automatically wind-protective) — see outerwear-weather-capability-spec.md §3.
// Category-gated like pieceOuterwearRole; defensive against non-array/unrecognized stored data
// rather than trusting it was already normalized.
export function pieceWeatherProtection(p) {
  if (wardrobeCategoryGroup(p) !== 'outerwear') return []
  const raw = Array.isArray(p?.weather_protection) ? p.weather_protection : []
  return raw.filter(v => WEATHER_PROTECTION_VALUES.includes(v))
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

// A graded 0..1 fraction of the garment's applicable body regions that are exposed — for
// weatherFitForPiece/pieceWeatherScores only. pieceBareness above stays a binary high/null verdict
// on purpose: the cold-weather hard gate, extremeHeatPieceAdvisory, and the composer roster's own
// cold check all read it as a single flag and none of those are in scope here.
//
// Real regression: "multicolor striped knit maxi dress" — sleeveless, but midi-length (legs
// covered) — was scoring the same flat bareness credit as a fully bare mini dress, because
// pieceBareness ORs sleeve/neckline/hem into one high/null verdict regardless of how many of those
// signals actually fire or how much of the body the OTHER regions still cover. This tracks two
// regions — upper body (sleeve OR neckline) and lower body (hem) — and returns exposed/applicable
// rather than a flat constant: a sleeveless piece that's also full-length reads as half-exposed,
// not fully bare. Sleeve and neckline are combined into ONE region rather than two: they're
// largely the same upper-body-exposure signal (an ordinary crew neckline on a sleeveless top
// doesn't mean "more covered" just because it isn't ALSO halter/strapless), not independent
// evidence that should dilute each other.
//
// Second real regression: a region used to count as "applicable" only when it happened to be
// TAGGED, so an untagged region simply vanished from the denominator instead of being treated as
// unconfirmed. For a dress, that meant a MISSING length_hits_at made the garment look MORE
// confidently exposed than a dress with a known, covering length (1/1 vs 1/2) — missing evidence
// strengthened the bareness conclusion instead of weakening it. Applicability is now determined
// purely by category (a dress always HAS an upper body and a lower body, whether or not either is
// tagged); an untagged region still counts toward the denominator but defaults to "not confirmed
// exposed" for the numerator, so missing data can only pull the degree toward less-exposed, never
// more — consistent with how every other untagged field in this model defaults to no effect rather
// than a favorable guess.
export function pieceExposureDegree(p) {
  const category = String(p?.category || '').toLowerCase().trim()
  const upperApplicable = ['top', 'dress', 'outerwear'].includes(category)
  const lowerApplicable = ['dress', 'bottom'].includes(category)
  if (!upperApplicable && !lowerApplicable) return null

  let exposed = 0
  let applicable = 0

  if (upperApplicable) {
    applicable++
    const bareUpper = p?.sleeve_length === 'sleeveless' || (p?.neckline && /\b(halter|strapless)\b/i.test(p.neckline))
    if (bareUpper) exposed++
  }
  if (lowerApplicable) {
    applicable++
    const bareLower = p?.length_hits_at && /\b(mini|shorts?)\b/i.test(p.length_hits_at)
    if (bareLower) exposed++
  }

  return exposed / applicable
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

// Breathable/known fibers with real natural or cellulosic airflow — the positive counterpart to
// NON_BREATHABLE_ONLY_FIBERS. This is graded evidence for weatherFitForPiece/pieceWeatherScores,
// not a replacement for pieceHasOcclusiveFit's boolean gate above (kept as-is for its own call
// sites).
//
// Deliberately excludes INSULATING_FIBERS (wool, cashmere, alpaca...) even though wool genuinely
// does breathe/wick moisture — real regression: a wool fleece vest scored breathability +1 on top
// of its own insulating-material penalty, undoing 5 of that penalty's 6 points before bareness
// even applied, and the combination flipped a genuinely warm piece to "Good for heat". A fiber
// shouldn't argue "insulating, bad for heat" and "breathable, good for heat" from the same tag —
// once a fiber's already counted as insulating evidence, it stops contributing to breathability
// (treated as neutral there, not double-counted in the opposite direction).
//
// Returns one of exactly three values — +1 (breathable), -1 (non-breathable), 0 (mixed or
// unknown) — never a fraction. fiber_content is an UNORDERED PRESENCE LIST, not composition
// percentages: a piece tagged ["viscose", "polyester", "nylon"] does not mean "1/3 viscose" —
// there is no data on how much of the actual fabric is which fiber. Second real regression: this
// function used to return (breathableCount - nonBreathableCount) / knownCount, which manufactured
// exactly that unsupported fraction — adding or removing a single fiber TAG swung the result by a
// large amount regardless of the fabric's real composition, and that same invented fraction fed
// BOTH this function's own heat term and pieceOcclusiveFitDegree's multiplier (the same guess
// counted twice). Now: any presence of a known breathable fiber alongside a known non-breathable
// one is 'mixed' — genuinely conflicting evidence, reported as neutral rather than averaged into a
// fake in-between number.
const BREATHABLE_FIBERS = new Set(['cotton', 'linen', 'silk', 'tencel', 'modal', 'rayon', 'viscose', 'hemp', 'denim'])
export function pieceFiberBreathability(p) {
  const fibers = (Array.isArray(p?.fiber_content) ? p.fiber_content : [])
    .map(f => String(f).toLowerCase().trim())
    .filter(f => f && f !== 'unknown')
  const hasBreathable = fibers.some(f => BREATHABLE_FIBERS.has(f))
  const hasNonBreathable = fibers.some(f => NON_BREATHABLE_ONLY_FIBERS.has(f))
  if (hasBreathable && !hasNonBreathable) return 1
  if (hasNonBreathable && !hasBreathable) return -1
  return 0
}

// How much the CUT itself restricts airflow against skin, independent of the fabric it's made
// from — a graded degree (0..1) rather than pieceHasOcclusiveFit's boolean, so it can be combined
// multiplicatively with breathability (a close cut in breathable cotton isn't penalized; a close
// cut in non-breathable synthetic is) instead of needing its own hard-coded material check.
// fit_on_body is well-tagged for bottoms (~97%) but sparse for top/dress/outerwear (35-52% —
// docs/garment-field-reference.md field audit); silhouette is the inverse (weak for bottoms,
// 85-95% for top/dress/outerwear) and carries the same "fitted vs relaxed" information in its own
// vocabulary, so it's the natural fallback rather than leaving those categories with no signal.
export function pieceOcclusiveFitDegree(p) {
  const fit = String(p?.fit_on_body || '').toLowerCase().trim()
  if (fit === 'clings_stretchy') return 1
  if (fit === 'clings_drapey') return 0.6
  if (fit === 'skims') return 0.25
  if (fit) return 0
  const silhouette = String(p?.silhouette || '').toLowerCase().trim()
  if (silhouette === 'fitted' || silhouette === 'slim') return 0.6
  if (silhouette === 'sheath' || silhouette === 'column') return 0.5
  return 0
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

// The length_hits_at-only half of pieceCoverage above, deliberately WITHOUT the sleeve_length
// half — for weather scoring only (pieceWeatherEvidence), which needs upper-body coverage
// (sleeves) and lower-body coverage (hem) as two independent, non-overlapping signals rather than
// one combined 'full' verdict. Real regression: pieceWeatherScores used to read pieceCoverage
// (which returns 'full' for EITHER long sleeves OR a long hem) as its coverage term, and ALSO
// added a separate longSleeves term from sleeveCoverage — so a single sleeve_length: 'long' tag
// activated both terms, double-counting the same physical fact. This function reports only the
// hem half; sleeve coverage is read directly from sleeveCoverage() wherever this is used.
export function pieceHemCoverage(p) {
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
const ABSORBENT_FOOTWEAR_MATERIALS = ['canvas', 'suede', 'nubuck', 'mesh', 'knit', 'woven', 'textile']

export function pieceHasWetSensitiveFootwearMaterial(p = {}) {
  if (wardrobeCategoryGroup(p) !== 'shoes') return false
  // UPPER ONLY — deliberately does NOT read fiber_content. As of 2026-09-01 fiber_content also
  // carries footwear LININGS (the tagger records a shearling/fleece interior there, because
  // fabric_weight is null for shoes and fabric_category describes the upper). Reading it here would
  // mean a shearling-lined leather boot — the single best rain boot most wardrobes own — reads as
  // "absorbent" because of a lining the weather never touches. Latent today, since no absorbent
  // FIBER is in the list; removed before the next widening arms it. Verified against the reference
  // wardrobe: every shoe caught via fiber_content is also caught via fabric_category, so this
  // changes no existing verdict.
  const material = String(p.fabric_category || '').toLowerCase().trim()
  // Absorbent = a permeable FIBRE upper, which soaks in sustained wet. This is a claim about garment
  // physics, true in any wardrobe — deliberately NOT calibrated on how many shoes a particular user
  // would lose, which is a supply question the disclosed-shortfall path owns instead.
  //
  // Widened from a mesh-only special case on 2026-09-01, second incident: a "38°F and raining,
  // walking for hours" turn selected `taupe knit lace-up sneakers` — a visibly flyknit trainer —
  // immediately after the mesh rule shipped. The rule had caught the instance, not the class.
  //
  // Included, all permeable fibre: canvas, suede, nubuck, mesh, knit, woven (raffia/straw/textile
  // weave), textile.
  // Excluded on purpose:
  //   leather / patent / rubber — not permeable.
  //   synthetic — genuinely ambiguous. It covers both a coated waterproof PU upper and a soft
  //     textile one, so treating it as absorbent would reject shoes that are fine in rain.
  //   other / unset — unknown is not inadequacy (consolidation spec acceptance criterion 8).
  return ABSORBENT_FOOTWEAR_MATERIALS.includes(material)
}

// Ventilated footwear construction — a permeable upper built to move air, which is the opposite of
// what severe cold calls for. Deliberately NARROWER than the absorbent list above: canvas and suede
// soak but do not vent, so they are not cold-inappropriate for that reason.
//
// KNOWN LIMITATION, and the reason the schema changed alongside this: the shoes `fabric_category`
// enum had no `knit` value until 2026-09-01, so knitted uppers were tagged inconsistently as `mesh`
// OR `woven` depending on the photo. In one real wardrobe the word "knit" appears in four shoe names
// split across both values — meaning a mesh-only rule caught some flyknit shoes and missed others by
// tagging luck alone. `knit` now exists, but pieces tagged before it do not move on their own, so a
// knit upper still filed under `woven` escapes THIS rule until retagged. It is caught by the
// absorbent rule above either way, so the gap only affects dry severe cold.
export function pieceHasVentilatedFootwearMaterial(p = {}) {
  if (wardrobeCategoryGroup(p) !== 'shoes') return false
  // Upper only, for the same lining reason as the absorbent reader above.
  const material = String(p.fabric_category || '').toLowerCase().trim()
  return material === 'mesh' || material === 'knit'
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

// Canonical structured construction fact. Only explicit "yes" means the garment cannot be worn
// alone against skin; unset and explicit "no" both preserve the historical independent default.
export function pieceRequiresBaseLayer(piece = {}) {
  return String(piece?.needs_base || '').toLowerCase().trim() === 'yes'
}

const CUFFED_SLEEVE_LENGTHS = new Set(['elbow', '3/4', 'long', 'extra_long'])
const BULKY_FABRIC_WEIGHTS = new Set(['medium', 'heavy'])

// Canonical sleeve-shape -> interference-zone mapping — the one place that translates a functional
// sleeve-volume category into WHERE that volume physically sits. `fitted`/`straight` intentionally
// carry no elevated zone. `other`/`unknown` are deliberately absent: their geometry is unresolved,
// not "no interference" — callers must read a missing shape from this map as unknown evidence, the
// same as an unpopulated field.
const SLEEVE_SHAPE_INTERFERENCE_ZONES = {
  fitted:          { shoulder: 'none', arm: 'none', lowerArm: 'none', armhole: 'none' },
  straight:        { shoulder: 'none', arm: 'none', lowerArm: 'none', armhole: 'none' },
  puff_shoulder:   { shoulder: 'elevated', arm: 'none', lowerArm: 'none', armhole: 'none' },
  gathered_ruched: { shoulder: 'none', arm: 'elevated', lowerArm: 'elevated', armhole: 'none' },
  voluminous:      { shoulder: 'none', arm: 'elevated', lowerArm: 'elevated', armhole: 'none' },
  flared:          { shoulder: 'none', arm: 'none', lowerArm: 'elevated', armhole: 'none' },
  deep_armhole:    { shoulder: 'none', arm: 'none', lowerArm: 'none', armhole: 'elevated' },
}

// Canonical derived sleeve-interference reader: given a garment, where does its sleeve volume
// create physical interference for another garment layered over or under it? Each zone is
// 'none' | 'elevated' | null (unresolved — sleeve_shape is unpopulated, 'other', or 'unknown').
// This is the single owner layering mechanics reads from; no consumer should re-derive it from
// SLEEVE_SHAPE_INTERFERENCE_ZONES or from raw fashion-name membership checks itself.
export function pieceSleeveInterference(piece = {}) {
  const shape = String(piece?.sleeve_shape || '').toLowerCase().trim() || null
  const zones = shape ? SLEEVE_SHAPE_INTERFERENCE_ZONES[shape] : null
  if (!zones) return { shoulder: null, arm: null, lowerArm: null, armhole: null }
  return { ...zones }
}

// Atomic construction evidence for a garment's own sleeve, independent of any other garment it
// might layer with. `outfitValidation.js` composes two of these into a pair verdict; this reader
// only normalizes and classifies one garment's own tagged fields. `null` on a classifier means the
// underlying field is unpopulated or unrecognized, not that the classifier resolved to false —
// callers must treat that as unresolved evidence, not as a negative fact.
export function pieceSleeveLayerEvidence(piece = {}) {
  const length = String(piece?.sleeve_length || '').toLowerCase().trim() || null
  const shape = String(piece?.sleeve_shape || '').toLowerCase().trim() || null
  const fabricWeight = String(piece?.fabric_weight || '').toLowerCase().trim() || null
  return {
    length,
    shape,
    fabricWeight,
    isCuffed: length ? CUFFED_SLEEVE_LENGTHS.has(length) : null,
    isBulkyFabric: (fabricWeight && fabricWeight !== 'unknown') ? BULKY_FABRIC_WEIGHTS.has(fabricWeight) : null,
  }
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
    /\b(layering (piece|top|garment)|top layer|overlayer|overlay|over-piece|over piece)\b/.test(text) || // ratchet-allow: fallback for missing layering_role
    /\b(worn|wear)\s+(open|over)\b/.test(text) || // ratchet-allow: fallback for missing layering_role
    /\b(over|on top of)\s+(a\s+)?(tee|t-shirt|t shirt|tank|camisole|base|dress)\b/.test(text) // ratchet-allow: fallback for missing layering_role
}

export function pieceHasExplicitBaseLayerEvidence(piece = {}) {
  const text = pieceLayerIntentText(piece)
  return /\b(is|as|acts? as|serves? as|intended as|fitted)\s+(a\s+)?(base layer|underlayer|under-layer)\b/.test(text) || // ratchet-allow: fallback for missing layering_role
    /\b(base layer|underlayer|under-layer)\s+(tee|top|tank|camisole|cami|shell)\b/.test(text) || // ratchet-allow: fallback for missing layering_role
    /\b(worn|wear)\s+under\b/.test(text) || // ratchet-allow: fallback for missing layering_role
    /\bunder\s+(a\s+)?(dress|pinafore|jumper dress)\b/.test(text) // ratchet-allow: fallback for missing layering_role
}

export function pieceDressSupportsUnderlayer(piece = {}) {
  const text = pieceLayerIntentText(piece)
  return /\b(pinafore|jumper dress)\b/.test(text) || // ratchet-allow: fallback for missing layering_role
    /\b(worn|wear)\s+over\s+(a\s+)?(top|tee|t-shirt|t shirt|tank|camisole|base layer)\b/.test(text) // ratchet-allow: fallback for missing layering_role
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
