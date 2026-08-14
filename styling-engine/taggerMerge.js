import { applySoftScoreFloors } from './softScoreFloors.js'
import { sanitizeTaggerColors } from '../lib/colorTaxonomy.js'

const MANUAL_CONFIDENCE = 'manual'
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low', MANUAL_CONFIDENCE])
const VALID_FIBERS = new Set(['wool', 'merino', 'cashmere', 'alpaca', 'mohair', 'fleece', 'down',
  'cotton', 'linen', 'silk', 'tencel', 'modal', 'rayon', 'viscose', 'polyester', 'nylon',
  'acrylic', 'spandex', 'leather', 'suede', 'denim', 'unknown'])
const VALID_FORMALITY = new Set(['lounge', 'everyday', 'elevated', 'dressy'])
const VALID_HEEL_HEIGHT = new Set(['flat', 'low', 'mid', 'high'])
const VALID_WALK_SUPPORT = new Set(['high', 'medium', 'low'])
const VALID_ACCESSORY_SUBTYPE = new Set(['belt', 'bag', 'jewelry', 'scarf', 'hat', 'watch', 'gloves', 'other'])
const VALID_BOTTOM_SUBTYPE = new Set(['pants', 'shorts', 'skirt', 'culottes', 'overalls', 'other', 'unknown'])
const VALID_JEWELRY_TYPE = new Set(['necklace', 'earrings', 'bracelet', 'ring', 'pin'])
const VALID_NECKLACE_LENGTH = new Set(['choker', 'short', 'long'])

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
  'opacity',
  'fiber_content',
  'formality',
  'heel_height',
  'walk_support',
  'fit_on_body',
  'tuck_behavior',
  'waistband_type',
  'needs_base'
]

export function normalizeConfidenceMap(value = {}, fields = CONFIDENCE_FIELDS) {
  const source = isObject(value) ? value : {}
  return Object.fromEntries(fields.map(field => {
    const confidence = String(source[field] || '').toLowerCase()
    return [field, VALID_CONFIDENCE.has(confidence) ? confidence : 'low']
  }))
}

export function normalizeFiberContent(value = []) {
  const raw = Array.isArray(value) ? value : []
  const normalized = raw
    .map(v => String(v || '').toLowerCase().trim())
    .map(v => VALID_FIBERS.has(v) ? v : 'unknown')
    .filter(Boolean)
  return [...new Set(normalized.length ? normalized : ['unknown'])]
}

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

export function buildAnchorBlock({ pieces = [], fields = [], perValue = 3 } = {}) {
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

  const anchors = [...buckets.values()].flatMap(bucket => bucket
    .sort((a, b) => String(b.sortValue || '').localeCompare(String(a.sortValue || '')) || Number(b.id) - Number(a.id))
    .slice(0, perValue))
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
  if ('formality' in patch) patch.formality = normalizeFormality(patch.formality)
  if ('heel_height' in patch) patch.heel_height = normalizeHeelHeight(patch.heel_height)
  if ('walk_support' in patch) patch.walk_support = normalizeWalkSupport(patch.walk_support)
  if ('accessory_subtype' in patch) patch.accessory_subtype = normalizeAccessorySubtype(patch.accessory_subtype)
  if ('bottom_subtype' in patch) patch.bottom_subtype = normalizeBottomSubtype(patch.bottom_subtype)
  if ('jewelry_type' in patch) patch.jewelry_type = normalizeJewelryType(patch.jewelry_type)
  if ('necklace_length' in patch) patch.necklace_length = normalizeNecklaceLength(patch.necklace_length)
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

export function tagStateForPhotos({ photo, worn_photo, style_profile_json } = {}) {
  if (hasFitVisiblePhoto(style_profile_json || {})) return 'fully_tagged'
  if (worn_photo) return 'fully_tagged'
  if (photo) return 'provisional'
  return 'untagged'
}

export function tagStateForTaggerResult(tags = {}, fallback = {}) {
  const profile = tags.style_profile_json || {}
  if (hasFitVisiblePhoto(profile)) return 'fully_tagged'
  if (hasPhotoPropertyJudgment(profile)) return fallback.photo || fallback.worn_photo ? 'provisional' : 'untagged'
  return tagStateForPhotos(fallback)
}
