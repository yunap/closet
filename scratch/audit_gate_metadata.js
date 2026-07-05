import fs from 'fs'
import { db, parsePiece } from '../db.js'
import { confidenceFromProfile } from '../styling-engine/taggerMerge.js'

const GATE_FIELDS = [
  { key: 'fabric_weight', label: 'fabric_weight', value: piece => piece.fabric_weight },
  { key: 'style_profile_json.coverage', label: 'coverage', value: piece => piece.style_profile_json?.coverage },
  { key: 'style_profile_json.bareness', label: 'bareness', value: piece => piece.style_profile_json?.bareness },
  { key: 'sleeve_type', label: 'sleeve_type', value: piece => piece.sleeve_type },
  { key: 'length_hits_at', label: 'length_hits_at', value: piece => piece.length_hits_at },
  { key: 'fiber_content', label: 'fiber_content', value: piece => Array.isArray(piece.fiber_content) && piece.fiber_content.length ? piece.fiber_content : null },
]

const SKIP_CATEGORIES = new Set(['accessory', 'accessories', 'jewelry', 'bag', 'bags', 'belt', 'belts', 'scarf', 'scarves', 'hat', 'hats', 'sunglasses', 'shoes', 'shoe'])

function shouldAuditPiece(piece) {
  const category = String(piece?.category || '').toLowerCase().trim()
  return !SKIP_CATEGORIES.has(category)
}

function isPopulated(value) {
  if (Array.isArray(value)) return value.length > 0
  return value !== null && value !== undefined && String(value).trim() !== ''
}

function confidenceFor(piece, field) {
  if (field.startsWith('style_profile_json.')) {
    return confidenceFromProfile(piece, field.replace(/^style_profile_json\./, '')) || 'unknown'
  }
  return confidenceFromProfile(piece, field) || 'unknown'
}

const allActivePieces = db.prepare("SELECT * FROM pieces WHERE status = 'active' ORDER BY id").all().map(parsePiece)
const pieces = allActivePieces.filter(shouldAuditPiece)
const summary = {}
const missingByPiece = []

for (const field of GATE_FIELDS) {
  summary[field.key] = {
    field: field.key,
    populated: 0,
    total: pieces.length,
    percent: 0,
    confidence: {}
  }
}

for (const piece of pieces) {
  const missing = []
  for (const field of GATE_FIELDS) {
    const value = field.value(piece)
    const populated = isPopulated(value)
    if (populated) summary[field.key].populated += 1
    else missing.push(field.key)
    const confidence = confidenceFor(piece, field.key)
    summary[field.key].confidence[confidence] = (summary[field.key].confidence[confidence] || 0) + 1
  }
  if (missing.length) {
    missingByPiece.push({
      id: piece.id,
      name: piece.name,
      category: piece.category,
      photo: piece.photo || null,
      worn_photo: piece.worn_photo || null,
      missing
    })
  }
}

for (const item of Object.values(summary)) {
  item.percent = item.total ? Number((item.populated / item.total * 100).toFixed(1)) : 0
}

console.table(Object.values(summary).map(item => ({
  field: item.field,
  populated: item.populated,
  total: item.total,
  percent: `${item.percent}%`,
  confidence: JSON.stringify(item.confidence)
})))

if (missingByPiece.length) {
  console.log('\nPieces with missing gate metadata:')
  for (const piece of missingByPiece) {
    console.log(`- ${piece.id} ${piece.name}: ${piece.missing.join(', ')}`)
  }
}

const output = {
  generatedAt: new Date().toISOString(),
  activePieceCountBeforeCategorySkip: allActivePieces.length,
  activePieceCount: pieces.length,
  skippedCategoryCount: allActivePieces.length - pieces.length,
  fields: summary,
  missingByPiece
}

fs.writeFileSync('scratch/gate_metadata_audit.json', JSON.stringify(output, null, 2))
console.log('\nWrote scratch/gate_metadata_audit.json')
