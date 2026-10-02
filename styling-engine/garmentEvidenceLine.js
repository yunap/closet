// SHARED GARMENT EVIDENCE (docs/garment-evidence-parity-2026-09-15.md): the one default garment-evidence path for the chat flows —
// Whole Wardrobe, selected-piece and repair composers, /ask single_outfit, and trip composition.
//
// Three channels, so the same garment reaches the model with the same evidence whichever chat path received the request:
//
// 1. The FACT LINE — compact, recorded, physical facts on every catalog or roster row. No prose, no rules, no derived warmth
//    or thermal summary, no weather verdict. Unknown is stated for sleeve length (tops, dresses, outerwear) and fibre;
//    a tagger low-confidence value carries `?`; whole-garment fields are grouped under `whole garment:` because the model
//    has read garment-level weight as a sleeve property. Each path keeps its own identity prefix; the facts are identical.
//
// 2. GARMENT NOTES — selective, source-labelled records about the garment, delivered only where garments are chosen among (the
//    Whole Wardrobe roster, the trip roster, the pieces a /ask turn inspects). Only what the app has recorded about this garment
//    beyond its tags: a description edited in the app, the owner's stored rules (`RULES (authoritative)`, minus receipts, retired
//    reaction copies and saved chat replies — ruleProvenance.js), and rejections. A garment with none of these gets no entry.
//
// 3. TAGGER NOTES — only the tagger's unedited impression (the read that left the discovery catalog), labelled "not owner-verified",
//    delivered on /ask view_pieces for inspected pieces. Tagger pairing cautions are NOT part of change 1: /ask never carried them, so
//    adding them would be a separate model-guidance change, not factual parity.
//
// The free `notes` field is not carried: the record cannot attribute it.
import { wardrobeCategoryGroup, getFieldConfidence } from './attributes.js'
import { insulatingLayerMaterials, interiorConstruction, normalizeFiberContent } from './fiberTaxonomy.js'
import { storedGarmentRules } from './ruleProvenance.js'

// Stated once per request on every path that uses the fact line.
export const GARMENT_FACT_CONVENTIONS = 'Garment facts are recorded values only. `?` marks a value the tagger recorded with low confidence; `unknown` means not recorded; values after `whole garment:` describe the entire garment, not its sleeves, lining or any single part. An absent fact is not recorded and must not be inferred. Source-labelled garment notes, where given, are not recorded facts.'
export const GARMENT_NOTES_HEADING = 'GARMENT NOTES — saved records for some pieces shown (source-labelled; not recorded facts):'

// `other` is a recorded answer ("tagged, not one of the listed values") and is carried; none/unknown/n/a/null are not recorded values.
const clean = value => {
  const text = String(value ?? '').trim()
  return text && !['none', 'unknown', 'n/a', 'null'].includes(text.toLowerCase()) ? text : ''
}
const CONFIDENCE_MARKED = new Set(['fabric_category', 'fabric_weight', 'stretch', 'fit_on_body', 'silhouette', 'length_hits_at', 'hem_finish', 'sleeve_length', 'sleeve_shape', 'neckline'])
const parsedList = value => {
  if (Array.isArray(value)) return value
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
}
const list = value => parsedList(value).map(clean).filter(Boolean)

// ONE SET OF RECORDED FACTS, TWO RENDERINGS (docs/garment-evidence-parity-2026-09-15.md §4). garmentEvidenceFields is the single
// source; the full fact line (Whole Wardrobe, trip, /ask view_pieces) and the sparse /ask discovery row are both rendered from it,
// and each has a decoder, so a test can prove both strings reconstruct exactly these fields — facts and unknowns alike.
// A field is [key, value]; value is a string (a tagger low-confidence value ends in `?`) or, for list facts, an array.
export function garmentEvidenceFields(piece = {}) {
  const group = wardrobeCategoryGroup(piece) || String(piece.category || 'other')
  const clothing = ['top', 'bottom', 'dress', 'outerwear'].includes(group)
  const value = field => {
    const text = clean(piece[field])
    if (!text) return ''
    return CONFIDENCE_MARKED.has(field) && getFieldConfidence(piece, field) === 'low' ? `${text}?` : text
  }
  const fields = []
  const add = (key, v) => { if (Array.isArray(v) ? v.length : v) fields.push([key, v]) }
  add('category', `${group}${group === 'bottom' && clean(piece.bottom_subtype) ? ` (${piece.bottom_subtype})` : ''}`)
  add('fabric', value('fabric_category'))
  // normalizeFiberContent drops 'unknown', so the recorded list is read for it directly: a partly unknown record keeps it.
  const recordedFibres = parsedList(piece.fiber_content)
  const named = normalizeFiberContent(recordedFibres).filter(fibre => fibre !== 'unknown')
  const recordsUnknown = recordedFibres.some(fibre => String(fibre || '').trim().toLowerCase() === 'unknown')
  fields.push(['fibre', named.length ? [...named, ...(recordsUnknown ? ['unknown'] : [])] : ['unknown']])
  if (clothing) {
    add('weight', value('fabric_weight'))
    add('stretch', value('stretch'))
    add('fit', value('fit_on_body'))
    add('silhouette', value('silhouette'))
    add('length', value('length_hits_at'))
    add('hem', value('hem_finish'))
    add('opacity', value('opacity'))
    // needs_base is `yes | no | null` and null means not recorded, never "no" (garment-field-reference.md): both recorded values are carried.
    const needsBase = String(piece.needs_base || '').toLowerCase().trim()
    if (needsBase === 'yes' || needsBase === 'no') fields.push(['needs_base', needsBase])
  }
  // A shoe or accessory can still carry a recorded silhouette or fit (a structured bag, a boxy clutch); the production catalog carried
  // them for every category, so they are carried here when recorded — never inferred for a category that does not tag them.
  if (!clothing) {
    add('fit', value('fit_on_body'))
    add('silhouette', value('silhouette'))
  }
  if (['top', 'dress', 'outerwear'].includes(group)) {
    fields.push(['sleeves', value('sleeve_length') || 'unknown'])
    add('sleeve_shape', value('sleeve_shape'))
    add('neckline', value('neckline'))
  }
  if (['top', 'dress', 'outerwear'].includes(group)) add('tuck', value('tuck_behavior'))
  if (group === 'bottom') {
    add('waistband', value('waistband_type'))
    add('bottom_shape', value('bottom_shape'))
    add('leg_opening', value('leg_opening'))
  }
  if (group === 'outerwear') {
    const layer = insulatingLayerMaterials(piece)
    fields.push(['insulating_layer', layer === null ? 'not recorded' : layer.length ? [...layer] : 'none'])
    fields.push(['interior', String(interiorConstruction(piece))])
  }
  add('protection', list(piece.weather_protection))
  if (group === 'shoes') {
    add('shoe_type', value('shoe_type'))
    add('toe', value('toe_shape'))
    add('heel', value('heel_height'))
    add('walk_support', value('walk_support'))
    add('visual_weight', value('visual_weight'))
  }
  if (group === 'accessory') {
    add('visual_weight', value('visual_weight'))
    add('accessory_type', value('accessory_subtype'))
    add('jewelry', value('jewelry_type'))
    add('necklace_length', value('necklace_length'))
  }
  add('colours', list(piece.colors))
  // pattern_type is the recorded pattern: a recorded solid is stated as solid. A recorded scale or complexity is kept even when the
  // type itself is not recorded (`unknown, medium`); with nothing recorded the pattern is absent.
  const patternType = clean(piece.pattern_type)
  const patternDetail = [piece.pattern_scale, piece.pattern_complexity].map(clean).filter(Boolean)
  if (patternType === 'solid') fields.push(['pattern', ['solid']])
  else if (patternType || patternDetail.length) fields.push(['pattern', [patternType || 'unknown', ...patternDetail]])
  add('formality', value('formality'))
  add('season', value('season'))
  if (piece.tag_state === 'provisional') fields.push(['tags', 'provisional'])
  return fields
}

// ── Full fact line ──
const RICH_LABELS = { fabric: 'fabric', fibre: 'fibre', silhouette: 'silhouette', length: 'length', hem: 'hem', opacity: 'opacity', sleeves: 'sleeves', sleeve_shape: 'sleeve shape', neckline: 'neckline', tuck: 'tuck', waistband: 'waistband', bottom_shape: 'bottom shape', leg_opening: 'leg opening', insulating_layer: 'insulating layer', interior: 'interior', protection: 'protection', shoe_type: 'type', toe: 'toe', heel: 'heel', walk_support: 'walk support', accessory_type: 'type', jewelry: 'jewelry', necklace_length: 'necklace length', visual_weight: 'visual weight', colours: 'colours', pattern: 'pattern' }
const WHOLE_GARMENT = ['weight', 'stretch', 'fit']
const TAGGED = ['formality', 'season']
const richValue = v => (Array.isArray(v) ? v.join(', ') : v)

export function renderGarmentFactLine(fields = []) {
  const map = new Map(fields)
  const out = []
  let wholeDone = false, taggedDone = false
  for (const [key, v] of fields) {
    if (key === 'category') out.push(v)
    else if (WHOLE_GARMENT.includes(key)) {
      if (!wholeDone) { out.push(`whole garment: ${WHOLE_GARMENT.filter(k => map.has(k)).map(k => `${k} ${map.get(k)}`).join(', ')}`); wholeDone = true }
    } else if (TAGGED.includes(key)) {
      if (!taggedDone) { out.push(`tagged ${TAGGED.filter(k => map.has(k)).map(k => `${k} ${map.get(k)}`).join(', ')}`); taggedDone = true }
    } else if (key === 'needs_base') out.push(v === 'no' ? 'needs no base layer' : 'needs a base layer')
    else if (key === 'tags') out.push('tags provisional')
    else out.push(`${RICH_LABELS[key]} ${richValue(v)}`)
  }
  return out.join('; ')
}

export function sharedGarmentEvidenceFacts(piece = {}) {
  return renderGarmentFactLine(garmentEvidenceFields(piece))
}

// Decodes a full fact line back to fields (keys in line order; list facts as arrays).
const RICH_LIST_KEYS = new Set(['fibre', 'protection', 'colours', 'pattern'])
export function decodeGarmentFactLine(line = '') {
  const parts = String(line).split('; ')
  const fields = [['category', parts.shift()]]
  const group = String(fields[0][1]).split(' ')[0]
  const byLabel = Object.entries(RICH_LABELS)
    .filter(([key]) => !((key === 'shoe_type' && group !== 'shoes') || (key === 'accessory_type' && group !== 'accessory')))
    .sort((a, b) => b[1].length - a[1].length)
  for (const part of parts) {
    if (part.startsWith('whole garment: ')) { for (const item of part.slice(15).split(', ')) { const at = item.indexOf(' '); fields.push([item.slice(0, at), item.slice(at + 1)]) } continue }
    if (part.startsWith('tagged ')) { for (const item of part.slice(7).split(', ')) { const at = item.indexOf(' '); fields.push([item.slice(0, at), item.slice(at + 1)]) } continue }
    if (part === 'needs a base layer') { fields.push(['needs_base', 'yes']); continue }
    if (part === 'needs no base layer') { fields.push(['needs_base', 'no']); continue }
    if (part === 'tags provisional') { fields.push(['tags', 'provisional']); continue }
    const match = byLabel.find(([, label]) => part.startsWith(`${label} `))
    if (!match) throw new Error(`unrecognised fact: ${part}`)
    const [key, label] = match
    const raw = part.slice(label.length + 1)
    fields.push([key, RICH_LIST_KEYS.has(key) || (key === 'insulating_layer' && !['none', 'not recorded'].includes(raw)) ? raw.split(', ') : raw])
  }
  return fields
}

// ── Sparse discovery row (/ask catalog) ──
// The production catalog's sparse, default-aware format, carrying the same facts as the full line. Short production keys; lists
// joined with `/`; dominant values omitted by stated convention, and a field that has such a default but is NOT recorded written
// `key:unknown`, so omission never hides a missing value. Everything else omitted is not recorded.
const SPARSE_KEYS = { fabric: 'fab', fibre: 'fibre', weight: 'weight', stretch: 'stretch', fit: 'fit', silhouette: 'sil', length: 'len', hem: 'hem', opacity: 'opacity', needs_base: 'needs-base', sleeves: 'slv', sleeve_shape: 'slvshape', neckline: 'neck', tuck: 'tuck', waistband: 'waist', bottom_shape: 'shape', leg_opening: 'leg', insulating_layer: 'insulation', interior: 'interior', protection: 'protect', shoe_type: 'type', toe: 'toe', heel: 'heel', walk_support: 'support', visual_weight: 'vweight', accessory_type: 'type', jewelry: 'jewelry', necklace_length: 'necklace', colours: 'clr', pattern: 'pat', formality: 'formal', season: 'season', tags: 'tags' }
// Defaults apply only where the full line would state the field for that category.
const SPARSE_DEFAULTS = { opacity: { value: 'opaque', groups: ['top', 'bottom', 'dress', 'outerwear'] }, tuck: { value: 'tucks_anywhere', groups: ['top'] }, pattern: { value: ['solid'] }, formality: { value: 'everyday' }, season: { value: 'year-round' } }
const sameValue = (a, b) => JSON.stringify([].concat(a)) === JSON.stringify([].concat(b))
const SPARSE_LIST_KEYS = new Set(['fibre', 'protection', 'colours', 'pattern'])
const defaultApplies = (key, group) => SPARSE_DEFAULTS[key] && (!SPARSE_DEFAULTS[key].groups || SPARSE_DEFAULTS[key].groups.includes(group))

export const SPARSE_CATALOG_CONVENTIONS = 'Rows are sparse; each row is `#id name | category | facts`. Omitted pat means solid; omitted opacity means opaque; omitted tuck on a top means tucks_anywhere; omitted formal means everyday; omitted season means year-round — when one of these is not recorded it is written `:unknown`. needs-base marks a recorded yes and needs-base:no a recorded no; omitted needs-base is not recorded. fibre and, on tops, dresses and outerwear, slv are always stated (`unknown` when not recorded). fab is fabric type; weight is textile weight; vweight is a shoe\'s or accessory\'s visual scale. protect lists recorded meaningful rain or wind protection; omitted protect means none recorded. weight, stretch and fit describe the whole garment, not its sleeves, lining or any single part. `?` marks a value the tagger recorded with low confidence. Occasion tags are omitted because every row already survived this request\'s occasion gate. Every other omitted fact is not recorded and must not be inferred. view_pieces truth spells the same facts out in full (lists comma-separated, weight/stretch/fit grouped under `whole garment:`, formality and season under `tagged`), with the same `?` and `unknown` markers, where an absent fact is not recorded; saved notes and tagger notes, when given there, are not recorded facts.'

export function renderSparseCatalogFacts(fields = []) {
  const map = new Map(fields)
  const group = String(map.get('category') || '').split(' ')[0]
  const facts = []
  for (const [key, v] of fields) {
    if (key === 'category') continue
    if (defaultApplies(key, group) && sameValue(v, SPARSE_DEFAULTS[key].value)) continue
    if (key === 'needs_base') { facts.push(v === 'no' ? 'needs-base:no' : 'needs-base'); continue }
    facts.push(`${SPARSE_KEYS[key]}:${Array.isArray(v) ? v.join(key === 'fibre' || key === 'insulating_layer' ? '+' : '/') : v}`)
  }
  for (const key of Object.keys(SPARSE_DEFAULTS)) {
    if (defaultApplies(key, group) && !map.has(key)) facts.push(`${SPARSE_KEYS[key]}:unknown`)
  }
  return `${map.get('category')} | ${facts.join(';')}`
}

export function sparseGarmentCatalogRow(piece = {}) {
  return `#${Number(piece.id)} ${piece.name || 'unnamed'} | ${renderSparseCatalogFacts(garmentEvidenceFields(piece))}`
}

// Decodes a sparse row's `category | facts` part back to fields in canonical order (the order garmentEvidenceFields uses).
const CANONICAL_ORDER = ['category', 'fabric', 'fibre', 'weight', 'stretch', 'fit', 'silhouette', 'length', 'hem', 'opacity', 'needs_base', 'sleeves', 'sleeve_shape', 'neckline', 'tuck', 'waistband', 'bottom_shape', 'leg_opening', 'insulating_layer', 'interior', 'protection', 'shoe_type', 'toe', 'heel', 'walk_support', 'visual_weight', 'accessory_type', 'jewelry', 'necklace_length', 'colours', 'pattern', 'formality', 'season', 'tags'] // shoes put visual_weight after walk support, accessories before type; neither group has the other's keys
export function decodeSparseCatalogFacts(text = '') {
  const at = String(text).indexOf(' | ')
  const category = at < 0 ? String(text) : text.slice(0, at)
  const group = category.split(' ')[0]
  const found = new Map([['category', category]])
  const byShortKey = new Map(Object.entries(SPARSE_KEYS)
    .filter(([key]) => !((key === 'shoe_type' && group !== 'shoes') || (key === 'accessory_type' && group !== 'accessory')))
    .map(([key, short]) => [short, key]))
  for (const item of (at < 0 ? '' : text.slice(at + 3)).split(';').filter(Boolean)) {
    if (item === 'needs-base') { found.set('needs_base', 'yes'); continue }
    if (item === 'needs-base:no') { found.set('needs_base', 'no'); continue }
    const colon = item.indexOf(':')
    const key = byShortKey.get(item.slice(0, colon))
    if (!key) throw new Error(`unrecognised sparse fact: ${item}`)
    const raw = item.slice(colon + 1)
    if (defaultApplies(key, group) && raw === 'unknown') { found.set(key, null); continue }
    found.set(key, key === 'fibre' || (key === 'insulating_layer' && !['none', 'not recorded'].includes(raw)) ? raw.split('+') : SPARSE_LIST_KEYS.has(key) ? raw.split('/') : raw)
  }
  for (const key of Object.keys(SPARSE_DEFAULTS)) {
    if (defaultApplies(key, group) && !found.has(key)) found.set(key, Array.isArray(SPARSE_DEFAULTS[key].value) ? [...SPARSE_DEFAULTS[key].value] : SPARSE_DEFAULTS[key].value)
  }
  return CANONICAL_ORDER.filter(key => found.has(key) && found.get(key) !== null).map(key => [key, found.get(key)])
}

export function sharedGarmentEvidenceLine(piece = {}) {
  return `ID ${Number(piece.id)}: ${piece.name || 'unnamed'}; ${sharedGarmentEvidenceFacts(piece)}`
}

const oneLine = value => String(value || '').replace(/\s+/g, ' ').trim()
const prose = value => (Array.isArray(value) ? value : parsedList(value)).map(oneLine).filter(Boolean)

export function garmentNotesText(piece = {}) {
  const parts = []
  const read = oneLine(piece.reads_as)
  if (read && list(piece.manual_overrides).includes('reads_as')) parts.push(`description edited in the app (author not recorded): ${read}`)
  const rules = storedGarmentRules(piece).map(oneLine).filter(Boolean)
  if (rules.length) parts.push(`RULES (authoritative): ${rules.join(' | ')}`)
  const rejected = prose(piece.tried_and_rejected)
  if (rejected.length) parts.push(`REJECTED: ${rejected.join(' | ')}`)
  return parts.join('; ')
}

export function taggerNotesText(piece = {}) {
  const parts = []
  const read = oneLine(piece.reads_as)
  if (read && !list(piece.manual_overrides).includes('reads_as')) parts.push(`tagger impression (not owner-verified): ${read}`)
  return parts.join('; ')
}

// One entry per garment that has notes; '' when it has none. Deliberately not prefixed `ID n:`, so it can never be read as a fact line.
export function garmentNotesEntry(piece = {}) {
  const text = garmentNotesText(piece)
  return text ? `- #${Number(piece.id)} ${piece.name || 'unnamed'}: ${text}` : ''
}

export function garmentNotesBlock(pieces = []) {
  const entries = pieces.map(garmentNotesEntry).filter(Boolean)
  return entries.length ? `${GARMENT_NOTES_HEADING}\n${entries.join('\n')}` : ''
}
