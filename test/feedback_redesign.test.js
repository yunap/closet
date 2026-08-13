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

test('StylistChat.jsx describes the garment as a wrong choice for this outfit', () => {
  const content = fs.readFileSync(stylistChatPath, 'utf8')

  assert.ok(content.includes('Wrong choice for this outfit'), 'Should include the contextual outfit-choice wording')
  assert.ok(content.includes('✓ Wrong choice for this outfit'), 'Should include the selected state')
  assert.ok(!content.includes("'piece issue'") && !content.includes('"piece issue"'), 'Should not contain old name')
  assert.ok(content.includes('contextual feedback rather than avoiding the garment everywhere'))
})

test('Style profile distinguishes reaction sources from related records', () => {
  const content = fs.readFileSync(path.join(__dirname, '../src/views/StylistSettings.jsx'), 'utf8')
  assert.ok(content.includes('Open source chat'))
  assert.ok(content.includes('Open source board'))
  assert.ok(content.includes('Open related board'))
  assert.ok(content.includes('Open related garment'))
  assert.ok(content.includes("const sourceSurface = row?.payload?.feedbackEvidence?.source?.surface"))
  assert.ok(content.includes('const canOpenSourceBoard = hasImageBoardMatch && boardIsSource'))
  assert.ok(content.includes("boardIsSource ? 'Source board' : 'Related board'"))
  assert.match(content, /onGoToThread\(row\.referenced_thread_id\)/,
    'The source-chat action must open the source thread directly instead of following a board fallback')
})

test('Style profile requires a free preview before explicitly authorizing synthesis', () => {
  const content = fs.readFileSync(path.join(__dirname, '../src/views/StylistSettings.jsx'), 'utf8')
  // "Preview synthesis cost" / "synthesis" were renamed to "See cost & review" / "Review for a
  // possible lesson" — she doesn't need to know the backend calls this synthesis — but the
  // underlying safety property (a free preview happens before any paid call is authorized) is
  // unchanged and still enforced server-side by requiring authorize:true.
  assert.ok(content.includes('See cost & review'))
  assert.ok(content.includes('Review for a possible lesson'))
  assert.ok(content.includes('Preview calls: {synthesisPreview.providerCalls}'))
  assert.ok(content.includes('Authorize one model call'))
  assert.match(content, /authorize:\s*true/)
  assert.ok(content.includes('Nothing was accepted automatically.'))
})

test('synthesis review always shows the proposed lesson when no owner edit exists yet', () => {
  const content = fs.readFileSync(path.join(__dirname, '../src/views/StylistSettings.jsx'), 'utf8')
  assert.ok(content.includes('synthesisEdits[draft.id] ?? effectiveSynthesisText(draft)'))
  assert.doesNotMatch(content, /draft\.edited_text \?\? draft\.proposed_text/)
})

test('a pending draft asks a plain question and only reveals editing behind "The wording"', () => {
  const content = fs.readFileSync(path.join(__dirname, '../src/views/StylistSettings.jsx'), 'utf8')
  // A pending draft is still authorable — she may reword what the stylist proposed before accepting
  // it — but that's reached through "Not quite" -> "The wording", not an always-visible textarea.
  // What she cannot do, here or on an accepted lesson, is adjust where it applies: those conditions
  // are ANDed, so removing one widens delivery instead of narrowing it — there is no boundary
  // textarea and no applicability editor anywhere in this file.
  assert.ok(!content.includes('applicabilityIsUsable'))
  assert.ok(!content.includes('effectiveSynthesisBoundary'))
  // "Boundary" still legitimately labels a raw field on the separate product-issue list further
  // down this file (a different surface, out of scope here) — so the real check that the pending
  // lesson card itself never shows it lives in the render test (styleProfileRenders.test.js),
  // which reads actual DOM text rather than grepping the whole file for a common word.
  assert.ok(!content.includes('Would be used when:'))
  assert.ok(content.includes("triage === 'wording'"))
  assert.ok(content.includes("triage === 'chips'"))
  assert.ok(content.includes('pendingSynthesisDrafts.length > 0'))
  assert.ok(content.includes('actionableContextualFeedback'))
  assert.ok(content.includes('row.memory?.synthesisEligible && !processedSynthesisFeedbackIds.has(row.id)'))
  assert.ok(content.includes('actionableContextualFeedback.length > 0 && <div className="style-memory-toolbar">'))
  assert.ok(content.includes('No provisional outfit reactions are currently available for lesson synthesis.'))
})

test('only accepted personal synthesis drafts are eligible for prompt authority', () => {
  const rules = fs.readFileSync(rulesPath, 'utf8')
  assert.match(rules, /status = 'accepted' AND disposition = 'personal_contextual_lesson'/)
  assert.doesNotMatch(rules, /status = 'accepted' AND disposition IN/)
})

test('Wrong-choice feedback asks for an optional verbatim reason and carries explicit weather context', () => {
  const content = fs.readFileSync(stylistChatPath, 'utf8')
  assert.ok(content.includes('What made {pendingWrongChoice.pieceName} wrong for this outfit?'))
  assert.ok(content.includes('Skip reason'))
  assert.ok(content.includes('explicitReason'))
  assert.ok(content.includes('weatherContext'))
})

test('Almost right and Not for me offer a free optional exact-outfit comment', () => {
  const content = fs.readFileSync(stylistChatPath, 'utf8')
  const visualLab = fs.readFileSync(path.join(__dirname, '../src/components/VisualLab.jsx'), 'utf8')
  assert.ok(content.includes("['almost', 'not_me'].includes(type)"))
  assert.ok(content.includes('What feels off? <span>Optional</span>'))
  assert.ok(content.includes('Describe it however you can. Uncertainty is useful too—this stays attached to this exact outfit.'))
  assert.ok(content.includes("payload: { ...args.payload, ownerComment }"))
  assert.ok(content.includes("owner_comment: String(ownerComment || '').trim()"))
  assert.ok(visualLab.includes("['almost', 'not_me'].includes(label)"))
  assert.ok(visualLab.includes('Add optional reason'))
  assert.ok(visualLab.includes('commitVerdictComment(verdictComment)'))
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
