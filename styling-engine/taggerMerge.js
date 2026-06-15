import { applySoftScoreFloors } from './softScoreFloors.js'

const MANUAL_CONFIDENCE = 'manual'
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low', MANUAL_CONFIDENCE])

export const CONFIDENCE_FIELDS = [
  'category',
  'colors',
  'background_color',
  'pattern_type',
  'pattern_scale',
  'pattern_complexity',
  'reads_as',
  'neckline',
  'sleeve_type',
  'length_hits_at',
  'silhouette',
  'hem_finish',
  'fabric_category',
  'fabric_weight',
  'fit_on_body',
  'tuck_behavior',
  'waistband_type'
]

export function normalizeConfidenceMap(value = {}, fields = CONFIDENCE_FIELDS) {
  const source = isObject(value) ? value : {}
  return Object.fromEntries(fields.map(field => {
    const confidence = String(source[field] || '').toLowerCase()
    return [field, VALID_CONFIDENCE.has(confidence) ? confidence : 'low']
  }))
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

function pathParts(path) {
  return String(path || '').split('.').map(part => part.trim()).filter(Boolean)
}

export function getPath(obj, path) {
  return pathParts(path).reduce((acc, part) => acc && typeof acc === 'object' ? acc[part] : undefined, obj)
}

export function setPath(obj, path, value) {
  const parts = pathParts(path)
  if (!parts.length) return obj
  let cursor = obj
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i]
    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) cursor[part] = {}
    cursor = cursor[part]
  }
  cursor[parts[parts.length - 1]] = value
  return obj
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
  const manualOverrides = normalizeManualOverrides(existingPiece.manual_overrides)
  const baseProfile = existingPiece.style_profile_json || {}
  const incomingProfile = tags.style_profile_json || {}
  const incomingConfidence = normalizeConfidenceMap(tags._confidence || incomingProfile._confidence || {})
  const photoProperties = normalizePhotoProperties(tags.photo_properties || incomingProfile.photo_properties || {})
  const patch = { ...tags }
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
