// Tagger semantic-consistency cleanup spec (2026-08-23), PR A — semantic prompt cleanup:
// universal garment-analysis rules belong in the static prompt, user-specific calibration
// belongs in dynamic anchors. These tests lock the resolved TAG_PIECE_PROMPT invariants the
// spec required so a future edit can't silently reintroduce the contradictions this cleanup
// removed. Anchor-exclusion and dead-field-removal invariants (spec items 7, 8) land in the
// follow-up process-hardening PR.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPrompts, DEFAULT_PROFILE, DEFAULT_CONSTITUTION } from '../styling-engine/prompts.js'
import { buildAnchorBlock } from '../styling-engine/taggerMerge.js'

const { TAG_PIECE_PROMPT } = buildPrompts({ profile: DEFAULT_PROFILE, constitution: DEFAULT_CONSTITUTION })

test('1. hem_finish does not determine tuck_behavior', () => {
  assert.doesNotMatch(TAG_PIECE_PROMPT, /shirttail.*NOT tuckable/is)
  assert.doesNotMatch(TAG_PIECE_PROMPT, /straight_loose.*only hem.*actually tuckable/is)
  assert.match(TAG_PIECE_PROMPT, /does not by itself determine tuckability/)
  assert.match(TAG_PIECE_PROMPT, /do NOT derive this mechanically from hem_finish/)
})

test('2. static Anchor A does not contradict the strict home rule', () => {
  const anchorASection = TAG_PIECE_PROMPT.slice(
    TAG_PIECE_PROMPT.indexOf('ANCHOR A'),
    TAG_PIECE_PROMPT.indexOf('ANCHOR B')
  )
  assert.match(anchorASection, /home:\s*"low"/)
  assert.doesNotMatch(anchorASection, /home:\s*"(medium|high)"/)
})

test('3. fabric_weight has cross-photo evidence semantics, no single photo type owns it', () => {
  assert.doesNotMatch(TAG_PIECE_PROMPT, /judge weight primarily from how the fabric hangs/)
  assert.match(TAG_PIECE_PROMPT, /no single photo type owns it/)
  assert.match(TAG_PIECE_PROMPT, /lower confidence rather than silently picking/)
})

test('4. uncertain visual evidence may legitimately produce fiber_content: unknown', () => {
  assert.doesNotMatch(TAG_PIECE_PROMPT, /Do not default to 'unknown' too easily/)
  assert.match(TAG_PIECE_PROMPT, /fiber_content: \["unknown"\] rather than inventing a specific fiber/)
  assert.match(TAG_PIECE_PROMPT, /Admitting uncertainty here is correct, not a gap to avoid/)
})

test('5. static formality language contains no owner-specific baseline', () => {
  assert.doesNotMatch(TAG_PIECE_PROMPT, /artisan-nice baseline/i)
  assert.doesNotMatch(TAG_PIECE_PROMPT, /THIS wardrobe's/i)
  assert.match(TAG_PIECE_PROMPT, /neutral contemporary baseline/)
})

test('6. dynamic formality anchors still exist', () => {
  const block = buildAnchorBlock({
    pieces: [{ id: 1, name: 'test blazer', formality: 'elevated', manual_overrides: ['formality'] }],
    fields: ['formality', 'fabric_weight']
  })
  assert.match(block.text, /ground truth for THIS wardrobe/)
  assert.equal(block.anchors.length, 1)
})

test('9. category-conditional enums remain unchanged', () => {
  assert.match(TAG_PIECE_PROMPT, /"formality": "lounge\|everyday\|elevated\|dressy"/)
  assert.match(TAG_PIECE_PROMPT, /"fabric_weight": "ultralight\|light\|medium\|heavy/)
})
