import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = new Set(process.argv.slice(2))
const preview = args.has('--preview')
const reset = args.has('--reset')
const withAuth = args.has('--with-auth')
const targetRoot = path.join(os.tmpdir(), 'closet-item13-panel')
const dbPath = path.join(targetRoot, 'wardrobe.db')
const uploadsPath = path.join(targetRoot, 'uploads')
const systemDbPath = path.join(targetRoot, 'system.db')
const fixtureEmail = 'item13-panel@example.invalid'
const fixturePassword = 'item13-panel-only'

console.log(JSON.stringify({
  purpose: 'Item 13 feedback-panel fixture; local records only; zero provider calls',
  database: dbPath,
  uploads: uploadsPath,
  systemDatabase: withAuth ? systemDbPath : null,
  authProvisioning: withAuth ? `login as ${fixtureEmail}` : 'disabled; add --with-auth for browser capture',
  records: ['3 garments', '2 owner rules', '1 occasion exclusion', '2 provisional reactions (1 processed, 1 actionable)', '1 renderer correction', '1 accepted personal lesson', '1 product finding', '1 owner constraint', '1 review task'],
}, null, 2))

if (preview) process.exit(0)
if (!reset) {
  console.error('Refusing to write without --reset. Run with --preview first, then --reset.')
  process.exit(2)
}
if (!dbPath.startsWith(`${os.tmpdir()}${path.sep}`)) throw new Error('Panel fixture must stay inside the system temporary directory.')

fs.rmSync(targetRoot, { recursive: true, force: true })
fs.mkdirSync(uploadsPath, { recursive: true })
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = dbPath
process.env.WARDROBE_UPLOADS_DIR = uploadsPath
if (withAuth) process.env.WARDROBE_SYSTEM_DB_PATH = systemDbPath

const { db } = await import('../db.js')
const { buildFeedbackEvidence } = await import('../lib/feedbackEvidence.js')
const { syncProductQualityFindingForDraft } = await import('../lib/productQualityFindings.js')
const { createOwnerConstraint } = await import('../lib/ownerConstraints.js')

db.prepare("INSERT INTO app_meta (key, value) VALUES ('onboarding_complete', 'true') ON CONFLICT(key) DO UPDATE SET value = 'true'").run()

let fixtureUser = null
if (withAuth) {
  const { createUser } = await import('../lib/systemDb.js')
  fixtureUser = createUser(fixtureEmail, fixturePassword)
  if (Number(fixtureUser.id) !== 1) throw new Error(`Capture fixture user must be id 1; got ${fixtureUser.id}`)
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600">
<rect width="900" height="600" fill="#eee8e1"/><rect x="70" y="70" width="220" height="460" rx="18" fill="#6f536b"/>
<rect x="340" y="70" width="220" height="460" rx="18" fill="#c3b9aa"/><rect x="610" y="70" width="220" height="460" rx="18" fill="#8b8178"/>
<text x="450" y="565" font-family="sans-serif" font-size="22" text-anchor="middle" fill="#403934">Panel fixture — not generated imagery</text></svg>`
fs.writeFileSync(path.join(uploadsPath, 'item13-panel-board.svg'), svg)

function insertPiece({ name, category, fabric, occasions, exclusions = [], sleeve = '', fit = '' }) {
  return Number(db.prepare(`INSERT INTO pieces
    (name, category, fabric_category, occasions, occasion_exclusions, sleeve_type, fit_on_body,
     status, recommendation_status, fit_confidence, role_permission, photo)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'trusted', 'high', 'auto', ?)
  `).run(
    name, category, fabric, JSON.stringify(occasions), JSON.stringify(exclusions), sleeve, fit,
    'item13-panel-board.svg',
  ).lastInsertRowid)
}

const shortsId = insertPiece({ name: 'Panel beige linen shorts', category: 'bottom', fabric: 'linen', occasions: ['casual', 'outdoor'], exclusions: ['home'] })
const shoesId = insertPiece({ name: 'Panel canvas walking shoes', category: 'shoes', fabric: 'canvas', occasions: ['casual', 'city', 'outdoor'] })
const cardiganId = insertPiece({ name: 'Panel fitted cardigan', category: 'outerwear', fabric: 'knit', occasions: ['casual', 'city'], sleeve: 'three-quarter', fit: 'fitted' })
const fixturePieces = [
  { id: cardiganId, name: 'Panel fitted cardigan', category: 'outerwear', fabric_category: 'knit', photo: 'item13-panel-board.svg' },
  { id: shortsId, name: 'Panel beige linen shorts', category: 'bottom', fabric_category: 'linen', photo: 'item13-panel-board.svg' },
  { id: shoesId, name: 'Panel canvas walking shoes', category: 'shoes', fabric_category: 'canvas', photo: 'item13-panel-board.svg' },
]

const threadId = 'item13_panel_source_thread'
db.prepare(`INSERT INTO chat_threads (id, title, kind, payload) VALUES (?, ?, 'stylist', ?)`) 
  .run(threadId, 'Panel fixture: fog walk correction', JSON.stringify({
    messages: [
      { role: 'user', text: 'Build a practical outfit for a wet, foggy coastal walk.', contextType: 'wardrobe' },
      {
        role: 'assistant',
        text: 'Here is the proposed fog-walk outfit. Use the piece menu to identify anything that is wrong for this combination.',
        structuredOutfits: [{
          label: 'Panel fog-walk outfit',
          occasion: 'casual', activity: 'walking', season: 'summer',
          bestFor: 'Wet, foggy coastal walking', pieces: fixturePieces,
        }],
        source: 'fixture', mode: 'freeform',
      },
    ],
    latestOutfits: [{ label: 'Panel fog-walk outfit', bestFor: 'Wet, foggy coastal walking', pieces: fixturePieces }],
  }))

const boardId = Number(db.prepare(`INSERT INTO saved_boards
  (board_type, context_type, context_name, title, image_url, pieces, reason, payload)
  VALUES ('wardrobe', 'wardrobe', 'Panel fixture', 'Panel fog-walk outfit', ?, ?, ?, ?)
`).run(
  '/uploads/item13-panel-board.svg',
  JSON.stringify(fixturePieces),
  'A deliberately controlled fixture outfit for panel review.',
  JSON.stringify({
    threadId,
    feedback_labels: ['almost', 'wrong_length'],
    feedback_details: {
      wrong_length: [{ piece_id: cardiganId, piece_name: 'Panel fitted cardigan', issue: 'upper_hem_too_long' }],
    },
  }),
).lastInsertRowid)

const ownerRuleId = Number(db.prepare(`INSERT INTO stylist_feedback
  (feedback_type, target_type, context_type, context_name, label, note, payload, created_at)
  VALUES ('owner_rule', 'message', 'message', 'Stylist chat', 'Owner rule', ?, '{}', datetime('now'))
`).run('For warm-weather travel days, avoid heavy layers that require carrying or maintenance; keep the outfit operational across transit, walking, and changing indoor temperatures.').lastInsertRowid)

const constraintSourceId = Number(db.prepare(`INSERT INTO stylist_feedback
  (feedback_type, target_type, context_type, context_name, label, note, payload, created_at)
  VALUES ('owner_rule', 'message', 'message', 'Stylist chat', 'Owner rule', ?, '{}', datetime('now'))
`).run('Do not use these canvas shoes in wet weather.').lastInsertRowid)

const evidencePayload = {
  pieceId: shoesId,
  pieceName: 'Panel canvas walking shoes',
  pieceCategory: 'shoes',
  explicitReason: 'Canvas absorbs water during wet, foggy coastal walks.',
  threadId,
  outfitIndex: 0,
  occasion: 'casual',
  activity: 'walking',
  season: 'summer',
  weatherContext: 'wet foggy coastal walk',
  sourceSurface: 'stylist_chat',
  outfit: {
    label: 'Panel fog-walk outfit', occasion: 'casual', activity: 'walking', season: 'summer',
    pieces: fixturePieces,
  },
  board: { id: boardId, imageUrl: '/uploads/item13-panel-board.svg' },
}
evidencePayload.feedbackEvidence = buildFeedbackEvidence({
  feedbackType: 'wrong_item_read', targetType: 'whole_wardrobe_outfit', contextType: 'wardrobe',
  contextName: 'Panel fog-walk outfit', sourceSurface: 'stylist_chat', payload: evidencePayload,
})
const provisionalId = Number(db.prepare(`INSERT INTO stylist_feedback
  (feedback_type, target_type, context_type, context_name, label, note, payload, created_at)
  VALUES ('wrong_item_read', 'whole_wardrobe_outfit', 'wardrobe', 'Panel fog-walk outfit',
          'Wrong choice for this outfit', ?, ?, datetime('now'))
`).run(evidencePayload.explicitReason, JSON.stringify(evidencePayload)).lastInsertRowid)

const unprocessedEvidencePayload = JSON.parse(JSON.stringify(evidencePayload))
unprocessedEvidencePayload.pieceId = cardiganId
unprocessedEvidencePayload.pieceName = 'Panel fitted cardigan'
unprocessedEvidencePayload.pieceCategory = 'outerwear'
unprocessedEvidencePayload.explicitReason = 'The fitted cardigan makes this walking outfit feel constrained and overworked.'
unprocessedEvidencePayload.feedbackEvidence = buildFeedbackEvidence({
  feedbackType: 'wrong_item_read', targetType: 'whole_wardrobe_outfit', contextType: 'wardrobe',
  contextName: 'Panel fog-walk outfit', sourceSurface: 'stylist_chat', payload: unprocessedEvidencePayload,
})
const unprocessedProvisionalId = Number(db.prepare(`INSERT INTO stylist_feedback
  (feedback_type, target_type, context_type, context_name, label, note, payload, created_at)
  VALUES ('wrong_item_read', 'whole_wardrobe_outfit', 'wardrobe', 'Panel fog-walk outfit',
          'Wrong choice for this outfit', ?, ?, datetime('now'))
`).run(unprocessedEvidencePayload.explicitReason, JSON.stringify(unprocessedEvidencePayload)).lastInsertRowid)

const rendererId = Number(db.prepare(`INSERT INTO stylist_feedback
  (feedback_type, target_type, context_type, context_id, context_name, label, note, payload, created_at)
  VALUES ('wrong_length', 'generated_visual_board', 'piece', ?, 'Panel fitted cardigan',
          'Garment is the wrong length', 'The generated cardigan was longer than the garment reference.', ?, datetime('now'))
`).run(cardiganId, JSON.stringify({
  board: { id: boardId, imageUrl: '/uploads/item13-panel-board.svg', pieces: evidencePayload.outfit.pieces },
  pieceIds: [cardiganId], length_correction: 'generated too long', threadId,
})).lastInsertRowid)
db.prepare(`INSERT INTO todos
  (type, description, linked_piece_id, completed, field, source_type, source_id, payload)
  VALUES ('retag-suggestion', ?, ?, 0, 'length_hits_at', 'stylist_feedback', ?, ?)
`).run('Review cardigan length metadata; no tag was changed automatically.', cardiganId, rendererId, JSON.stringify({ proposed: 'waist' }))

const batchId = Number(db.prepare(`INSERT INTO feedback_synthesis_batches
  (status, feedback_ids, compact_input, input_hash, provider, model, estimated_input_tokens,
   estimated_output_tokens, estimated_cost_usd, actual_usage, completed_at)
  VALUES ('completed', ?, 'panel fixture', 'item13-panel-personal', 'none', 'fixture', 0, 0, 0, '{}', datetime('now'))
`).run(JSON.stringify([provisionalId])).lastInsertRowid)
const personalDraftId = Number(db.prepare(`INSERT INTO feedback_synthesis_drafts
  (batch_id, disposition, title, proposed_text, boundary, rationale, confidence,
   source_feedback_ids, status, payload)
  VALUES (?, 'personal_contextual_lesson', ?, ?, ?, ?, 'explicit_owner', ?, 'accepted', ?)
`).run(
  batchId,
  'Canvas shoes are not suitable for wet coastal walks',
  'Avoid canvas footwear when the selected shoes and request both involve wet coastal walking.',
  'Only when the named canvas shoes and wet walking context both match. This intentionally long boundary demonstrates how applicability, explanation, and source evidence compete for space without turning the card into raw technical metadata.',
  'Owner supplied the material-and-weather reason explicitly.',
  JSON.stringify([provisionalId]),
  JSON.stringify({ applicability: { scope: 'piece_and_context', piece_ids: [shoesId], occasions: ['casual'], activities: ['walking'], seasons: ['summer'], weather: ['wet', 'foggy'] } }),
).lastInsertRowid)

const productDraftId = Number(db.prepare(`INSERT INTO feedback_synthesis_drafts
  (batch_id, disposition, title, proposed_text, boundary, rationale, confidence,
   source_feedback_ids, status, payload)
  VALUES (?, 'general_styling_failure', ?, ?, '', ?, 'explicit_owner', ?, 'accepted', '{}')
`).run(
  batchId,
  'Fitted narrow-sleeved layers cannot cover voluminous long sleeves',
  'Treat incompatible sleeve layering as a product-quality failure, not a personal preference.',
  'The construction relationship is general styling knowledge.',
  JSON.stringify([provisionalId]),
).lastInsertRowid)
const productDraft = db.prepare('SELECT * FROM feedback_synthesis_drafts WHERE id = ?').get(productDraftId)
const finding = syncProductQualityFindingForDraft(db, productDraft, { status: 'accepted' })

const constraintResult = createOwnerConstraint(db, {
  confirmOwnerConstraint: true,
  sourceFeedbackId: constraintSourceId,
  selectorType: 'piece_ids', selectorValues: [shoesId],
  contextDimension: 'weather', contextValues: ['wet_exposure'],
  reason: 'Owner-confirmed wet-weather prohibition for these canvas shoes.',
})

const fixtureManifest = {
  generatedAt: new Date().toISOString(),
  database: dbPath,
  uploads: uploadsPath,
  systemDatabase: withAuth ? systemDbPath : null,
  auth: fixtureUser ? { email: fixtureEmail, password: fixturePassword, userId: Number(fixtureUser.id) } : null,
  records: {
    pieces: { shortsId, shoesId, cardiganId },
    threadId, boardId, ownerRuleId, constraintSourceId, provisionalId, unprocessedProvisionalId, rendererId,
    synthesis: { batchId, personalDraftId, productDraftId },
    productFindingId: Number(finding.id),
    ownerConstraintId: Number(constraintResult.constraint.id),
  },
  assertions: {
    productFindingEvidenceRows: JSON.parse(finding.evidence_snapshot).length,
    constraintSourceArchived: db.prepare('SELECT archived FROM stylist_feedback WHERE id = ?').get(constraintSourceId).archived,
    ownerConstraintStatus: constraintResult.constraint.status,
    personalLessonStatus: db.prepare('SELECT status FROM feedback_synthesis_drafts WHERE id = ?').get(personalDraftId).status,
  },
}
fs.writeFileSync(path.join(targetRoot, 'fixture-manifest.json'), JSON.stringify(fixtureManifest, null, 2))
console.log(JSON.stringify(fixtureManifest, null, 2))
