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

after(() => {
  db.close()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

beforeEach(() => {
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

test('getStylistFeedbackMemory renders owner-rule rows with the OWNER RULE prefix under their own sub-header, sorted above reactions', () => {
  // Insert the reaction FIRST (lower id) and the rule SECOND (higher id) —
  // the default id-desc ordering would otherwise put the reaction on top;
  // owner rules must sort above reactions regardless of recency.
  insertFeedback({ feedback_type: 'signature', target_type: 'whole_wardrobe_outfit', label: 'Nice Dinner', note: 'geometric maxi skirt + ruffled plum top... perfect for an upscale dinner' })
  insertFeedback({ feedback_type: 'owner_rule', target_type: 'message', note: 'For office and client days: structured silhouettes only — no maxi skirts, no shawls at work.' })

  const text = getStylistFeedbackMemory(null, null, 24)
  assert.match(text, /Owner rules \(standing, apply them\):/)
  assert.match(text, /- OWNER RULE: For office and client days: structured silhouettes only/)
  assert.match(text, /Saved reactions \(scoped to the named board\/context they were given on — taste signals, not global directives\):/)
  assert.match(text, /- signature on whole_wardrobe_outfit — Nice Dinner/)
  assert.ok(text.indexOf('Owner rules (standing') < text.indexOf('Saved reactions ('), 'owner rules must render above the scoped-reaction section')
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

test('getStylistFeedbackMemory renders only the scoped-reaction section when no owner rules exist', () => {
  insertFeedback({ feedback_type: 'works', target_type: 'whole_wardrobe_outfit', label: 'Weekend Board', note: 'the linen set worked well' })
  const text = getStylistFeedbackMemory(null, null, 24)
  assert.doesNotMatch(text, /Owner rules \(standing/)
  assert.match(text, /Saved reactions \(scoped to the named board\/context/)
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
