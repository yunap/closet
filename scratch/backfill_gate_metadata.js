import fs from 'fs'
import path from 'path'
import { db, parsePiece, uploadsDir } from '../db.js'
import { askStylist, prepareImageForClaude } from '../styling-engine/provider.js'
import { applyTaggerResult, tagStateForTaggerResult } from '../styling-engine/taggerMerge.js'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const limitArg = args.find((arg, index) => args[index - 1] === '--limit')
const limit = Number.isFinite(Number(limitArg)) ? Math.max(0, Number(limitArg)) : Infinity
const auditPath = 'scratch/gate_metadata_audit.json'

if (!fs.existsSync(auditPath)) {
  console.error(`Missing ${auditPath}. Run node scratch/audit_gate_metadata.js first.`)
  process.exit(1)
}

const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'))
const missingRows = Array.isArray(audit.missingByPiece) ? audit.missingByPiece : []
const plan = missingRows.slice(0, limit)
const SKIP_CATEGORIES = new Set(['accessory', 'accessories', 'jewelry', 'bag', 'bags', 'belt', 'belts', 'scarf', 'scarves', 'hat', 'hats', 'sunglasses', 'shoes', 'shoe'])

function shouldBackfillPiece(piece) {
  const category = String(piece?.category || '').toLowerCase().trim()
  return !SKIP_CATEGORIES.has(category)
}

console.log(`${apply ? 'APPLY' : 'DRY RUN'} gate metadata backfill`)
console.log(`Planned pieces: ${plan.length}`)
console.log(`Estimated vision calls: ${plan.length}`)
console.log(`Estimated model cost: review provider pricing for ${plan.length} narrow image calls before applying.`)

function getPath(obj, dotted) {
  return String(dotted).split('.').reduce((acc, key) => acc && acc[key], obj)
}

function pickTouched(piece, fields = []) {
  return Object.fromEntries(fields.map(field => [field, getPath(piece, field)]))
}

function schemaFor(fields = []) {
  const wants = new Set(fields)
  const schema = {}
  if (wants.has('fabric_weight')) schema.fabric_weight = 'ultralight|light|medium|heavy'
  if (wants.has('fiber_content')) {
    schema.fiber_content = ['canonical fibers only: wool, merino, cashmere, alpaca, mohair, fleece, down, cotton, linen, silk, tencel, modal, rayon, viscose, polyester, nylon, acrylic, spandex, leather, suede, denim, unknown']
  }
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

async function retagPiece(row) {
  const piece = parsePiece(db.prepare('SELECT * FROM pieces WHERE id = ?').get(row.id))
  if (!piece) return
  if (!shouldBackfillPiece(piece)) {
    console.log(`SKIP ${row.id} ${row.name}: category ${piece.category} is not weather-gate backfilled`)
    return
  }
  const photoFile = piece.photo || piece.worn_photo
  if (!photoFile) {
    console.log(`SKIP ${row.id} ${row.name}: no photo`)
    return
  }
  const filePath = path.join(uploadsDir, photoFile)
  if (!fs.existsSync(filePath)) {
    console.log(`SKIP ${row.id} ${row.name}: missing file ${photoFile}`)
    return
  }
  const fields = row.missing || []
  console.log(`\n${apply ? 'Retagging' : 'Would retag'} ${piece.id} ${piece.name}`)
  console.log('Missing:', fields.join(', '))
  console.log('Before:', JSON.stringify(pickTouched(piece, fields), null, 2))
  if (!apply) return

  const image = await prepareImageForClaude(filePath)
  const raw = await askStylist({
    system: 'Return ONLY valid JSON for missing wardrobe gate metadata. Do not include aesthetic fields outside the requested schema.',
    maxTokens: 700,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: image.mime, data: image.base64 } },
        { type: 'text', text: `Piece: ${piece.name}\nCategory: ${piece.category}\nReturn only this narrow JSON schema:\n${JSON.stringify(schemaFor(fields), null, 2)}` }
      ]
    }]
  })
  const tags = JSON.parse(String(raw || '').trim().replace(/^```json\n?|\n?```$/g, '').trim())
  tags.tag_state = tagStateForTaggerResult(tags, piece)
  const merged = applyTaggerResult(piece, tags)
  db.prepare(`
    UPDATE pieces SET
      fabric_weight = ?,
      fiber_content = ?,
      sleeve_type = ?,
      length_hits_at = ?,
      style_profile_json = ?,
      tag_state = ?
    WHERE id = ?
  `).run(
    merged.fabric_weight || null,
    JSON.stringify(merged.fiber_content || []),
    merged.sleeve_type || null,
    merged.length_hits_at || null,
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
}
