// Q7 — Schema drift between the two tagger prompts.
//
// tagPiecePromptTemplate (styling-engine/prompts.js, used by POST /tag-piece and the importer)
// and the hand-maintained duplicate JSON schema inside POST /extract-pieces (routes/ai.js) are
// supposed to describe the same garments, but the second is not derived from the first — it's a
// separate literal that has to be updated by hand on every field change. This script diffs them
// field-by-field and classifies the consequence of each gap using the app's own confidence-default
// logic (styling-engine/attributes.js's getFieldConfidence), rather than guessing.
//
// Read-only. No DB access, no model call. Source-only diff.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

const promptsSrc = fs.readFileSync(path.join(root, 'styling-engine/prompts.js'), 'utf8')
const aiSrc = fs.readFileSync(path.join(root, 'routes/ai.js'), 'utf8')
const taggerMergeSrc = fs.readFileSync(path.join(root, 'styling-engine/taggerMerge.js'), 'utf8')
const attributesSrc = fs.readFileSync(path.join(root, 'styling-engine/attributes.js'), 'utf8')

// --- Extract the tagPiecePromptTemplate JSON block -------------------------------------------
const tagPieceStart = promptsSrc.indexOf('const tagPiecePromptTemplate')
const tagPieceEnd = promptsSrc.indexOf('\n// ── Dedicated EDITORIAL_NEW_PIECES prompt', tagPieceStart)
if (tagPieceStart === -1 || tagPieceEnd === -1) {
  throw new Error('Could not locate tagPiecePromptTemplate boundaries — prompts.js layout changed, update this script.')
}
const tagPieceBlock = promptsSrc.slice(tagPieceStart, tagPieceEnd)

// --- Extract the /extract-pieces inline JSON schema block -------------------------------------
const extractStart = aiSrc.indexOf("router.post('/extract-pieces'")
const extractEnd = aiSrc.indexOf("router.post('/tag-piece'", extractStart)
if (extractStart === -1 || extractEnd === -1) {
  throw new Error('Could not locate /extract-pieces boundaries — routes/ai.js layout changed, update this script.')
}
const extractBlock = aiSrc.slice(extractStart, extractEnd)

// --- Field-name extraction: top-level '"field_name": "...' or '"field_name": {' / '[' ----------
// Deliberately conservative: only matches quoted keys immediately followed by a colon, at any
// nesting depth, which is enough to enumerate schema fields in these hand-written JSON-literal
// prompts without a full JS/JSON parser (these are template literals with interpolations, so
// JSON.parse can't be used directly).
function extractFieldNames(block) {
  const names = new Set()
  const re = /"([a-zA-Z_][a-zA-Z0-9_]*)":\s*[{["]/g
  let m
  while ((m = re.exec(block))) names.add(m[1])
  return names
}

const tagPieceFields = extractFieldNames(tagPieceBlock)
const extractFields = extractFieldNames(extractBlock)

// --- Confidence-default classification, from the app's own source ------------------------------
const structureFitMatch = attributesSrc.match(/STRUCTURE_FIT_CONFIDENCE_FIELDS = new Set\(\[([\s\S]*?)\]\)/)
const structureFitFields = new Set(
  (structureFitMatch ? structureFitMatch[1] : '')
    .split(',')
    .map(s => s.trim().replace(/^'|'$/g, '').replace(/^"|"$/g, ''))
    .filter(Boolean)
)

const confidenceFieldsMatch = taggerMergeSrc.match(/CONFIDENCE_FIELDS = \[([\s\S]*?)\]/)
const confidenceFields = new Set(
  (confidenceFieldsMatch ? confidenceFieldsMatch[1] : '')
    .split(',')
    .map(s => s.trim().replace(/^'|'$/g, '').replace(/^"|"$/g, ''))
    .filter(Boolean)
)

// Fields that are structurally not applicable to extract-pieces by design (documented in
// garment-field-reference.md — the endpoint has no per-photo authority map, no _confidence
// container, no style_profile_json). These are excluded from the "gap" list since they are not
// comparable per-field content, they are entire missing subsystems, reported separately.
const STRUCTURAL_OMISSIONS = new Set(['_confidence', 'photo_properties', 'style_profile_json', 'cross_photo_agreement_note'])

const missingFromExtract = [...tagPieceFields].filter(f => !extractFields.has(f) && !STRUCTURAL_OMISSIONS.has(f)).sort()
const onlyInExtract = [...extractFields].filter(f => !tagPieceFields.has(f)).sort()

function classify(field) {
  if (!structureFitFields.has(field)) {
    return 'medium (default) — getFieldConfidence returns "medium" for any field not in STRUCTURE_FIT_CONFIDENCE_FIELDS, regardless of tag_state'
  }
  return 'low IF tag_state=provisional, else medium — this field IS in STRUCTURE_FIT_CONFIDENCE_FIELDS, so a photo-bearing clothing piece created via extract-pieces still gets the low-confidence review badge for it'
}

console.log('=== Q7: Tagger schema drift — prompts.js tagPiecePromptTemplate vs. routes/ai.js /extract-pieces ===\n')
console.log(`tagPiecePromptTemplate field count: ${tagPieceFields.size}`)
console.log(`/extract-pieces field count:        ${extractFields.size}\n`)

console.log(`--- Structural omissions in /extract-pieces (whole subsystems, not single fields) ---`)
for (const f of STRUCTURAL_OMISSIONS) {
  const present = tagPieceFields.has(f)
  console.log(`  ${f.padEnd(24)} ${present ? 'present in tag-piece, ABSENT from extract-pieces' : '(not a top-level field in either — check by hand)'}`)
}

console.log(`\n--- Fields the real tagger asks for that /extract-pieces does not (${missingFromExtract.length}) ---`)
for (const f of missingFromExtract) {
  const inConfidenceWhitelist = confidenceFields.has(f) ? 'yes' : 'no'
  console.log(`  ${f.padEnd(24)} confidence-whitelisted: ${inConfidenceWhitelist.padEnd(4)} consequence: ${classify(f)}`)
}

console.log(`\n--- Fields /extract-pieces asks for that tag-piece's schema does not (${onlyInExtract.length}) ---`)
if (onlyInExtract.length === 0) console.log('  (none — extract-pieces is a strict subset of the real tagger schema)')
for (const f of onlyInExtract) console.log(`  ${f}`)

console.log(`\n--- Every field both schemas share still gets a per-endpoint confidence classification ---`)
console.log('For fields both schemas emit, extract-pieces omits the "_confidence" container entirely,')
console.log('so the SAME classify() logic above applies uniformly to every field on an extract-pieces')
console.log('piece, not just the ones missing from its schema. The gap list above is "never even asked for";')
console.log('every other tagger field on an extract-pieces piece is asked for but still never confidence-scored.')
