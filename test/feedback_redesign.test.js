import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compatibilityScoreForSelectedItem, piecePriorityForMission, scoreWholeWardrobeCandidate } from '../styling-engine/rules.js'
import { buildWardrobePieceTruthText, stylingRulesForPrompt } from '../src/utils/wardrobeAiContext.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const stylistChatPath = path.join(__dirname, '../src/components/StylistChat.jsx')
const rulesPath = path.join(__dirname, '../styling-engine/rules.js')
const corePath = path.join(__dirname, '../styling-engine/core.js')
const crudPath = path.join(__dirname, '../routes/crud.js')

test('StylistChat.jsx defines correct outfit feedback labels', () => {
  const content = fs.readFileSync(stylistChatPath, 'utf8')

  // Assert that OUTFIT_FEEDBACK_LABELS is defined
  assert.ok(content.includes('const OUTFIT_FEEDBACK_LABELS = ['))

  // Assert OUTFIT_FEEDBACK_LABELS contains works and not_me
  assert.match(content, /['"]works['"]\s*,\s*['"]More like this['"]/)
  assert.match(content, /['"]not_me['"]\s*,\s*['"]Not for me['"]/)

  // Assert they are the only ones in OUTFIT_FEEDBACK_LABELS
  const match = content.match(/const OUTFIT_FEEDBACK_LABELS = \[\s*([\s\S]*?\n\])/)
  assert.ok(match, 'OUTFIT_FEEDBACK_LABELS definition not found')
  const arrayContent = match[1]
  assert.ok(arrayContent.includes('works'), 'Should include works')
  assert.ok(arrayContent.includes('not_me'), 'Should include not_me')

  // Count elements in arrayContent by counting nested brackets `[...]`
  const count = (arrayContent.match(/\[\s*['"][^'"]+['"]\s*,\s*['"][^'"]+['"]\s*\]/g) || []).length
  assert.equal(count, 2, 'OUTFIT_FEEDBACK_LABELS should have exactly 2 elements')
})

test('StylistChat.jsx does not use disabled={isSaved} on outfit-level feedback buttons', () => {
  const content = fs.readFileSync(stylistChatPath, 'utf8')

  // Find the OUTFIT_FEEDBACK_LABELS.map loop
  const loopMatch = content.match(/OUTFIT_FEEDBACK_LABELS\.map\([\s\S]*?<button[\s\S]*?<\/button>/)
  assert.ok(loopMatch, 'OUTFIT_FEEDBACK_LABELS loop not found')
  const buttonContent = loopMatch[0]
  assert.ok(!buttonContent.includes('disabled={isSaved}'), 'Outfit-level buttons must not be disabled when saved')
})

test('StylistChat.jsx renames piece issue to Replace in this outfit', () => {
  const content = fs.readFileSync(stylistChatPath, 'utf8')

  assert.ok(content.includes('Replace in this outfit'), 'Should include Replace in this outfit')
  assert.ok(content.includes('✓ Replaced in this outfit'), 'Should include ✓ Replaced in this outfit')
  assert.ok(!content.includes("'piece issue'") && !content.includes('"piece issue"'), 'Should not contain old name')
  assert.ok(content.includes('contextual feedback rather than avoiding the garment everywhere'))
})

test('generated occasion receipts remain display history but not prompt authority', () => {
  const rules = ['Excluded from Home by Yuna (2026-08-09)', 'Needs a fluid bottom', 'Restored for Home by Yuna (2026-08-10)']
  assert.deepEqual(stylingRulesForPrompt(rules), ['Needs a fluid bottom'])
  const text = buildWardrobePieceTruthText({ name: 'Test shorts', category: 'bottom', styling_rules_learned: rules })
  assert.match(text, /Needs a fluid bottom/)
  assert.doesNotMatch(text, /Excluded from|Restored for/)
})

test('garment favorites are organizational metadata, not ranking authority', () => {
  const selected = { name: 'Plain top', category: 'top', colors: [], occasions: [] }
  const candidate = { name: 'Plain trousers', category: 'bottom', colors: [], occasions: [] }
  assert.equal(
    compatibilityScoreForSelectedItem(selected, { ...candidate, favorite: false }).score,
    compatibilityScoreForSelectedItem(selected, { ...candidate, favorite: true }).score,
  )
  assert.equal(piecePriorityForMission({ ...candidate, favorite: false }, 'mix'), piecePriorityForMission({ ...candidate, favorite: true }, 'mix'))
  assert.equal(scoreWholeWardrobeCandidate([{ ...selected, favorite: false }, candidate]).score, scoreWholeWardrobeCandidate([{ ...selected, favorite: true }, candidate]).score)
})

test('outfit favorites do not add literal-piece history authority', () => {
  const rules = fs.readFileSync(rulesPath, 'utf8')
  const core = fs.readFileSync(corePath, 'utf8')
  assert.doesNotMatch(rules, /favoriteCount|fav_cnt|conf\.favorite/)
  assert.doesNotMatch(core, /status === 'confirmed' \|\| Boolean\(outfit\.favorite\)/)
  assert.doesNotMatch(core, /WHERE status = 'confirmed' OR favorite = 1/)
})

test('retired renderer_calibration has no UI writer and the API refuses legacy writes', () => {
  const chat = fs.readFileSync(stylistChatPath, 'utf8')
  const crud = fs.readFileSync(crudPath, 'utf8')
  assert.doesNotMatch(chat, /renderer_calibration/)
  assert.match(crud, /targetType === 'renderer_calibration'/)
  assert.match(crud, /status\(410\)/)
  assert.match(crud, /renderer_calibration is retired/)
})
