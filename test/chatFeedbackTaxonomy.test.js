import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const chatSource = fs.readFileSync(new URL('../src/components/StylistChat.jsx', import.meta.url), 'utf8')
const visualLabSource = fs.readFileSync(new URL('../src/components/VisualLab.jsx', import.meta.url), 'utf8')
const routesSource = fs.readFileSync(new URL('../routes/crud.js', import.meta.url), 'utf8')

test('Stylist chat and Visual Lab consume one shared feedback taxonomy', () => {
  assert.match(chatSource, /from '\.\.\/\.\.\/lib\/feedbackTaxonomy\.js'/)
  assert.match(visualLabSource, /from '\.\.\/\.\.\/lib\/feedbackTaxonomy\.js'/)
  assert.doesNotMatch(chatSource, /\['weak_structure', 'Weak structure'\]/)
  assert.doesNotMatch(chatSource, /\['wrong_silhouette', 'Wrong silhouette'\]/)
})

test('generated chat boards save structured reasons and mutually exclusive verdicts', () => {
  assert.match(chatSource, /feedback_reason: reason \|\| null/)
  assert.match(chatSource, /selectGeneratedBoardVerdict/)
  assert.match(chatSource, /verdictKeys = OVERALL_VERDICT_LABELS/)
  assert.match(chatSource, /payload: \{ board: visual/)
  assert.match(chatSource, /GeneratedBoardLengthFeedback/)
  assert.match(chatSource, /length_correction: \{ piece_id:/)
  assert.match(chatSource, /wrongLengthReasonsForCategory/)
  assert.match(chatSource, /collapsedFeedbackCards\.has\(cardKey\)/)
  assert.match(chatSource, /toggleFeedbackCardExpansion\(cardKey, isExpanded\)/)
})

test('saving a chat board carries structured feedback reasons into the board record', () => {
  assert.match(routesSource, /existingFeedbackReasonRows/)
  assert.match(routesSource, /feedback_details: syncedFeedbackDetails/)
  assert.match(routesSource, /feedbackDetails\[category\]/)
  assert.match(routesSource, /syncedFeedbackDetails\.wrong_length/)
  assert.match(routesSource, /length_correction/)
})
