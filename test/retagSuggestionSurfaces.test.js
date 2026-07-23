import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const card = fs.readFileSync(new URL('../src/components/PieceCard.jsx', import.meta.url), 'utf8')
const detail = fs.readFileSync(new URL('../src/components/PieceDetail.jsx', import.meta.url), 'utf8')
const form = fs.readFileSync(new URL('../src/components/PieceForm.jsx', import.meta.url), 'utf8')
const routes = fs.readFileSync(new URL('../routes/crud.js', import.meta.url), 'utf8')
const todos = fs.readFileSync(new URL('../src/views/TodoList.jsx', import.meta.url), 'utf8')

test('pending fidelity corrections surface as garment retag suggestions', () => {
  assert.match(routes, /type = 'retag-suggestion'/)
  assert.match(routes, /source_type = 'saved_board'/)
  assert.match(card, /Retag suggested/)
  assert.match(detail, /piece\.retag_suggestions/)
  assert.match(todos, /'retag-suggestion': \{ label: 'Retag suggestions'/)
  assert.match(todos, /'metadata', 'retag-suggestion'/)
})

test('garment edit highlights suggested fields and resolves only explicit suggestion ids', () => {
  assert.match(form, /suggestedFields\.has\('sleeve_type'\)/)
  assert.match(form, /suggestedFields\.has\('length_hits_at'\)/)
  assert.match(form, /below-knee/)
  assert.match(form, /retag-review-marker/)
  assert.match(form, /resolved_retag_suggestion_ids/)
  assert.match(routes, /resolved_retag_suggestion_ids/)
})
