import fs from 'fs'
import path from 'path'
import { db, parsePiece, uploadsDir } from '../db.js'
import { askStylist, prepareImageForClaude } from '../styling-engine/provider.js'
import { applyTaggerResult, normalizeManualOverrides, pinManualConfidence, tagStateForTaggerResult } from '../styling-engine/taggerMerge.js'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const limitArg = args.find((arg, index) => args[index - 1] === '--limit')
const limit = Number.isFinite(Number(limitArg)) ? Math.max(0, Number(limitArg)) : Infinity
const auditPath = 'scratch/gate_metadata_audit.json'
const anchorsPath = 'scratch/formality_anchors.json'

if (!fs.existsSync(auditPath)) {
  console.error(`Missing ${auditPath}. Run node scratch/audit_gate_metadata.js first.`)
  process.exit(1)
}

function parseJsonOrExit(raw, label) {
  try {
    return JSON.parse(raw)
  } catch (err) {
    console.error(`Could not parse ${label}: ${err.message}`)
    process.exit(1)
  }
}

const audit = parseJsonOrExit(fs.readFileSync(auditPath, 'utf8'), auditPath)
const missingRows = Array.isArray(audit.missingByPiece) ? audit.missingByPiece : []
const plan = missingRows.slice(0, limit)
const SKIP_CATEGORIES = new Set(['accessory', 'accessories', 'jewelry', 'bag', 'bags', 'belt', 'belts', 'scarf', 'scarves', 'hat', 'hats', 'sunglasses', 'shoes', 'shoe'])
const FORMALITY_VALUES = new Set(['lounge', 'everyday', 'elevated', 'dressy'])

const formalityAnchors = fs.existsSync(anchorsPath)
  ? parseJsonOrExit(fs.readFileSync(anchorsPath, 'utf8'), anchorsPath)
  : []
const anchorsById = new Map((Array.isArray(formalityAnchors) ? formalityAnchors : [])
  .map(anchor => ({
    id: Number(anchor.id),
    name: String(anchor.name || '').trim(),
    formality: String(anchor.formality || '').toLowerCase().trim()
  }))
  .filter(anchor => Number.isFinite(anchor.id) && FORMALITY_VALUES.has(anchor.formality))
  .map(anchor => [anchor.id, anchor]))

function shouldBackfillPiece(piece) {
  const category = String(piece?.category || '').toLowerCase().trim()
  return !SKIP_CATEGORIES.has(category)
}

console.log(`${apply ? 'APPLY' : 'DRY RUN'} gate metadata backfill`)
console.log(`Planned pieces: ${plan.length}`)
console.log(`Estimated vision calls: ${plan.length}`)
console.log(`Estimated model cost: review provider pricing for ${plan.length} narrow image calls before applying.`)
if (anchorsById.size) {
  console.log(`Loaded ${anchorsById.size} formality calibration anchors from ${anchorsPath}`)
} else if (plan.some(row => (row.missing || []).includes('formality'))) {
  console.log(`WARNING: no ${anchorsPath} found. Formality backfill is possible, but anchor calibration should be added before --apply.`)
}

function getPath(obj, dotted) {
  return String(dotted).split('.').reduce((acc, key) => acc && acc[key], obj)
}

function pickTouched(piece, fields = []) {
  return Object.fromEntries(fields.map(field => [field, getPath(piece, field)]))
}

function fieldAppliesToPiece(field, piece) {
  const category = String(piece?.category || '').toLowerCase().trim()
  if (field === 'heel_height' || field === 'walk_support') return category === 'shoes' || category === 'shoe'
  if (['fabric_weight', 'fiber_content', 'sleeve_type', 'length_hits_at', 'style_profile_json.coverage', 'style_profile_json.bareness'].includes(field)) {
    return !SKIP_CATEGORIES.has(category)
  }
  return true
}

function schemaFor(fields = []) {
  const wants = new Set(fields)
  const schema = {}
  if (wants.has('fabric_weight')) schema.fabric_weight = 'ultralight|light|medium|heavy'
  if (wants.has('fiber_content')) {
    schema.fiber_content = ['canonical fibers only: wool, merino, cashmere, alpaca, mohair, fleece, down, cotton, linen, silk, tencel, modal, rayon, viscose, polyester, nylon, acrylic, spandex, leather, suede, denim, unknown']
  }
  if (wants.has('formality')) schema.formality = 'lounge|everyday|elevated|dressy'
  if (wants.has('heel_height')) schema.heel_height = 'flat|low|mid|high'
  if (wants.has('walk_support')) schema.walk_support = 'high|medium|low'
  if (wants.has('sleeve_type')) schema.sleeve_type = 'sleeveless|cap|short|3/4|long|bell|bishop|none'
  if (wants.has('length_hits_at')) schema.length_hits_at = 'crop|waist|hip|mid-thigh|knee|midi|maxi|full-length'
  const profile = {}
  if (wants.has('style_profile_json.coverage')) profile.coverage = 'normal|full-insulating'
  if (wants.has('style_profile_json.bareness')) profile.bareness = 'normal|high'
  if (Object.keys(profile).length) schema.style_profile_json = profile
  schema._confidence = Object.fromEntries(fields.map(field => [
    field.replace(/^style_profile_json\./, ''),
    'high|medium|low'
  ]))
  return schema
}

function formalityCalibrationText() {
  if (!anchorsById.size) return ''
  const rows = [...anchorsById.values()]
    .map(anchor => `- ${anchor.id} ${anchor.name || '(unnamed piece)'}: ${anchor.formality}`)
    .join('\n')
  return `\nYuna-labeled formality anchors. Calibrate this wardrobe against these labels; do not copy labels blindly:\n${rows}\n`
}

function pinFormalityAnchor(piece) {
  const anchor = anchorsById.get(Number(piece.id))
  if (!anchor) return false
  const manualOverrides = [...new Set([...normalizeManualOverrides(piece.manual_overrides), 'formality'])]
  const profile = pinManualConfidence(piece.style_profile_json || {}, manualOverrides)
  db.prepare(`
    UPDATE pieces SET formality = ?, style_profile_json = ?, manual_overrides = ?
    WHERE id = ?
  `).run(anchor.formality, JSON.stringify(profile), JSON.stringify(manualOverrides), piece.id)
  console.log(`ANCHOR ${piece.id} ${piece.name}: pinned formality=${anchor.formality} with manual confidence`)
  return true
}

async function collectPieceImages(piece) {
  const candidates = [
    {
      file: piece.photo,
      label: 'HANGER PHOTO',
      guidance: 'Use for literal garment truth: color, fabric, construction, pattern, shape, and category.'
    },
    {
      file: piece.worn_photo,
      label: 'WORN PHOTO',
      guidance: 'Use for fit, drape, scale, real-wear register, polish level, and how formal the garment reads on a body. Ignore surrounding outfit styling or setting unless it clarifies the garment itself.'
    }
  ]
  const images = []
  for (const candidate of candidates) {
    if (!candidate.file) continue
    const filePath = path.join(uploadsDir, candidate.file)
    if (!fs.existsSync(filePath)) {
      console.log(`NOTE ${piece.id} ${piece.name}: missing ${candidate.label.toLowerCase()} file ${candidate.file}`)
      continue
    }
    const image = await prepareImageForClaude(filePath)
    images.push({ ...candidate, ...image })
  }
  return images
}

async function retagPiece(row) {
  const piece = parsePiece(db.prepare('SELECT * FROM pieces WHERE id = ?').get(row.id))
  if (!piece) return
  const pinnedAnchor = apply && pinFormalityAnchor(piece)
  if (!piece.photo && !piece.worn_photo) {
    console.log(`SKIP ${row.id} ${row.name}: no photo`)
    return
  }
  const fields = (row.missing || [])
    .filter(field => !(pinnedAnchor && field === 'formality'))
    .filter(field => fieldAppliesToPiece(field, piece))
  if (!fields.length) return
  if (apply && fields.includes('formality') && !anchorsById.size) {
    console.log(`SKIP ${row.id} ${row.name}: formality backfill needs ${anchorsPath} calibration anchors before --apply`)
    return
  }
  console.log(`\n${apply ? 'Retagging' : 'Would retag'} ${piece.id} ${piece.name}`)
  console.log('Missing:', fields.join(', '))
  console.log('Before:', JSON.stringify(pickTouched(piece, fields), null, 2))
  if (!apply) return

  const images = await collectPieceImages(piece)
  if (!images.length) {
    console.log(`SKIP ${row.id} ${row.name}: no existing image files`)
    return
  }
  console.log(`Images: ${images.map(image => image.label).join(', ')}`)
  const raw = await askStylist({
    system: 'Return ONLY valid JSON for missing wardrobe gate metadata. Do not include fields outside the requested schema. Formality is a register field, not a broad style compliment.',
    maxTokens: 700,
    messages: [{
      role: 'user',
      content: [
        ...images.flatMap(image => [
          { type: 'text', text: `${image.label}: ${image.guidance}` },
          { type: 'image', source: { type: 'base64', media_type: image.mime, data: image.base64 } }
        ]),
        { type: 'text', text: `Piece: ${piece.name}\nCategory: ${piece.category}\nFormality rubric:\n- lounge: athletic/home comfort construction.\n- everyday: no-intent wear; matte or naturally textured fabrics, simple construction; artisan texture alone stays everyday.\n- elevated: visible refinement requiring intent; refined drape, deliberate structure, polished finish, statement construction.\n- dressy: going-out signals; sheen, lace, sequins, delicate straps, formal tailoring, heels-adjacent styling.\nFor shoes, heel_height is physical heel lift; walk_support is stability for lots of walking.\n${formalityCalibrationText()}\nReturn only this narrow JSON schema:\n${JSON.stringify(schemaFor(fields), null, 2)}` }
      ]
    }]
  })
  const cleaned = String(raw || '').trim().replace(/^```json\n?|\n?```$/g, '').trim()
  let tags
  try {
    tags = JSON.parse(cleaned)
  } catch (err) {
    console.log(`SKIP ${piece.id} ${piece.name}: model returned invalid JSON (${err.message})`)
    return
  }
  tags.tag_state = tagStateForTaggerResult(tags, piece)
  const merged = applyTaggerResult(piece, tags)
  const fieldSet = new Set(fields)
  db.prepare(`
    UPDATE pieces SET
      fabric_weight = ?,
      fiber_content = ?,
      formality = ?,
      heel_height = ?,
      walk_support = ?,
      sleeve_type = ?,
      length_hits_at = ?,
      style_profile_json = ?,
      tag_state = ?
    WHERE id = ?
  `).run(
    fieldSet.has('fabric_weight') ? (merged.fabric_weight || null) : (piece.fabric_weight || null),
    fieldSet.has('fiber_content') ? JSON.stringify(merged.fiber_content || []) : JSON.stringify(piece.fiber_content || []),
    fieldSet.has('formality') ? (merged.formality || null) : (piece.formality || null),
    fieldSet.has('heel_height') ? (merged.heel_height || null) : (piece.heel_height || null),
    fieldSet.has('walk_support') ? (merged.walk_support || null) : (piece.walk_support || null),
    fieldSet.has('sleeve_type') ? (merged.sleeve_type || null) : (piece.sleeve_type || null),
    fieldSet.has('length_hits_at') ? (merged.length_hits_at || null) : (piece.length_hits_at || null),
    JSON.stringify(merged.style_profile_json || {}),
    merged.tag_state || piece.tag_state || 'provisional',
    piece.id
  )
  const after = parsePiece(db.prepare('SELECT * FROM pieces WHERE id = ?').get(piece.id))
  console.log('After:', JSON.stringify(pickTouched(after, fields), null, 2))
}

for (const row of plan) {
  await retagPiece(row)
}

if (!apply) {
  console.log('\nDry run only. Re-run with --apply to write updates.')
} else {
  console.log('\nApply complete. Re-run node scratch/audit_gate_metadata.js and review scratch/formality_contact_sheets/*.jpg before enabling register gates.')
}
