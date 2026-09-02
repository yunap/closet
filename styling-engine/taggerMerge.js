import { applySoftScoreFloors } from './softScoreFloors.js'
import { normalizeFiberContent, normalizeFiberCompleteness, normalizeInsulatingLayerMaterials } from './fiberTaxonomy.js'
import { sanitizeTaggerColors } from '../lib/colorTaxonomy.js'

const MANUAL_CONFIDENCE = 'manual'
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low', MANUAL_CONFIDENCE])
const VALID_FORMALITY = new Set(['lounge', 'everyday', 'elevated', 'dressy'])
const VALID_HEEL_HEIGHT = new Set(['flat', 'low', 'mid', 'high'])
const VALID_WALK_SUPPORT = new Set(['high', 'medium', 'low'])
const VALID_ACCESSORY_SUBTYPE = new Set(['belt', 'bag', 'jewelry', 'scarf', 'hat', 'watch', 'glasses', 'gloves', 'other'])
const VALID_BOTTOM_SUBTYPE = new Set(['pants', 'shorts', 'skirt', 'culottes', 'overalls', 'other', 'unknown'])
const VALID_JEWELRY_TYPE = new Set(['necklace', 'earrings', 'bracelet', 'ring', 'pin'])
const VALID_NECKLACE_LENGTH = new Set(['choker', 'short', 'long'])
// fabric_category's valid values depend on the piece's category, and until 2026-09-01 the field had
// no normalizer at all — the only tagged enum in this file without one. An out-of-list value was
// stored verbatim, which fails OPEN on every material rule at once: wet-sensitivity, ventilation and
// insulating-material all ask "is this value in my set?" and a value on no list simply never matches.
//
// Found live: a newly added shoe was tagged `fabric_category: 'wool'` — a CLOTHING value the prompt
// explicitly forbids for footwear ("Never use the clothing list for a shoe or accessory piece") — and
// sailed through the wet gate on a 38°F rainy walking turn. Nothing surfaced; the gate was not
// bypassed, it was never matched.
//
// Normalizing to null makes an unrecognized value read as UNKNOWN, which every consumer already
// handles correctly, instead of as a silent pass.
const VALID_FABRIC_CATEGORY_GARMENT = new Set(['jersey', 'knit', 'rib knit', 'ponte', 'sweatshirt fleece', 'fleece', 'cotton', 'poplin', 'linen', 'linen blend', 'rayon', 'viscose', 'modal', 'silk', 'satin', 'crepe', 'chiffon', 'organza', 'lace', 'crochet', 'jacquard', 'wool', 'cashmere', 'boucle', 'denim', 'twill', 'canvas', 'corduroy', 'tweed', 'velvet', 'leather', 'faux leather', 'suede', 'faux suede', 'mesh', 'technical/performance', 'synthetic', 'other'])
const VALID_FABRIC_CATEGORY_SHOES = new Set(['leather', 'suede', 'nubuck', 'patent', 'canvas', 'mesh', 'knit', 'woven', 'synthetic', 'textile', 'rubber', 'other'])
const VALID_FABRIC_CATEGORY_ACCESSORY = new Set(['leather', 'suede', 'metal', 'stone', 'straw', 'canvas', 'synthetic', 'textile', 'rubber', 'wood', 'ceramic', 'glass', 'horn', 'shell', 'resin', 'pearl', 'crystal', 'enamel', 'other'])

const VALID_OUTERWEAR_ROLE = new Set(['indoor_layer', 'transition_layer', 'protective_shell', 'cold_weather_outerwear'])
const VALID_WEATHER_PROTECTION = new Set(['rain', 'wind'])

export const CONFIDENCE_FIELDS = [
  'category',
  'accessory_subtype',
  'bottom_subtype',
  'jewelry_type',
  'necklace_length',
  'colors',
  'background_color',
  'pattern_type',
  'pattern_scale',
  'pattern_complexity',
  'reads_as',
  'neckline',
  'sleeve_length',
  'sleeve_shape',
  'length_hits_at',
  'silhouette',
  'shoe_type',
  'toe_shape',
  'hem_finish',
  'fabric_category',
  'fabric_weight',
  'visual_weight',
  'opacity',
  'stretch',
  'fiber_content',
  'formality',
  'heel_height',
  'walk_support',
  'fit_on_body',
  'tuck_behavior',
  'waistband_type',
  'needs_base',
  'outerwear_role',
  'weather_protection'
]

export function normalizeConfidenceMap(value = {}, fields = CONFIDENCE_FIELDS) {
  const source = isObject(value) ? value : {}
  return Object.fromEntries(fields.map(field => {
    const confidence = String(source[field] || '').toLowerCase()
    return [field, VALID_CONFIDENCE.has(confidence) ? confidence : 'low']
  }))
}

// Re-exported so existing importers keep working; the normalizer itself lives with the taxonomy
// (fiberTaxonomy.js) rather than in this write path. See fiber-evidence-completeness-spec.md §10.
export { normalizeFiberContent }

function normalizeEnumValue(value, validValues) {
  const normalized = String(value || '').toLowerCase().trim()
  return validValues.has(normalized) ? normalized : null
}

export function normalizeFormality(value) {
  return normalizeEnumValue(value, VALID_FORMALITY)
}

export function normalizeHeelHeight(value) {
  return normalizeEnumValue(value, VALID_HEEL_HEIGHT)
}

export function normalizeWalkSupport(value) {
  return normalizeEnumValue(value, VALID_WALK_SUPPORT)
}

export function normalizeAccessorySubtype(value) {
  return normalizeEnumValue(value, VALID_ACCESSORY_SUBTYPE)
}

export function normalizeBottomSubtype(value) {
  return normalizeEnumValue(value, VALID_BOTTOM_SUBTYPE)
}

export function normalizeJewelryType(value) {
  return normalizeEnumValue(value, VALID_JEWELRY_TYPE)
}

export function normalizeNecklaceLength(value) {
  return normalizeEnumValue(value, VALID_NECKLACE_LENGTH)
}

/**
 * @param {*} value     the tagged fabric_category
 * @param {*} category  the piece's category; when it is missing or unrecognized the value is checked
 *                      against the UNION of the three lists rather than nulled outright. Guessing a
 *                      category to validate against would be worse than accepting a value that is
 *                      valid for some category — this normalizer exists to reject values that are on
 *                      no list at all, not to police category/value agreement.
 */
export function normalizeFabricCategory(value, category) {
  const group = String(category || '').toLowerCase().trim()
  if (group === 'shoes') return normalizeEnumValue(value, VALID_FABRIC_CATEGORY_SHOES)
  if (group === 'accessory') return normalizeEnumValue(value, VALID_FABRIC_CATEGORY_ACCESSORY)
  if (['top', 'bottom', 'dress', 'outerwear'].includes(group)) return normalizeEnumValue(value, VALID_FABRIC_CATEGORY_GARMENT)
  return normalizeEnumValue(value, new Set([
    ...VALID_FABRIC_CATEGORY_GARMENT, ...VALID_FABRIC_CATEGORY_SHOES, ...VALID_FABRIC_CATEGORY_ACCESSORY,
  ]))
}

export function normalizeOuterwearRole(value) {
  return normalizeEnumValue(value, VALID_OUTERWEAR_ROLE)
}

// Unlike normalizeFiberContent, an empty result is left as [] rather than defaulted to
// ['unknown'] — "no reliable protection identified" is a legitimate, common answer (an ordinary
// denim jacket has neither), not a gap to flag.
export function normalizeWeatherProtection(value = []) {
  const raw = Array.isArray(value) ? value : []
  const normalized = raw
    .map(v => String(v || '').toLowerCase().trim())
    .filter(v => VALID_WEATHER_PROTECTION.has(v))
  return [...new Set(normalized)]
}

export function normalizePhotoProperties(value = {}) {
  const source = isObject(value) ? value : {}
  return Object.fromEntries(Object.entries(source).map(([key, raw]) => {
    const props = isObject(raw) ? raw : {}
    return [key, {
      fit_visible: Boolean(props.fit_visible),
      real_context: Boolean(props.real_context),
      notes: props.notes ? String(props.notes) : ''
    }]
  }))
}

export function hasFitVisiblePhoto(styleProfile = {}) {
  const properties = normalizePhotoProperties(styleProfile?.photo_properties || {})
  return Object.values(properties).some(props => props.fit_visible)
}

export function hasPhotoPropertyJudgment(styleProfile = {}) {
  return Object.keys(normalizePhotoProperties(styleProfile?.photo_properties || {})).length > 0
}

export function normalizeManualOverrides(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? (() => { try { return JSON.parse(value || '[]') } catch { return [] } })()
      : []
  return [...new Set(raw.map(v => String(v || '').trim()).filter(Boolean))]
}

function getAnchorValue(piece = {}, field = '') {
  return getPath(piece, field)
}

function anchorSortValue(piece = {}) {
  return String(piece.updated_at || piece.updatedAt || piece.date_updated || piece.date_added || '')
}

function anchorAttrs(piece = {}) {
  const attrs = []
  if (piece.fabric_category) attrs.push(`fabric: ${piece.fabric_category}`)
  if (piece.reads_as) attrs.push(`reads_as: ${piece.reads_as}`)
  return attrs.length ? ` (${attrs.slice(0, 2).join('; ')})` : ''
}

// Total ceiling across all buckets combined, not just per-bucket. A scalar enum field like
// `formality` (4 possible values) can never exceed `4 * perValue` anchors on its own, so this cap
// was invisible until an array-valued field like `occasions` was considered for anchoring: the
// bucket key is the joined string of the whole array (see below), so the number of buckets scales
// with the number of distinct value COMBINATIONS observed, not with the field's own vocabulary
// size — unbounded as more pieces get hand-corrected. See docs/tagger-audit-findings.md Q5.
const DEFAULT_MAX_ANCHORS = 24

export function buildAnchorBlock({ pieces = [], fields = [], perValue = 3, maxAnchors = DEFAULT_MAX_ANCHORS } = {}) {
  const wantedFields = fields.map(field => String(field || '').trim()).filter(Boolean)
  if (!wantedFields.length) return { text: '', anchors: [] }

  const buckets = new Map()
  for (const piece of pieces) {
    const manualOverrides = normalizeManualOverrides(piece.manual_overrides)
    for (const field of wantedFields) {
      if (!manualOverrides.includes(field)) continue
      const value = getAnchorValue(piece, field)
      const normalizedValue = Array.isArray(value)
        ? value.join(', ')
        : String(value || '').trim()
      if (!normalizedValue) continue
      const key = `${field}:${normalizedValue.toLowerCase()}`
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key).push({
        id: Number(piece.id),
        name: String(piece.name || '').trim(),
        field,
        value: normalizedValue,
        fabric_category: piece.fabric_category || null,
        reads_as: piece.reads_as || null,
        photo: piece.photo || null,
        worn_photo: piece.worn_photo || null,
        sortValue: anchorSortValue(piece)
      })
    }
  }

  // Sort each bucket's own items by recency (most-recently-corrected first), same as before.
  const sortedBuckets = [...buckets.values()].map(bucket => (
    bucket.sort((a, b) => String(b.sortValue || '').localeCompare(String(a.sortValue || '')) || Number(b.id) - Number(a.id))
  ))

  // Then order the BUCKETS themselves by their freshest item, so truncation (if the total ceiling
  // is hit) drops the least-recently-corrected values first rather than depending on Map
  // iteration order (insertion order from the piece scan above — not a meaningful ordering, and
  // the same arbitrariness already flagged for which anchors get an illustrating thumbnail).
  sortedBuckets.sort((a, b) => (
    String(b[0]?.sortValue || '').localeCompare(String(a[0]?.sortValue || ''))
  ))

  const anchors = []
  for (const bucket of sortedBuckets) {
    if (anchors.length >= maxAnchors) break
    const room = maxAnchors - anchors.length
    anchors.push(...bucket.slice(0, perValue).slice(0, room))
  }
  if (!anchors.length) return { text: '', anchors: [] }

  const rows = anchors.map(anchor => (
    `- ${anchor.field}=${anchor.value}: ${anchor.id} ${anchor.name || '(unnamed piece)'}${anchorAttrs(anchor)}`
  )).join('\n')
  return {
    anchors,
    text: `\nWardrobe calibration anchors:\nThese assignments are ground truth for THIS wardrobe — calibrate to them, not to general fashion norms.\n${rows}\n`
  }
}

function pathParts(path) {
  return String(path || '').split('.').map(part => part.trim()).filter(Boolean)
}

export function getPath(obj, path) {
  return pathParts(path).reduce((acc, part) => acc && typeof acc === 'object' ? acc[part] : undefined, obj)
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone)
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]))
  return value
}

export function pathIsProtected(path, manualOverrides = []) {
  const current = String(path || '')
  return normalizeManualOverrides(manualOverrides).some(override => (
    override === current ||
    current.startsWith(`${override}.`)
  ))
}

function pathHasProtectedDescendant(path, manualOverrides = []) {
  const current = String(path || '')
  return normalizeManualOverrides(manualOverrides).some(override => override.startsWith(`${current}.`))
}

function mergeAtPath(base, patch, manualOverrides, currentPath = '') {
  if (!isObject(patch)) return pathIsProtected(currentPath, manualOverrides) ? clone(base) : clone(patch)
  const out = isObject(base) ? clone(base) : {}
  for (const [key, value] of Object.entries(patch)) {
    const nextPath = currentPath ? `${currentPath}.${key}` : key
    if (pathIsProtected(nextPath, manualOverrides)) continue
    out[key] = (isObject(value) && (isObject(out[key]) || pathHasProtectedDescendant(nextPath, manualOverrides)))
      ? mergeAtPath(out[key], value, manualOverrides, nextPath)
      : clone(value)
  }
  return out
}

export function mergeWithManualOverrides(base = {}, patch = {}, manualOverrides = []) {
  return mergeAtPath(base || {}, patch || {}, normalizeManualOverrides(manualOverrides), '')
}

export function confidenceFromProfile(pieceOrProfile = {}, field) {
  const profile = pieceOrProfile.style_profile_json || pieceOrProfile || {}
  const confidence = profile?._confidence && typeof profile._confidence === 'object'
    ? profile._confidence[field]
    : undefined
  if (confidence) return confidence
  const overrides = normalizeManualOverrides(pieceOrProfile.manual_overrides)
  if (overrides.includes(field) || overrides.includes(`style_profile_json._confidence.${field}`)) return MANUAL_CONFIDENCE
  return undefined
}

export function pinManualConfidence(styleProfile = {}, manualOverrides = []) {
  const profile = isObject(styleProfile) ? clone(styleProfile) : {}
  const confidence = isObject(profile._confidence) ? { ...profile._confidence } : {}
  for (const path of normalizeManualOverrides(manualOverrides)) {
    const topLevel = pathParts(path)[0]
    if (CONFIDENCE_FIELDS.includes(topLevel)) confidence[topLevel] = MANUAL_CONFIDENCE
  }
  if (Object.keys(confidence).length) profile._confidence = confidence
  return profile
}

export function applyTaggerResult(existingPiece = {}, tags = {}) {
  tags = sanitizeTaggerColors(tags, { preserveExisting: true }).tags
  const manualOverrides = normalizeManualOverrides(existingPiece.manual_overrides)
  const baseProfile = existingPiece.style_profile_json || {}
  const incomingProfile = tags.style_profile_json || {}
  const incomingConfidence = normalizeConfidenceMap(tags._confidence || incomingProfile._confidence || {})
  const photoProperties = normalizePhotoProperties(tags.photo_properties || incomingProfile.photo_properties || {})
  const patch = { ...tags }
  delete patch.color_taxonomy_gaps
  if ('fiber_content' in patch) patch.fiber_content = normalizeFiberContent(patch.fiber_content)
  // The tagger does not emit completeness today. This guard is here so that if it ever does, the
  // writer rule applies at the boundary rather than being remembered later: photo-only inference
  // cannot see a lining or a fill, so it may never assert 'complete'. See fiberTaxonomy.js.
  // A photograph can show that an insulating layer exists; it can never show that one is absent.
  // normalizeInsulatingLayerMaterials downgrades a tagger-asserted [] to null for that reason.
  if ('insulating_layer_materials' in patch) {
    patch.insulating_layer_materials =
      normalizeInsulatingLayerMaterials(patch.insulating_layer_materials, { source: 'tagger' })
  }
  if ('fiber_content_completeness' in patch) {
    patch.fiber_content_completeness =
      normalizeFiberCompleteness(patch.fiber_content_completeness, { source: 'tagger' })
  }
  // Category-aware: a retag may change the category in the same patch, so validate against the
  // incoming category when there is one and fall back to the stored one.
  if ('fabric_category' in patch) patch.fabric_category = normalizeFabricCategory(patch.fabric_category, patch.category ?? existingPiece.category)
  if ('formality' in patch) patch.formality = normalizeFormality(patch.formality)
  if ('heel_height' in patch) patch.heel_height = normalizeHeelHeight(patch.heel_height)
  if ('walk_support' in patch) patch.walk_support = normalizeWalkSupport(patch.walk_support)
  if ('accessory_subtype' in patch) patch.accessory_subtype = normalizeAccessorySubtype(patch.accessory_subtype)
  if ('bottom_subtype' in patch) patch.bottom_subtype = normalizeBottomSubtype(patch.bottom_subtype)
  if ('jewelry_type' in patch) patch.jewelry_type = normalizeJewelryType(patch.jewelry_type)
  if ('necklace_length' in patch) patch.necklace_length = normalizeNecklaceLength(patch.necklace_length)
  if ('outerwear_role' in patch) patch.outerwear_role = normalizeOuterwearRole(patch.outerwear_role)
  if ('weather_protection' in patch) patch.weather_protection = normalizeWeatherProtection(patch.weather_protection)
  delete patch._confidence
  delete patch.photo_properties
  delete patch.cross_photo_agreement_note
  patch.style_profile_json = {
    ...incomingProfile,
    _confidence: incomingConfidence,
    photo_properties: {
      ...(normalizePhotoProperties(incomingProfile.photo_properties || {})),
      ...photoProperties
    }
  }
  const merged = mergeWithManualOverrides(existingPiece, patch, manualOverrides)
  merged.style_profile_json = pinManualConfidence(
    mergeWithManualOverrides(baseProfile, patch.style_profile_json, manualOverrides.map(path => (
      path.startsWith('style_profile_json.') ? path.replace(/^style_profile_json\./, '') : path
    ))),
    manualOverrides
  )
  merged.manual_overrides = manualOverrides
  return applySoftScoreFloors(merged)
}

// Categories with no fit_on_body field (see CLOTHING_CATEGORIES in PieceForm.jsx) have nothing
// a worn photo would let a person judge — a ring or a belt doesn't have "fit and drape" the way
// a shirt does. Without this, those pieces sat at tag_state 'provisional' forever: the only way
// out was a worn photo, but the field that photo would inform is never shown for them.
const FIT_IRRELEVANT_CATEGORIES = new Set(['shoes', 'accessory'])
function categoryHasFitPhotoRelevance(category) {
  return !FIT_IRRELEVANT_CATEGORIES.has(String(category || '').toLowerCase().trim())
}

export function tagStateForPhotos({ photo, worn_photo, style_profile_json, category } = {}) {
  if (hasFitVisiblePhoto(style_profile_json || {})) return 'fully_tagged'
  if (worn_photo) return 'fully_tagged'
  if (photo && !categoryHasFitPhotoRelevance(category)) return 'fully_tagged'
  if (photo) return 'provisional'
  return 'untagged'
}

export function tagStateForTaggerResult(tags = {}, fallback = {}) {
  const profile = tags.style_profile_json || {}
  const category = tags.category || fallback.category
  if (hasFitVisiblePhoto(profile)) return 'fully_tagged'
  if (hasPhotoPropertyJudgment(profile)) {
    if (fallback.photo && !categoryHasFitPhotoRelevance(category)) return 'fully_tagged'
    return fallback.photo || fallback.worn_photo ? 'provisional' : 'untagged'
  }
  return tagStateForPhotos({ ...fallback, category })
}
