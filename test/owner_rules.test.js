// Spec 25 Parts 2-3: stored owner rules (store_user_correction) render
// distinctly from reaction history in getStylistFeedbackMemory (severed
// under their own sub-header, sorted to the top) and get their own
// scoped-reaction header — plus a deterministic pass-through into the
// plan_outfit_set workbench (covered in plan_outfit_set.test.js) so a stored
// rule is delivered where composition-time context actually gets obeyed.
// Isolated tmp DB (never touches the real dev wardrobe.db's stylist_feedback
// rows).

import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-owner-rules-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const { db } = await import('../db.js')
const { getStylistFeedbackMemory, getOwnerRuleNotes } = await import('../styling-engine/rules.js')
const { storeUserCorrection, executeTool } = await import('../styling-engine/tools.js')
const { syncPieceRuleReceipt } = await import('../routes/crud.js')
const { extractOwnerGuidanceApplicability, ownerGuidanceApplies } = await import('../lib/ownerGuidance.js')

after(() => {
  db.close()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

beforeEach(() => {
  db.prepare('DELETE FROM owner_constraints').run()
  db.prepare('DELETE FROM stylist_feedback').run()
  db.prepare('DELETE FROM pieces').run()
})

function insertFeedback(overrides = {}) {
  const row = {
    feedback_type: 'preference_reaction',
    target_type: 'message',
    context_type: null,
    context_id: null,
    label: null,
    note: '',
    archived: 0,
    ...overrides
  }
  const info = db.prepare(`
    INSERT INTO stylist_feedback (feedback_type, target_type, context_type, context_id, label, note, archived)
    VALUES (@feedback_type, @target_type, @context_type, @context_id, @label, @note, @archived)
  `).run(row)
  return info.lastInsertRowid
}

test('storeUserCorrection writes feedback_type owner_rule', () => {
  storeUserCorrection('For office and client days: structured silhouettes only — no maxi skirts, no shawls at work.', 'general', null)
  const row = db.prepare('SELECT * FROM stylist_feedback ORDER BY id DESC LIMIT 1').get()
  assert.equal(row.feedback_type, 'owner_rule')
  assert.equal(row.target_type, 'message')
  assert.match(row.note, /no maxi skirts, no shawls at work/)
})

test('storeUserCorrection dedupe still holds across the type change', () => {
  storeUserCorrection('No flats for me.', 'general', null)
  storeUserCorrection('No flats for me.', 'general', null)
  const rows = db.prepare('SELECT * FROM stylist_feedback').all()
  assert.equal(rows.length, 1, 'an identical note must not stack')
})

test('storeUserCorrection stores a supported firm-rule proposal for later owner confirmation', () => {
  const result = storeUserCorrection("I don't wear boots in summer.", 'general', null, {
    firmRuleProposal: {
      selector_type: 'footwear',
      selector_values: ['boots'],
      context_dimension: 'season',
      context_values: ['summer'],
      reason: "Don't suggest boots in summer.",
    },
  })
  assert.equal(result.firm_rule_proposed, true)
  const row = db.prepare('SELECT * FROM stylist_feedback ORDER BY id DESC LIMIT 1').get()
  const proposal = JSON.parse(row.payload).ownerConstraintProposal
  assert.deepEqual(proposal, {
    version: 1,
    selectorType: 'footwear',
    selectorValues: ['boots'],
    contextDimension: 'season',
    contextValues: ['summer'],
    reason: "Don't suggest boots in summer.",
  })
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM owner_constraints').get().n, 0, 'storing a proposal must not activate a gate')
})

test('storeUserCorrection keeps the owner rule but drops an incomplete firm-rule proposal', () => {
  const result = storeUserCorrection('I prefer practical shoes for trips.', 'general', null, {
    firmRuleProposal: {
      selector_type: 'footwear',
      selector_values: ['heels'],
      context_dimension: 'activity',
      context_values: [],
      reason: 'No heels for travel.',
    },
  })
  assert.equal(result.firm_rule_proposed, false)
  const row = db.prepare('SELECT * FROM stylist_feedback ORDER BY id DESC LIMIT 1').get()
  assert.equal(JSON.parse(row.payload).ownerConstraintProposal, undefined)
  assert.equal(JSON.parse(row.payload).ownerGuidanceApplicability.reach, 'garment_context')
})

test('explicit sandals-for-hiking language gains context-aware delivery without model-supplied structure', () => {
  const result = storeUserCorrection('I never wear sandals for hiking.', 'general', null)
  assert.equal(result.scope, 'garment_context')
  const row = db.prepare('SELECT * FROM stylist_feedback ORDER BY id DESC LIMIT 1').get()
  const applicability = JSON.parse(row.payload).ownerGuidanceApplicability
  assert.deepEqual(applicability.garment.footwear, ['sandals'])
  assert.deepEqual(applicability.context.activities, ['hiking'])
  assert.deepEqual(getOwnerRuleNotes(8, {
    requestContext: { activity: 'hiking' },
    pieces: [{ id: 1, name: 'Leather sandals', category: 'shoes' }],
  }), ['I never wear sandals for hiking.'])
  assert.deepEqual(getOwnerRuleNotes(8, {
    requestContext: { activity: 'walking' },
    pieces: [{ id: 1, name: 'Leather sandals', category: 'shoes' }],
  }), [])
  assert.deepEqual(getOwnerRuleNotes(8, {
    requestContext: { activity: 'hiking' },
    pieces: [{ id: 2, name: 'Trail boots', category: 'shoes' }],
  }), [])
})

test('new ambiguous guidance is stored for review but receives no prompt authority', () => {
  const result = storeUserCorrection('This is not really what I mean.', 'general', null)
  assert.equal(result.scope, 'unresolved')
  assert.deepEqual(getOwnerRuleNotes(8, { requestContext: {}, pieces: [] }), [])
  assert.equal(getStylistFeedbackMemory(null, null, 24, { ownerGuidanceContext: { requestContext: {}, pieces: [] } }), '')
})

test('guidance applicability combines material and footwear instead of widening either selector', () => {
  const applicability = extractOwnerGuidanceApplicability('Canvas sneakers are not suitable for rainy weather.')
  assert.deepEqual(applicability.garment.footwear, ['sneakers'])
  assert.deepEqual(applicability.garment.materials, ['canvas'])
  const requestContext = { weather: { rainy: true } }
  assert.equal(ownerGuidanceApplies(applicability, {
    requestContext,
    pieces: [{ id: 1, category: 'shoes', name: 'canvas sneakers', fabric_category: 'canvas', fiber_content: [] }],
  }), true)
  assert.equal(ownerGuidanceApplies(applicability, {
    requestContext,
    pieces: [{ id: 2, category: 'shoes', name: 'leather sneakers', fabric_category: 'leather', fiber_content: [] }],
  }), false)
  assert.equal(ownerGuidanceApplies(applicability, {
    requestContext,
    pieces: [{ id: 3, category: 'shoes', name: 'canvas flats', fabric_category: 'canvas', fiber_content: [] }],
  }), false)
})

test('office and client guidance uses explicit request situations rather than all smart-casual requests', () => {
  const applicability = extractOwnerGuidanceApplicability('For office and client days: structured silhouettes only.')
  assert.deepEqual(applicability.context.situations, ['office', 'client'])
  assert.equal(ownerGuidanceApplies(applicability, { requestContext: { requestText: 'five office outfits' } }), true)
  assert.equal(ownerGuidanceApplies(applicability, { requestContext: { requestText: 'smart casual museum visit' } }), false)
})

test('season-scoped guidance treats current season as its calendar season', () => {
  const applicability = extractOwnerGuidanceApplicability('I avoid suede shoes in summer.')
  const pieces = [{ id: 1, category: 'shoes', name: 'Olive suede slip-ons', fabric_category: 'suede', fiber_content: [] }]
  assert.equal(ownerGuidanceApplies(applicability, {
    requestContext: { season: 'current season', currentDate: new Date('2026-07-15T12:00:00-07:00') },
    pieces,
  }), true)
  assert.equal(ownerGuidanceApplies(applicability, {
    requestContext: { season: 'current season', currentDate: new Date('2026-01-15T12:00:00-08:00') },
    pieces,
  }), false)
})

test('a repeated correction can gain a validated proposal without duplicating the memory', () => {
  storeUserCorrection('No dresses for travel.', 'general', null)
  const result = storeUserCorrection('No dresses for travel.', 'general', null, {
    firmRuleProposal: {
      selector_type: 'category',
      selector_values: ['dress'],
      context_dimension: 'occasion',
      context_values: ['travel'],
      reason: "Don't suggest dresses for travel.",
    },
  })
  assert.equal(result.firm_rule_proposed, true)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stylist_feedback').get().n, 1)
  assert.equal(JSON.parse(db.prepare('SELECT payload FROM stylist_feedback').get().payload).ownerConstraintProposal.contextDimension, 'occasion')
})

test('a verified garment correction writes the garment rule and a display-only receipt', async () => {
  const pieceId = Number(db.prepare("INSERT INTO pieces (name, category, styling_rules_learned) VALUES ('Test top', 'top', '[]')").run().lastInsertRowid)
  const note = 'This top only works untucked.'
  const result = await executeTool('store_user_correction', { note, piece_id: pieceId }, {
    retrievedPieceIds: new Set([pieceId]),
  })
  assert.equal(result.status, 'success')
  assert.equal(result.scope, 'piece')
  assert.deepEqual(JSON.parse(db.prepare('SELECT styling_rules_learned FROM pieces WHERE id = ?').get(pieceId).styling_rules_learned), [note])
  const receipt = db.prepare("SELECT * FROM stylist_feedback WHERE feedback_type = 'piece_rule_receipt'").get()
  assert.equal(Number(receipt.context_id), pieceId)
  assert.equal(receipt.context_name, 'Test top')
  assert.equal(getOwnerRuleNotes().includes(note), false, 'the receipt must not become duplicate global prompt authority')
})

test('an unverified garment id is refused without falling back to global memory', async () => {
  const pieceId = Number(db.prepare("INSERT INTO pieces (name, category, styling_rules_learned) VALUES ('Test top', 'top', '[]')").run().lastInsertRowid)
  const result = await executeTool('store_user_correction', {
    note: 'This garment is too stiff for sitting all day.',
    piece_id: pieceId,
  }, { retrievedPieceIds: new Set() })
  assert.equal(result.status, 'validation_error')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stylist_feedback').get().n, 0)
  assert.deepEqual(JSON.parse(db.prepare('SELECT styling_rules_learned FROM pieces WHERE id = ?').get(pieceId).styling_rules_learned), [])
})

test('editing and retiring the receipt synchronizes the canonical garment rule', async () => {
  const pieceId = Number(db.prepare("INSERT INTO pieces (name, category, styling_rules_learned) VALUES ('Test top', 'top', '[]')").run().lastInsertRowid)
  const original = 'This top only works untucked.'
  const revised = 'Wear this top untucked so the hem remains visible.'
  storeUserCorrection(original, 'general', null, { pieceId })
  const receipt = db.prepare("SELECT * FROM stylist_feedback WHERE feedback_type = 'piece_rule_receipt'").get()
  syncPieceRuleReceipt(receipt, { note: revised, archived: false })
  db.prepare('UPDATE stylist_feedback SET note = ? WHERE id = ?').run(revised, receipt.id)
  assert.deepEqual(JSON.parse(db.prepare('SELECT styling_rules_learned FROM pieces WHERE id = ?').get(pieceId).styling_rules_learned), [revised])
  syncPieceRuleReceipt({ ...receipt, note: revised }, { archived: true })
  assert.deepEqual(JSON.parse(db.prepare('SELECT styling_rules_learned FROM pieces WHERE id = ?').get(pieceId).styling_rules_learned), [])
})

test('a stale receipt cannot duplicate a garment rule edited on the garment card', () => {
  const pieceId = Number(db.prepare("INSERT INTO pieces (name, category, styling_rules_learned) VALUES ('Test top', 'top', '[]')").run().lastInsertRowid)
  const original = 'This top only works untucked.'
  const cardEdit = 'Wear untucked; the finished hem should remain visible.'
  storeUserCorrection(original, 'general', null, { pieceId })
  const receipt = db.prepare("SELECT * FROM stylist_feedback WHERE feedback_type = 'piece_rule_receipt'").get()
  db.prepare('UPDATE pieces SET styling_rules_learned = ? WHERE id = ?').run(JSON.stringify([cardEdit]), pieceId)

  assert.throws(
    () => syncPieceRuleReceipt(receipt, { note: 'A third wording.', archived: false }),
    error => error?.status === 409 && /edited or removed on the garment card/.test(error.message)
  )
  assert.deepEqual(
    JSON.parse(db.prepare('SELECT styling_rules_learned FROM pieces WHERE id = ?').get(pieceId).styling_rules_learned),
    [cardEdit]
  )
})

test('un-archiving a garment-rule receipt restores its canonical rule without duplication', () => {
  const pieceId = Number(db.prepare("INSERT INTO pieces (name, category, styling_rules_learned) VALUES ('Test top', 'top', '[]')").run().lastInsertRowid)
  const note = 'This top only works untucked.'
  storeUserCorrection(note, 'general', null, { pieceId })
  const receipt = db.prepare("SELECT * FROM stylist_feedback WHERE feedback_type = 'piece_rule_receipt'").get()
  syncPieceRuleReceipt(receipt, { archived: true })

  syncPieceRuleReceipt({ ...receipt, archived: 1 }, { archived: false })
  syncPieceRuleReceipt({ ...receipt, archived: 1 }, { archived: false })

  assert.deepEqual(
    JSON.parse(db.prepare('SELECT styling_rules_learned FROM pieces WHERE id = ?').get(pieceId).styling_rules_learned),
    [note]
  )
})

test('getStylistFeedbackMemory renders owner-rule rows and withholds positive board reactions from broad prompt memory', () => {
  insertFeedback({ feedback_type: 'signature', target_type: 'whole_wardrobe_outfit', label: 'Nice Dinner', note: 'geometric maxi skirt + ruffled plum top... perfect for an upscale dinner' })
  insertFeedback({ feedback_type: 'owner_rule', target_type: 'message', note: 'For office and client days: structured silhouettes only — no maxi skirts, no shawls at work.' })

  const text = getStylistFeedbackMemory(null, null, 24)
  assert.match(text, /Owner rules \(standing, apply them\):/)
  assert.match(text, /- OWNER RULE: For office and client days: structured silhouettes only/)
  assert.doesNotMatch(text, /Saved reactions \(/)
  assert.doesNotMatch(text, /Nice Dinner/)
})

test('global feedback memory can exclude an already-delivered scoped context without dropping owner rules', () => {
  insertFeedback({ feedback_type: 'works', target_type: 'whole_wardrobe_outfit', context_type: 'piece', context_id: 42, note: 'Scoped reaction already delivered above.' })
  insertFeedback({ feedback_type: 'owner_rule', target_type: 'message', context_type: 'general', note: 'Always keep an operational shoe option.' })

  const text = getStylistFeedbackMemory(null, null, 24, { excludeContexts: [{ type: 'piece', id: 42 }] })
  assert.doesNotMatch(text, /Scoped reaction already delivered above/)
  assert.match(text, /Always keep an operational shoe option/)
})

test('legacy preference_reaction/message rows are treated as owner rules (no migration needed)', () => {
  insertFeedback({ feedback_type: 'preference_reaction', target_type: 'message', note: 'I do not wear ankle boots in summer.' })
  const text = getStylistFeedbackMemory(null, null, 24)
  assert.match(text, /Owner rules \(standing, apply them\):/)
  assert.match(text, /- OWNER RULE: I do not wear ankle boots in summer\./)
  assert.doesNotMatch(text, /Saved reactions \(/, 'no reaction rows exist, so that section must not render')
})

test('getStylistFeedbackMemory returns empty when only a positive board reaction exists', () => {
  insertFeedback({ feedback_type: 'works', target_type: 'whole_wardrobe_outfit', label: 'Weekend Board', note: 'the linen set worked well' })
  const text = getStylistFeedbackMemory(null, null, 24)
  assert.equal(text, '')
})

test('getStylistFeedbackMemory returns empty string when the table is empty', () => {
  assert.equal(getStylistFeedbackMemory(null, null, 24), '')
})

test('getOwnerRuleNotes returns owner-rule notes newest first, capped, and empty when none exist', () => {
  assert.deepEqual(getOwnerRuleNotes(8), [])

  insertFeedback({ feedback_type: 'owner_rule', target_type: 'message', note: 'Rule one (oldest).' })
  insertFeedback({ feedback_type: 'preference_reaction', target_type: 'message', note: 'Rule two (legacy type, still a rule).' })
  insertFeedback({ feedback_type: 'signature', target_type: 'whole_wardrobe_outfit', label: 'Board', note: 'not a rule — a reaction' })
  insertFeedback({ feedback_type: 'owner_rule', target_type: 'message', note: 'Rule three (newest).' })

  const notes = getOwnerRuleNotes(8)
  assert.deepEqual(notes, ['Rule three (newest).', 'Rule two (legacy type, still a rule).', 'Rule one (oldest).'])
})

test('getOwnerRuleNotes respects its cap', () => {
  for (let i = 0; i < 12; i += 1) {
    insertFeedback({ feedback_type: 'owner_rule', target_type: 'message', note: `Rule ${i}` })
  }
  assert.equal(getOwnerRuleNotes(8).length, 8)
})
