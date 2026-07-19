import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { db, parsePiece, userUploadsDir } from '../db.js'
import { confidenceFromProfile } from '../styling-engine/taggerMerge.js'

const FORMALITY_VALUES = ['lounge', 'everyday', 'elevated', 'dressy']
const WEATHER_SKIP_CATEGORIES = new Set(['accessory', 'accessories', 'jewelry', 'bag', 'bags', 'belt', 'belts', 'scarf', 'scarves', 'hat', 'hats', 'sunglasses', 'shoes', 'shoe'])
const FORMALITY_SKIP_CATEGORIES = new Set(['accessory', 'accessories', 'jewelry', 'bag', 'bags', 'belt', 'belts', 'scarf', 'scarves', 'hat', 'hats', 'sunglasses'])

function category(piece) {
  return String(piece?.category || '').toLowerCase().trim()
}

function isShoe(piece) {
  return ['shoes', 'shoe'].includes(category(piece))
}

function isWeatherGatePiece(piece) {
  return !WEATHER_SKIP_CATEGORIES.has(category(piece))
}

function isFormalityPiece(piece) {
  return !FORMALITY_SKIP_CATEGORIES.has(category(piece))
}

const GATE_FIELDS = [
  { key: 'fabric_weight', scope: 'weather', appliesTo: isWeatherGatePiece, value: piece => piece.fabric_weight },
  { key: 'style_profile_json.coverage', scope: 'weather', appliesTo: isWeatherGatePiece, value: piece => piece.style_profile_json?.coverage },
  { key: 'style_profile_json.bareness', scope: 'weather', appliesTo: isWeatherGatePiece, value: piece => piece.style_profile_json?.bareness },
  { key: 'sleeve_type', scope: 'weather', appliesTo: isWeatherGatePiece, value: piece => piece.sleeve_type },
  { key: 'length_hits_at', scope: 'weather', appliesTo: isWeatherGatePiece, value: piece => piece.length_hits_at },
  { key: 'fiber_content', scope: 'weather', appliesTo: isWeatherGatePiece, value: piece => Array.isArray(piece.fiber_content) && piece.fiber_content.length ? piece.fiber_content : null },
  { key: 'formality', scope: 'register', appliesTo: isFormalityPiece, value: piece => piece.formality },
  { key: 'heel_height', scope: 'footwear', appliesTo: isShoe, value: piece => piece.heel_height },
  { key: 'walk_support', scope: 'footwear', appliesTo: isShoe, value: piece => piece.walk_support },
]

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

function escapeSvg(value = '') {
  return String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
}

function wrapLabel(value = '', max = 22) {
  const words = String(value || '').split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length > max && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines.slice(0, 3)
}

async function makeTile(piece, width = 150, height = 196) {
  const photo = piece.photo || piece.worn_photo
  const filePath = photo ? path.join(userUploadsDir(), photo) : null
  let image
  if (filePath && fs.existsSync(filePath)) {
    image = await sharp(filePath)
      .rotate()
      .resize(width - 16, height - 54, { fit: 'contain', background: { r: 250, g: 248, b: 245, alpha: 0 } })
      .png()
      .toBuffer()
  } else {
    const fallbackSvg = `<svg width="${width - 16}" height="${height - 54}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" rx="10" fill="#a08f7f"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="Georgia, serif" font-size="28" font-style="italic" fill="#f5efe8">${escapeSvg((piece.name || '?').charAt(0))}</text></svg>`
    image = await sharp(Buffer.from(fallbackSvg)).png().toBuffer()
  }
  const labelLines = wrapLabel(`${piece.id} ${piece.name}`, 20)
  const labelSvg = labelLines.map((line, i) => `<text x="${width / 2}" y="${height - 34 + i * 12}" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" fill="#5b5149">${escapeSvg(line)}</text>`).join('')
  const tileSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" rx="12" fill="#fbfaf8"/><rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" fill="none" stroke="#e2d9d0"/>${labelSvg}</svg>`
  return sharp(Buffer.from(tileSvg)).composite([{ input: image, left: 8, top: 10 }]).jpeg({ quality: 82 }).toBuffer()
}

async function writeFormalityContactSheets(pieces = []) {
  const outDir = 'scratch/formality_contact_sheets'
  fs.mkdirSync(outDir, { recursive: true })
  const written = []
  const sheetSpecs = [
    ...FORMALITY_VALUES.map(tier => ({
      key: tier,
      title: `Formality bucket: ${tier}`,
      subtitle: 'Review for obvious mis-bucketed garments after backfill.',
      pieces: pieces.filter(piece => String(piece.formality || '').toLowerCase().trim() === tier)
    })),
    {
      key: 'borderline',
      title: 'Formality bucket: borderline',
      subtitle: 'Review these low-confidence formality labels first; they are the likeliest calibration mistakes.',
      pieces: pieces.filter(piece => confidenceFor(piece, 'formality') === 'low')
    }
  ]
  for (const spec of sheetSpecs) {
    const bucket = spec.pieces
    if (!bucket.length) continue
    const cols = 5
    const tileW = 150
    const tileH = 196
    const gap = 14
    const margin = 24
    const headerH = 76
    const rows = Math.ceil(bucket.length / cols)
    const width = margin * 2 + cols * tileW + (cols - 1) * gap
    const height = headerH + margin + rows * tileH + Math.max(0, rows - 1) * gap
    const composites = []
    for (const [idx, piece] of bucket.entries()) {
      composites.push({
        input: await makeTile(piece, tileW, tileH),
        left: margin + (idx % cols) * (tileW + gap),
        top: headerH + Math.floor(idx / cols) * (tileH + gap)
      })
    }
    const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f6f1eb"/><text x="24" y="36" font-family="Georgia, serif" font-size="26" fill="#2f2924">${escapeSvg(spec.title)}</text><text x="24" y="58" font-family="Arial, sans-serif" font-size="13" fill="#786d63">${bucket.length} active pieces. ${escapeSvg(spec.subtitle)}</text></svg>`
    const outPath = path.join(outDir, `formality-${spec.key}.jpg`)
    await sharp(Buffer.from(svg)).composite(composites).jpeg({ quality: 86 }).toFile(outPath)
    written.push(outPath)
  }
  return written
}

const allActivePieces = db.prepare("SELECT * FROM pieces WHERE status = 'active' ORDER BY id").all().map(parsePiece)
const summary = {}
const missingByPiece = []

for (const field of GATE_FIELDS) {
  const applicable = allActivePieces.filter(field.appliesTo)
  summary[field.key] = {
    field: field.key,
    scope: field.scope,
    populated: 0,
    total: applicable.length,
    percent: 0,
    confidence: {}
  }
}

for (const piece of allActivePieces) {
  const missing = []
  for (const field of GATE_FIELDS) {
    if (!field.appliesTo(piece)) continue
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
  scope: item.scope,
  populated: item.populated,
  total: item.total,
  percent: `${item.percent}%`,
  confidence: JSON.stringify(item.confidence)
})))

function checkWeightContradiction(piece) {
  const weight = String(piece.fabric_weight || '').toLowerCase().trim();
  const cat = String(piece.fabric_category || '').toLowerCase().trim();
  const fibers = Array.isArray(piece.fiber_content) ? piece.fiber_content.map(f => String(f).toLowerCase().trim()) : [];
  
  if (weight === 'heavy') {
    if (cat === 'jersey' || cat === 'technical/performance' || cat === 'mesh') {
      return `heavy weight contradicts fabric category '${cat}'`;
    }
  }
  if (weight === 'light' || weight === 'ultralight') {
    if (cat === 'wool' || cat === 'cashmere' || cat === 'tweed') {
      return `${weight} weight contradicts fabric category '${cat}'`;
    }
    const heavyFibers = ['wool', 'merino', 'cashmere', 'alpaca', 'mohair', 'down'];
    const foundHeavy = fibers.filter(f => heavyFibers.includes(f));
    if (foundHeavy.length > 0) {
      return `${weight} weight contradicts heavy fiber(s): ${foundHeavy.join(', ')}`;
    }
  }
  return null;
}

if (missingByPiece.length) {
  console.log('\nPieces with missing gate metadata:')
  for (const piece of missingByPiece) {
    console.log(`- ${piece.id} ${piece.name}: ${piece.missing.join(', ')}`)
  }
}

// Audit fabric_weight distribution & fiber contradiction
const weightDistribution = {}
const weightConfidence = {}
const weightContradictions = []

for (const piece of allActivePieces) {
  if (!isWeatherGatePiece(piece)) continue
  const weight = piece.fabric_weight || 'unpopulated'
  weightDistribution[weight] = (weightDistribution[weight] || 0) + 1
  
  const conf = confidenceFor(piece, 'fabric_weight')
  weightConfidence[conf] = (weightConfidence[conf] || 0) + 1
  
  const contradiction = checkWeightContradiction(piece)
  if (contradiction) {
    weightContradictions.push({
      id: piece.id,
      name: piece.name,
      fabric_category: piece.fabric_category,
      fabric_weight: piece.fabric_weight,
      fiber_content: piece.fiber_content,
      issue: contradiction
    })
  }
}

console.log('\n==================================================')
console.log('FABRIC WEIGHT AUDIT DETAILS')
console.log('==================================================')
console.log('Tier distribution:')
console.table(weightDistribution)
console.log('Confidence distribution:')
console.table(weightConfidence)
console.log(`Contradiction shortlist (${weightContradictions.length} pieces found):`)
if (weightContradictions.length) {
  console.table(weightContradictions)
} else {
  console.log('✅ No fabric weight/fiber contradictions found.')
}

const contactSheets = await writeFormalityContactSheets(allActivePieces.filter(isFormalityPiece))
if (contactSheets.length) {
  console.log('\nFormality bucket contact sheets:')
  for (const sheet of contactSheets) console.log(`- ${sheet}`)
  const borderline = contactSheets.find(sheet => sheet.includes('formality-borderline'))
  if (borderline) {
    console.log(`Review borderline formality labels first: ${borderline}`)
  }
} else {
  console.log('\nNo formality contact sheets written yet; no active pieces have formality values.')
}

const output = {
  generatedAt: new Date().toISOString(),
  activePieceCount: allActivePieces.length,
  fields: summary,
  missingByPiece,
  fabricWeightAudit: {
    tierDistribution: weightDistribution,
    confidenceDistribution: weightConfidence,
    contradictions: weightContradictions
  },
  formalityContactSheets: contactSheets,
  borderlineFormalityContactSheet: contactSheets.find(sheet => sheet.includes('formality-borderline')) || null
}

fs.writeFileSync('scratch/gate_metadata_audit.json', JSON.stringify(output, null, 2))
console.log('\nWrote scratch/gate_metadata_audit.json')
