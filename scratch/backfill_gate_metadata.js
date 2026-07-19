import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { db, parsePiece, userUploadsDir } from '../db.js'
import { askStylist, prepareImageForClaude } from '../styling-engine/provider.js'
import { applyTaggerResult, buildAnchorBlock, normalizeManualOverrides, tagStateForTaggerResult } from '../styling-engine/taggerMerge.js'

const OUTPUT_COMPARATIVE_PATH = 'scratch/formality_comparative_proposals.json'
const AUDIT_PATH = 'scratch/gate_metadata_audit.json'
const SKIP_CATEGORIES = new Set(['accessory', 'accessories', 'jewelry', 'bag', 'bags', 'belt', 'belts', 'scarf', 'scarves', 'hat', 'hats', 'sunglasses', 'shoes', 'shoe'])
const FORMALITY_SKIP_CATEGORIES = new Set(['accessory', 'accessories', 'jewelry', 'bag', 'bags', 'belt', 'belts', 'scarf', 'scarves', 'hat', 'hats', 'sunglasses'])
export const FORMALITY_VALUES = ['lounge', 'everyday', 'elevated', 'dressy']
const FORMALITY_VALUE_SET = new Set(FORMALITY_VALUES)

function parseJsonOrExit(raw, label) {
  try {
    return JSON.parse(raw)
  } catch (err) {
    console.error(`Could not parse ${label}: ${err.message}`)
    process.exit(1)
  }
}

function category(piece) {
  return String(piece?.category || '').toLowerCase().trim()
}

function shouldBackfillPiece(piece) {
  return !SKIP_CATEGORIES.has(category(piece))
}

function shouldCompareFormalityPiece(piece) {
  return !FORMALITY_SKIP_CATEGORIES.has(category(piece))
}

function getPath(obj, dotted) {
  return String(dotted).split('.').reduce((acc, key) => acc && acc[key], obj)
}

function pickTouched(piece, fields = []) {
  return Object.fromEntries(fields.map(field => [field, getPath(piece, field)]))
}

function fieldAppliesToPiece(field, piece) {
  if (field === 'heel_height' || field === 'walk_support') return category(piece) === 'shoes' || category(piece) === 'shoe'
  if (['fabric_weight', 'fiber_content', 'sleeve_type', 'length_hits_at', 'style_profile_json.coverage', 'style_profile_json.bareness'].includes(field)) {
    return shouldBackfillPiece(piece)
  }
  if (field === 'formality') return shouldCompareFormalityPiece(piece)
  return true
}

function confidenceKey(field) {
  return field.replace(/^style_profile_json\./, '')
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
    confidenceKey(field),
    'high|medium|low'
  ]))
  return schema
}

function compactAttrs(anchor = {}) {
  const attrs = []
  if (anchor.fabric_category) attrs.push(`fabric: ${anchor.fabric_category}`)
  if (anchor.reads_as) attrs.push(`reads_as: ${anchor.reads_as}`)
  return attrs.length ? ` (${attrs.join('; ')})` : ''
}

export function shouldUseBothPhotosForFields(fields = []) {
  return fields.includes('formality')
}

export function imageCandidatesForPiece(piece = {}, fields = []) {
  const candidates = shouldUseBothPhotosForFields(fields)
    ? [
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
    : [
        {
          file: piece.photo || piece.worn_photo,
          label: piece.photo ? 'GARMENT PHOTO' : 'WORN PHOTO',
          guidance: 'Use for literal garment truth: color, fabric, construction, pattern, shape, category, and missing gate metadata.'
        }
      ]
  return candidates.filter(candidate => candidate.file)
}

async function prepareImageCandidate(candidate, labelPrefix = '') {
  const filePath = path.join(userUploadsDir(), candidate.file)
  if (!fs.existsSync(filePath)) return null
  const image = await prepareImageForClaude(filePath)
  return { ...candidate, label: `${labelPrefix}${candidate.label}`, ...image }
}

async function collectPieceImages(piece, fields = []) {
  const images = []
  for (const candidate of imageCandidatesForPiece(piece, fields)) {
    const prepared = await prepareImageCandidate(candidate)
    if (!prepared) {
      console.log(`NOTE ${piece.id} ${piece.name}: missing ${candidate.label.toLowerCase()} file ${candidate.file}`)
      continue
    }
    images.push(prepared)
  }
  return images
}

async function collectAnchorImages(anchors = []) {
  const images = []
  for (const anchor of anchors) {
    const file = anchor.photo || anchor.worn_photo
    if (!file) continue
    const prepared = await prepareImageCandidate({
      file,
      label: `${String(anchor.value || '').toUpperCase()} ANCHOR ${anchor.id}`,
      guidance: `${anchor.name}${compactAttrs(anchor)}`
    }, 'CALIBRATION ')
    if (prepared) images.push(prepared)
  }
  return images
}

function formalityRubric() {
  return `Formality rubric:
- lounge: athletic/home comfort construction.
- everyday: no-intent wear; matte or naturally textured fabrics, simple construction; artisan texture alone stays everyday. Ruffle detailing alone does not lift a piece out of everyday.
- elevated: visible refinement requiring intent; refined drape, deliberate structure, polished finish, statement construction. Leather and suede jackets (moto, zip, bomber) default to elevated, not dressy, unless embellished or formally tailored. Knit dresses are not inherently dressy; judge by sheen, cut, and construction, not category.
- dressy: reserved for going-out signals: sheen, sequins, lace as a primary element, formal tailoring, cocktail/evening cuts.`
}

function allActivePieces() {
  return db.prepare("SELECT * FROM pieces WHERE status = 'active' ORDER BY id").all().map(parsePiece)
}

function manualFormalityIds(pieces = []) {
  return new Set(pieces
    .filter(piece => normalizeManualOverrides(piece.manual_overrides).includes('formality') && FORMALITY_VALUE_SET.has(String(piece.formality || '').toLowerCase().trim()))
    .map(piece => Number(piece.id)))
}

async function retagPiece(row, { apply = false, anchorBlock = { text: '', anchors: [] } } = {}) {
  const piece = parsePiece(db.prepare('SELECT * FROM pieces WHERE id = ?').get(row.id))
  if (!piece) return
  if (!piece.photo && !piece.worn_photo) {
    console.log(`SKIP ${row.id} ${row.name}: no photo`)
    return
  }
  const hasManualFormality = normalizeManualOverrides(piece.manual_overrides).includes('formality')
  const fields = (row.missing || [])
    .filter(field => !(field === 'formality' && hasManualFormality))
    .filter(field => fieldAppliesToPiece(field, piece))
  if (!fields.length) return
  if (apply && fields.includes('formality') && !anchorBlock.anchors.length) {
    console.log(`SKIP ${row.id} ${row.name}: formality backfill needs manual formality anchors in the DB before --apply`)
    return
  }
  console.log(`\n${apply ? 'Retagging' : 'Would retag'} ${piece.id} ${piece.name}`)
  console.log('Missing:', fields.join(', '))
  console.log('Before:', JSON.stringify(pickTouched(piece, fields), null, 2))
  if (!apply) return

  const images = await collectPieceImages(piece, fields)
  if (!images.length) {
    console.log(`SKIP ${row.id} ${row.name}: no existing image files`)
    return
  }
  const anchorImages = fields.includes('formality') ? await collectAnchorImages(anchorBlock.anchors) : []
  console.log(`Images: ${images.map(image => image.label).join(', ')}${anchorImages.length ? ` + ${anchorImages.length} calibration anchors` : ''}`)
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
        ...anchorImages.flatMap(image => [
          { type: 'text', text: `${image.label}: ${image.guidance}` },
          { type: 'image', source: { type: 'base64', media_type: image.mime, data: image.base64 } }
        ]),
        { type: 'text', text: `Piece: ${piece.name}\nCategory: ${piece.category}\n${formalityRubric()}\nFor shoes, heel_height is physical heel lift; walk_support is stability for lots of walking.\n${anchorBlock.text}\nReturn only this narrow JSON schema:\n${JSON.stringify(schemaFor(fields), null, 2)}` }
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

export function validateComparativeFormalityProposal(proposal = {}, { manualIds = new Set() } = {}) {
  const id = Number(proposal.id)
  const current = String(proposal.current || '').toLowerCase().trim()
  const proposed = String(proposal.proposed || '').toLowerCase().trim()
  const reason = String(proposal.reason || '').trim()
  return Number.isFinite(id) &&
    !manualIds.has(id) &&
    FORMALITY_VALUE_SET.has(current) &&
    FORMALITY_VALUE_SET.has(proposed) &&
    current !== proposed &&
    reason.length > 0
}

function normalizedComparativeConfidence(proposal = {}) {
  const confidence = String(proposal.confidence || '').toLowerCase().trim()
  return ['high', 'medium', 'low'].includes(confidence) ? confidence : 'medium'
}

export function buildComparativeFormalityPrompt({ categoryName = 'unknown', pieces = [], anchorText = '' } = {}) {
  const rows = pieces.map(piece => {
    const attrs = compactAttrs(piece)
    return `- ${piece.id} ${piece.name}: current=${piece.formality || 'missing'}${attrs}`
  }).join('\n')
  return `Compare formality within one wardrobe category: ${categoryName}.
Use relative calibration, not general fashion norms. Manual anchors are ground truth and must not be changed.
Return proposed corrections only. If a piece is plausible where it is, omit it.
${formalityRubric()}
${anchorText}
Category pieces:
${rows}

Return only JSON:
{"proposals":[{"id":123,"current":"everyday","proposed":"elevated","reason":"short explanation"}]}`
}

async function runComparativeFormalityPass({ limit = Infinity } = {}) {
  const pieces = allActivePieces()
  const anchorBlock = buildAnchorBlock({ pieces, fields: ['formality'] })
  const anchors = anchorBlock.anchors
  const manualIds = manualFormalityIds(pieces)
  const candidates = pieces
    .filter(piece => shouldCompareFormalityPiece(piece))
    .filter(piece => FORMALITY_VALUE_SET.has(String(piece.formality || '').toLowerCase().trim()))
    .filter(piece => !manualIds.has(Number(piece.id)))
  const groups = new Map()
  for (const piece of candidates) {
    const key = piece.category || 'uncategorized'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(piece)
  }
  const selectedGroups = [...groups.entries()].slice(0, limit)
  const proposals = []
  console.log(`Comparative formality pass: ${selectedGroups.length} categories, ${anchors.length} manual anchors. No DB writes.`)

  for (const [categoryName, groupPieces] of selectedGroups) {
    console.log(`\nComparing ${categoryName}: ${groupPieces.length} pieces`)
    const images = []
    for (const piece of groupPieces) {
      const file = piece.photo || piece.worn_photo
      if (!file) continue
      const prepared = await prepareImageCandidate({
        file,
        label: `PIECE ${piece.id}`,
        guidance: `${piece.name}: current=${piece.formality || 'missing'}${compactAttrs(piece)}`
      })
      if (prepared) images.push(prepared)
    }
    const raw = await askStylist({
      system: 'Return ONLY valid JSON. Compare current formality labels within this one wardrobe category and propose corrections only.',
      maxTokens: 1200,
      messages: [{
        role: 'user',
        content: [
          ...images.flatMap(image => [
            { type: 'text', text: `${image.label}: ${image.guidance}` },
            { type: 'image', source: { type: 'base64', media_type: image.mime, data: image.base64 } }
          ]),
          { type: 'text', text: buildComparativeFormalityPrompt({ categoryName, pieces: groupPieces, anchorText: anchorBlock.text }) }
        ]
      }]
    })
    const cleaned = String(raw || '').trim().replace(/^```json\n?|\n?```$/g, '').trim()
    let parsed
    try {
      parsed = JSON.parse(cleaned)
    } catch (err) {
      console.log(`SKIP ${categoryName}: model returned invalid JSON (${err.message})`)
      continue
    }
    for (const proposal of parsed.proposals || []) {
      if (validateComparativeFormalityProposal(proposal, { manualIds })) {
        proposals.push({
          id: Number(proposal.id),
          current: String(proposal.current).toLowerCase().trim(),
          proposed: String(proposal.proposed).toLowerCase().trim(),
          reason: String(proposal.reason).trim()
        })
      }
    }
  }

  fs.writeFileSync(OUTPUT_COMPARATIVE_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), proposals }, null, 2))
  console.log(`\nWrote ${OUTPUT_COMPARATIVE_PATH}`)
}

function applyReviewedComparativeProposals({ proposalPath = OUTPUT_COMPARATIVE_PATH } = {}) {
  if (!fs.existsSync(proposalPath)) {
    console.error(`Missing ${proposalPath}. Run --comparative-formality first, then mark accepted proposals with "accepted": true.`)
    process.exit(1)
  }
  const pieces = allActivePieces()
  const manualIds = manualFormalityIds(pieces)
  const payload = parseJsonOrExit(fs.readFileSync(proposalPath, 'utf8'), proposalPath)
  const proposals = Array.isArray(payload.proposals) ? payload.proposals : []
  let applied = 0
  for (const proposal of proposals) {
    if (proposal.accepted !== true) continue
    if (!validateComparativeFormalityProposal(proposal, { manualIds })) {
      console.log(`SKIP proposal ${proposal.id}: invalid shape or manual formality override`)
      continue
    }
    const piece = parsePiece(db.prepare('SELECT * FROM pieces WHERE id = ?').get(Number(proposal.id)))
    if (!piece || !shouldCompareFormalityPiece(piece)) continue
    const merged = applyTaggerResult(piece, {
      formality: String(proposal.proposed).toLowerCase().trim(),
      _confidence: { formality: normalizedComparativeConfidence(proposal) }
    })
    db.prepare(`
      UPDATE pieces SET formality = ?, style_profile_json = ?, tag_state = ?
      WHERE id = ?
    `).run(
      merged.formality || null,
      JSON.stringify(merged.style_profile_json || {}),
      merged.tag_state || piece.tag_state || 'provisional',
      piece.id
    )
    applied += 1
    console.log(`APPLIED ${piece.id} ${piece.name}: ${proposal.current} -> ${proposal.proposed} (${normalizedComparativeConfidence(proposal)} confidence)`)
  }
  console.log(`\nApplied ${applied} accepted comparative formality proposal(s).`)
}

async function runBackfill({ apply = false, limit = Infinity } = {}) {
  if (!fs.existsSync(AUDIT_PATH)) {
    console.error(`Missing ${AUDIT_PATH}. Run node scratch/audit_gate_metadata.js first.`)
    process.exit(1)
  }
  const audit = parseJsonOrExit(fs.readFileSync(AUDIT_PATH, 'utf8'), AUDIT_PATH)
  const missingRows = Array.isArray(audit.missingByPiece) ? audit.missingByPiece : []
  const plan = missingRows.slice(0, limit)
  const anchorBlock = buildAnchorBlock({ pieces: allActivePieces(), fields: ['formality'] })

  console.log(`${apply ? 'APPLY' : 'DRY RUN'} gate metadata backfill`)
  console.log(`Planned pieces: ${plan.length}`)
  console.log(`Estimated vision calls: ${plan.length}`)
  console.log(`Estimated model cost: review provider pricing for ${plan.length} narrow image calls before applying.`)
  if (anchorBlock.anchors.length) {
    console.log(`Loaded ${anchorBlock.anchors.length} manual formality calibration anchors from the DB`)
  } else if (plan.some(row => (row.missing || []).includes('formality'))) {
    console.log('WARNING: no manual formality anchors found in the DB. Formality rows will be skipped on --apply.')
  }

  for (const row of plan) {
    await retagPiece(row, { apply, anchorBlock })
  }

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to write updates.')
  } else {
    console.log('\nApply complete. Re-run node scratch/audit_gate_metadata.js and review scratch/formality_contact_sheets/*.jpg before enabling register gates.')
  }
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const comparative = args.includes('--comparative-formality') || args.includes('--compare-formality')
  const applyComparative = args.includes('--apply-comparative-proposals')
  const limitArg = args.find((arg, index) => args[index - 1] === '--limit')
  const limit = Number.isFinite(Number(limitArg)) ? Math.max(0, Number(limitArg)) : Infinity
  if (applyComparative) {
    const proposalPath = args[args.indexOf('--apply-comparative-proposals') + 1] || OUTPUT_COMPARATIVE_PATH
    applyReviewedComparativeProposals({ proposalPath })
  } else if (comparative) {
    await runComparativeFormalityPass({ limit })
  } else {
    await runBackfill({ apply, limit })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  await main()
}
