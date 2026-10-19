// Garment notes: the tagger-written prose in style_profile_json that the owner may now edit —
// pairing needs, risks, formulas, things to avoid, real-wear notes, and the best-use/risk lines.
//
// Owner ruling 2026-10-19 (colour-variant flow): these are copied to a new colour of an existing
// piece and must be editable there and in Edit, the same way colour is, because some of them are
// about the colour ("all-cream styling risks a flat palette") and would be wrong on the copy.
//
// Why owner edits travel as their own request field (owner_garment_notes) instead of inside
// style_profile_json: PUT /pieces/:id merges the submitted profile over the stored one with
// manual_overrides as *protected* paths, so a path the owner has claimed is never overwritten —
// including by the owner's own next save. Applying owner_garment_notes after that merge is the one
// place an owner write lands, and recording its path in manual_overrides keeps a later retag
// (applyTaggerResult, PieceForm's mergeTagProfile) from putting the tagger's text back.
//
// This is the canonical path list: PieceForm and routes/crud.js both read it from here.

export const GARMENT_NOTE_LISTS = [
  { path: 'garment_intelligence.pairing_requirements', label: 'Needs', placeholder: 'e.g. a structured bottom to balance the volume' },
  { path: 'garment_intelligence.failure_risks', label: 'Risks', placeholder: 'e.g. creases after sitting' },
  { path: 'garment_intelligence.formula_compatibility', label: 'Formulas', placeholder: 'e.g. half-tucked + straight jeans + loafer' },
  { path: 'garment_intelligence.do_not_pair_rules', label: 'Avoid', placeholder: 'e.g. another pale, loose top layer' },
]

export const GARMENT_NOTE_TEXTS = [
  { path: 'style_notes.best_use', label: 'Best use' },
  { path: 'style_notes.risk', label: 'Risk' },
]

// real_wear_notes is one object of short labelled lines; it is edited and protected as a whole.
export const REAL_WEAR_PATH = 'garment_intelligence.real_wear_notes'
export const REAL_WEAR_KEYS = ['fit', 'drape', 'scale', 'placement', 'maintenance']

export const GARMENT_NOTE_PATHS = [
  ...GARMENT_NOTE_LISTS.map(entry => entry.path),
  ...GARMENT_NOTE_TEXTS.map(entry => entry.path),
  REAL_WEAR_PATH,
]

const LIST_PATHS = new Set(GARMENT_NOTE_LISTS.map(entry => entry.path))
const TEXT_PATHS = new Set(GARMENT_NOTE_TEXTS.map(entry => entry.path))

export function getProfilePath(profile, path) {
  return String(path).split('.').reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), profile)
}

export function setProfilePath(profile, path, value) {
  const out = profile && typeof profile === 'object' ? { ...profile } : {}
  const keys = String(path).split('.')
  let node = out
  for (let i = 0; i < keys.length - 1; i += 1) {
    const child = node[keys[i]]
    node[keys[i]] = child && typeof child === 'object' && !Array.isArray(child) ? { ...child } : {}
    node = node[keys[i]]
  }
  node[keys[keys.length - 1]] = value
  return out
}

// The tagger stores some of these lists as ";"- or newline-joined strings; edits always write arrays.
export function noteList(value) {
  if (!value) return []
  const items = Array.isArray(value) ? value : String(value).split(/[\n;]+/)
  return [...new Set(items.map(item => String(item || '').trim()).filter(Boolean))]
}

export function normalizeGarmentNoteValue(path, value) {
  if (LIST_PATHS.has(path)) return noteList(value)
  if (TEXT_PATHS.has(path)) return String(value ?? '').trim()
  if (path === REAL_WEAR_PATH) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    return Object.fromEntries(Object.entries(source).map(([key, text]) => [key, String(text ?? '').trim()]))
  }
  return undefined
}

// Applies the owner's note edits ({ path: value }) to a style profile. Unknown paths are ignored,
// so this request field cannot be used to write any other part of the profile.
export function applyOwnerGarmentNotes(profile, edits) {
  let next = profile && typeof profile === 'object' ? profile : {}
  const paths = []
  const source = edits && typeof edits === 'object' && !Array.isArray(edits) ? edits : {}
  for (const path of GARMENT_NOTE_PATHS) {
    if (!Object.prototype.hasOwnProperty.call(source, path)) continue
    next = setProfilePath(next, path, normalizeGarmentNoteValue(path, source[path]))
    paths.push(path)
  }
  return { profile: next, overridePaths: paths.map(path => `style_profile_json.${path}`) }
}
