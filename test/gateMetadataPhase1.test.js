import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const prompts = fs.readFileSync(new URL('../styling-engine/prompts.js', import.meta.url), 'utf8')
const routeAi = fs.readFileSync(new URL('../routes/ai.js', import.meta.url), 'utf8')
const auditScript = fs.readFileSync(new URL('../scratch/audit_gate_metadata.js', import.meta.url), 'utf8')
const backfillScript = fs.readFileSync(new URL('../scratch/backfill_gate_metadata.js', import.meta.url), 'utf8')
const ratchet = JSON.parse(fs.readFileSync(new URL('../scratch/ratchet_baseline.json', import.meta.url), 'utf8'))

test('tagger schemas request formality and structured shoe comfort fields', () => {
  for (const source of [prompts, routeAi]) {
    assert.match(source, /"formality": "lounge\|everyday\|elevated\|dressy"/)
    assert.match(source, /"heel_height": "flat\|low\|mid\|high\|null/)
    assert.match(source, /"walk_support": "high\|medium\|low\|null/)
  }
  assert.match(prompts, /Artisan texture, linen, and basic knits do NOT lift a piece out of everyday/)
})

test('gate metadata audit and backfill include register and footwear fields', () => {
  for (const field of ['formality', 'heel_height', 'walk_support']) {
    assert.match(auditScript, new RegExp(`key: '${field}'`))
    assert.match(backfillScript, new RegExp(`wants\\.has\\('${field}'\\)`))
  }
  assert.match(auditScript, /formality_contact_sheets/)
  assert.match(backfillScript, /formality_anchors\.json/)
  assert.match(backfillScript, /pinFormalityAnchor/)
  assert.match(backfillScript, /model returned invalid JSON/)
})

test('footwear comfort is explicitly tracked by the text matching ratchet', () => {
  assert.equal(ratchet.fileCounts['styling-engine/footwear-comfort.js'], 0)
})
