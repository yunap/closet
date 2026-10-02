// STORED GARMENT RULES across every model-facing reader (docs/garment-evidence-parity-2026-09-15.md §2a; owner rulings
// 2026-08-08 and 2026-09-15). Stored data is never modified.
//   - The owner's historical stored rules keep their authority: `RULES (authoritative)`. An empty piece_rule_receipt ledger is
//     not evidence that a rule was not the owner's.
//   - Narrow exclusions only: generated occasion receipts; retired `[feedback:<type>]` outfit-reaction copies; a saved chat reply,
//     identified by its SOURCE (a message the retired Save button marked in a thread's savedIndices).
//   - The separate global owner-feedback readers (standing owner rules, feedback memory, synthesis, saved boards, owner
//     constraints, occasion exclusions) are unchanged: they neither read nor are affected by stored garment rules.
// Readers: buildPieceText (capsule, trip, get_garment_details, selected-piece flows), capsule and trip roster selection, trip
// composition, the /ask compact facts JSON, get_garment_details through the real tool, and the shared evidence notes (change 1).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-provenance-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const { db, parsePiece } = await import('../db.js')
const { storedGarmentRules, _clearRuleProvenanceCacheForTests } = await import('../styling-engine/ruleProvenance.js')
const rules = await import('../styling-engine/rules.js')
const { buildPieceText } = rules
const { capsuleRosterSelectionUserText, tripRosterSelectionUserText, tripPlanTruthCatalog, tripPlanPieceNotes, compactFreeformPieceFacts } = await import('../routes/ai.js')
const { executeTool } = await import('../styling-engine/tools.js')
const { garmentNotesText } = await import('../styling-engine/garmentEvidenceLine.js')

// Historical owner-confirmed rule shapes from the provenance audit — none has a receipt, as none in the live ledger does.
const OWNER_RULE = 'Too refined for trail/hike wear — city and evening contexts only (Owner 2026-06-12).'
const OWNER_RULE_2 = 'This cardigan is clingy and needs a very thin base layer.'
const OCCASION_RECEIPT = 'Excluded from hiking by Owner (2026-07-07)'
const COPY = '[feedback:works] (usable variation) This pairing offers a clean silhouette.'
const SAVED_REPLY = '![Board](sandbox:/uploads/generated-boards/b.png)\n\nThe orange tank does exactly what we wanted. Want to swap the shoes?'

const insert = (name, stored) => Number(db.prepare(`INSERT INTO pieces (name, category, status, occasions, styling_rules_learned, tried_and_rejected)
  VALUES (?, 'top', 'active', '["city"]', ?, '["with the floral skirt"]')`).run(name, JSON.stringify(stored)).lastInsertRowid)
// The same piece carries a historical owner rule and a retired reaction copy (plus the other narrow exclusions).
const mixedId = insert('taupe suede ankle boots', [OWNER_RULE, COPY, OCCASION_RECEIPT, SAVED_REPLY, OWNER_RULE_2])
const copyOnlyId = insert('navy slip-on shoes', [COPY])
db.prepare('INSERT INTO chat_threads (id, title, payload) VALUES (?, ?, ?)').run('thread_saved', 't', JSON.stringify({ messages: [{ role: 'user', text: 'style it' }, { role: 'assistant', text: SAVED_REPLY }], savedIndices: [1] }))
_clearRuleProvenanceCacheForTests()
const piece = id => parsePiece(db.prepare('SELECT * FROM pieces WHERE id = ?').get(id))

const assertOwnerRulesAuthoritative = (text, label, sep = ' | ') => {
  assert.ok(text.includes(`RULES (authoritative):${sep === ' | ' ? ' ' : ''}${OWNER_RULE}${sep}${OWNER_RULE_2}`), `${label}: historical owner rules keep their authority, in stored order:\n${text}`)
  assert.doesNotMatch(text, /author not recorded|STORED RULES/, `${label}: no downgraded label`)
  assert.doesNotMatch(text, /\[feedback:|clean silhouette/, `${label}: the retired reaction copy on the same piece is not a rule`)
  assert.doesNotMatch(text, /orange tank|sandbox:/, `${label}: the saved chat reply is not a rule`)
  assert.doesNotMatch(text, /Excluded from hiking/, `${label}: occasion receipts stay filtered`)
}

test('same piece, historical owner rule + retired copy: the owner rule stays authoritative, the copy is excluded, stored data untouched', () => {
  assert.deepEqual(storedGarmentRules(piece(mixedId)), [OWNER_RULE, OWNER_RULE_2])
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM stylist_feedback WHERE feedback_type = 'piece_rule_receipt'").get().n, 0, 'no receipt exists, as in the live ledger')
  assert.deepEqual(piece(mixedId).styling_rules_learned, [OWNER_RULE, COPY, OCCASION_RECEIPT, SAVED_REPLY, OWNER_RULE_2], 'nothing is deleted from the garment')
  assert.deepEqual(storedGarmentRules(piece(copyOnlyId)), [], 'a piece whose only stored entry is a retired copy has no rules')
  assert.doesNotMatch(buildPieceText(piece(copyOnlyId)), /RULES/)
  // Source, not content: an embedded image without a saved-message source is an ordinary owner rule.
  const lookalike = '![Board](sandbox:/uploads/generated-boards/other.png)\n\nA different message nobody saved.'
  assert.deepEqual(storedGarmentRules({ id: 999, styling_rules_learned: [lookalike] }), [lookalike])
})

test('buildPieceText (capsule, trip, get_garment_details and selected-piece truth)', () => {
  const text = buildPieceText(piece(mixedId))
  assertOwnerRulesAuthoritative(text, 'buildPieceText')
  assert.match(text, /REJECTED: with the floral skirt/)
})

test('capsule roster selection, trip roster selection and trip composition', () => {
  const slots = [{ label: 'City', occasion: 'city', bestFor: 'city days', targetOutfits: 1 }]
  assertOwnerRulesAuthoritative(capsuleRosterSelectionUserText({ bench: [piece(mixedId)], slots }), 'capsule roster selection')
  assertOwnerRulesAuthoritative(tripRosterSelectionUserText({ bench: [piece(mixedId)], slots }), 'trip roster selection')
  // Trip composition: the fact line carries no rules; the owner rules travel in piece_notes with their authority.
  assert.doesNotMatch(tripPlanTruthCatalog([piece(mixedId)]).join('\n'), /RULES|feedback:/)
  assertOwnerRulesAuthoritative(tripPlanPieceNotes([piece(mixedId)]).join('\n'), 'trip composition notes')
})

test('/ask compact garment facts: the owner rules, without the copy, receipt or saved reply', () => {
  const facts = compactFreeformPieceFacts(piece(mixedId))
  assert.deepEqual(facts.styling_rules_learned, [OWNER_RULE, OWNER_RULE_2])
})

test('get_garment_details (real tool)', async () => {
  const details = await executeTool('get_garment_details', { ids: [mixedId] }, { retrievedPieceIds: new Set(), visuallySeenPieceIds: new Set(), freeformDiagnostics: {} })
  assertOwnerRulesAuthoritative((Array.isArray(details) ? details : []).map(entry => entry.text || '').join('\n'), 'get_garment_details')
})

test('shared evidence notes (change 1, default off) carry the same authority', () => {
  const notes = garmentNotesText(piece(mixedId))
  assert.equal(notes, `RULES (authoritative): ${OWNER_RULE} | ${OWNER_RULE_2}; REJECTED: with the floral skirt`)
})

test('global owner-feedback readers are unchanged: identical output whatever the stored garment rules are, and no stored-rule reader inside', () => {
  db.prepare(`INSERT INTO stylist_feedback (feedback_type, target_type, context_type, note, payload) VALUES ('owner_rule', 'message', 'general', 'Prefer a cropped layer over long knits', '{}')`).run()
  const snapshot = () => JSON.stringify({
    ownerRules: rules.getOwnerRuleNotes(8),
    stylistFeedback: rules.getStylistFeedbackMemory(),
    wholeWardrobe: rules.getWholeWardrobeFeedbackMemory(),
    synthesis: rules.getAcceptedFeedbackSynthesisMemory(8, {}),
    savedBoards: rules.getSavedBoardMemory(),
  })
  const before = snapshot()
  assert.match(before, /Prefer a cropped layer over long knits/, 'the standing owner rule is delivered')
  db.prepare('UPDATE pieces SET styling_rules_learned = ? WHERE id = ?').run(JSON.stringify([COPY]), mixedId)
  assert.equal(snapshot(), before, 'changing a garment\'s stored rules does not change any global owner-feedback reader')
  db.prepare('UPDATE pieces SET styling_rules_learned = ? WHERE id = ?').run(JSON.stringify([OWNER_RULE, COPY, OCCASION_RECEIPT, SAVED_REPLY, OWNER_RULE_2]), mixedId)

  // Source level: none of the global readers calls the stored-rule code, and each body is byte-identical to the last commit.
  const readers = {
    'styling-engine/rules.js': ['getStylistFeedbackMemory', 'getSavedBoardRendererMemory', 'getOwnerRuleNotes', 'isOwnerRuleRow', 'getAcceptedFeedbackSynthesisMemory', 'getSavedBoardMemory', 'getOutfitsForPieceMemory', 'getRecentWholeWardrobeSessionInfluence', 'pieceOccasionCompatible', 'getProvisionalWrongChoiceMemory', 'getWholeWardrobeFeedbackMemory'],
    'styling-engine/core.js': ['getCalibrationMemoryForStylist', 'withSavedBoardRendererMemory'],
    'styling-engine/tools.js': ['getLastOutfitEvaluation'],
    'lib/ownerConstraints.js': ['ownerConstraintApplies', 'parseOwnerConstraintRow'],
    'styling-engine/conversationState.js': ['getStylistConversationState'],
  }
  const body = (src, name) => {
    const match = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(src)
    if (!match) return null
    let depth = 0, end = src.indexOf('{', src.indexOf(')', match.index))
    for (; end < src.length; end++) { if (src[end] === '{') depth++; else if (src[end] === '}' && !--depth) break }
    return src.slice(match.index, end + 1)
  }
  let head = null
  for (const [file, names] of Object.entries(readers)) {
    const src = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
    try { head = execSync(`git show HEAD:${file}`, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }) } catch { head = null }
    for (const name of names) {
      const current = body(src, name)
      assert.ok(current, `${file} ${name} exists`)
      assert.doesNotMatch(current, /storedGarmentRules|ruleProvenance|buildPieceText|styling_rules_learned/, `${file} ${name} does not read stored garment rules`)
      // getWholeWardrobeFeedbackMemory carries an earlier, unrelated owner ruling (2026-09-13 narrow evidence authority) on this branch.
      if (head && name !== 'getWholeWardrobeFeedbackMemory') assert.equal(current, body(head, name), `${file} ${name} is byte-identical to the last commit`)
    }
  }
})
