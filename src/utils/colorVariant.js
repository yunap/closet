// "Add in another color": a new piece that is the same garment as an existing one in a different
// color. Owner ruling 2026-10-19 — two separate pieces, never one piece with two colors, and no
// model call: the owner supplies the photo and the colors, everything else is copied.
//
// What is copied, cleared, or offered:
// - Copied: every structured tag (category, type, construction, fabric, fit, formality, season,
//   occasions, stylist controls) and the tagger's garment notes, which the form shows as editable.
// - Cleared: photos, colors, reads_as and background_color (all describe the original's color),
//   the profile's photo_properties (they describe the original's photo), and those fields'
//   confidence and manual-override entries.
// - Offered, unticked: the owner's own memory — rules learned, tried and rejected, notes, engine
//   notes and occasion exclusions. Each is authoritative for the stylist, and some will be about
//   the color, so copying one is the owner's choice (memoryItemsFor / applyMemoryChoices).
//
// Usage history, outfit links and board feedback belong to the original piece and are not copied.

const COLOR_FIELDS = ['colors', 'reads_as', 'background_color']

// The "Excluded from X by …" / "Restored for X by …" lines are receipts the occasion-exclusion
// endpoint writes beside the real exclusion; they are offered as the exclusion itself, not as rules.
const EXCLUSION_RECEIPT = /^(Excluded from|Restored for) .+ by .+\(\d{4}-\d{2}-\d{2}\)\s*$/

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) ?? fallback } catch { return fallback }
}

function lines(value) {
  const parsed = parseJson(value, [])
  return Array.isArray(parsed) ? parsed.map(line => String(line || '').trim()).filter(Boolean) : []
}

export function buildColorVariantDraft(original = {}) {
  const profile = parseJson(original.style_profile_json, {}) || {}
  const { photo_properties: _photoProperties, ...copiedProfile } = profile
  if (copiedProfile._confidence && typeof copiedProfile._confidence === 'object') {
    copiedProfile._confidence = Object.fromEntries(
      Object.entries(copiedProfile._confidence).filter(([field]) => !COLOR_FIELDS.includes(field))
    )
  }
  const overrides = lines(original.manual_overrides).filter(path => !COLOR_FIELDS.includes(path))
  const {
    id: _id, photo: _photo, worn_photo: _wornPhoto, date_added: _dateAdded, favorite: _favorite,
    retag_suggestions: _retag, occasion_exclusions: _exclusions, usage: _usage,
    ...rest
  } = original
  return {
    ...rest,
    status: 'active',
    colors: [],
    reads_as: '',
    background_color: '',
    styling_rules_learned: [],
    tried_and_rejected: [],
    notes: '',
    engine_notes: '',
    style_profile_json: copiedProfile,
    manual_overrides: overrides,
  }
}

export function memoryItemsFor(original = {}) {
  const items = []
  lines(original.styling_rules_learned)
    .filter(rule => !EXCLUSION_RECEIPT.test(rule))
    .forEach((rule, i) => items.push({ id: `rule-${i}`, kind: 'rule', group: 'Rules learned', text: rule }))
  lines(original.tried_and_rejected)
    .forEach((entry, i) => items.push({ id: `tried-${i}`, kind: 'tried', group: 'Tried and did not work', text: entry }))
  lines(original.occasion_exclusions)
    .forEach(occasion => items.push({ id: `exclusion-${occasion}`, kind: 'exclusion', group: 'Occasion exclusions', text: `Never offered for ${occasion}`, occasion }))
  if (String(original.notes || '').trim()) {
    items.push({ id: 'notes', kind: 'notes', group: 'Notes', text: String(original.notes).trim() })
  }
  if (String(original.engine_notes || '').trim()) {
    items.push({ id: 'engine-notes', kind: 'engine_notes', group: 'Engine notes', text: String(original.engine_notes).trim() })
  }
  return items
}

// Returns the form fields the ticked items fill, plus the occasions to exclude once the new piece
// exists (POST /pieces cannot write occasion_exclusions; only the exclusion endpoint can).
// `edits` ({ id: text }) is the owner's rewrite of a ticked item — a note can be mostly about the
// cut and partly about the color, so a ticked text item is editable before it is copied. An item
// edited to nothing is dropped. Exclusions are copied as they are.
export function applyMemoryChoices(items = [], tickedIds = [], edits = {}) {
  const ticked = new Set(tickedIds)
  const chosen = items
    .filter(item => ticked.has(item.id))
    .map(item => (item.kind === 'exclusion' || !Object.prototype.hasOwnProperty.call(edits, item.id)
      ? item
      : { ...item, text: String(edits[item.id] ?? '').trim() }))
    .filter(item => item.kind === 'exclusion' || item.text)
  return {
    fields: {
      styling_rules_learned: chosen.filter(item => item.kind === 'rule').map(item => item.text),
      tried_and_rejected: chosen.filter(item => item.kind === 'tried').map(item => item.text),
      notes: chosen.find(item => item.kind === 'notes')?.text || '',
      engine_notes: chosen.find(item => item.kind === 'engine_notes')?.text || '',
    },
    exclusions: chosen.filter(item => item.kind === 'exclusion').map(item => item.occasion),
  }
}
