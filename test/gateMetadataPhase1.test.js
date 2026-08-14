import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  buildAnchorBlock,
} from '../styling-engine/taggerMerge.js'
import {
  missingGateFields,
} from '../styling-engine/attributes.js'
import {
  imageCandidatesForPiece,
  validateComparativeFormalityProposal
} from '../scratch/backfill_gate_metadata.js'
import { intakeReviewSummary } from '../src/utils/intakeReview.js'
import {
  finalizeReport,
  newFlowReport,
  recordReplayPiece
} from '../scratch/recall_at_cap.js'

const prompts = fs.readFileSync(new URL('../styling-engine/prompts.js', import.meta.url), 'utf8')
const routeAi = fs.readFileSync(new URL('../routes/ai.js', import.meta.url), 'utf8')
const taggerMerge = fs.readFileSync(new URL('../styling-engine/taggerMerge.js', import.meta.url), 'utf8')
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

test('tag-piece endpoints share anchor block and response confidence shape', () => {
  assert.match(routeAi, /content\.push\(\{ type: 'text', text: anchorBlock\.text \}\)/)
  assert.match(routeAi, /tags\._confidence = confidence/)
  assert.match(routeAi, /tags\.tag_state = tagStateForTaggerResult/)
  assert.match(routeAi, /merged\._confidence = merged\.style_profile_json\?\._confidence \|\| \{\}/)
  assert.match(routeAi, /router\.post\('\/tag-piece-existing\/:id'/)
  assert.equal((routeAi.match(/\]\), tagExistingHandler\)/g) || []).length, 1)
})

test('gate metadata audit and backfill include register and footwear fields', () => {
  for (const field of ['formality', 'heel_height', 'walk_support']) {
    assert.match(auditScript, new RegExp(`key: '${field}'`))
    assert.match(backfillScript, new RegExp(`wants\\.has\\('${field}'\\)`))
  }
  assert.match(auditScript, /formality_contact_sheets/)
  assert.match(auditScript, /formality-borderline/)
  assert.match(backfillScript, /buildAnchorBlock\(\{ pieces: allActivePieces\(\), fields: \['formality'\] \}\)/)
  assert.match(taggerMerge, /These assignments are ground truth for THIS wardrobe/)
  assert.match(backfillScript, /--comparative-formality/)
  assert.match(backfillScript, /--apply-comparative-proposals/)
  assert.match(backfillScript, /accepted !== true/)
  assert.match(backfillScript, /model returned invalid JSON/)
})

test('anchor block comes from manual overrides and is capped per value', () => {
  const block = buildAnchorBlock({ pieces: [
    { id: 1, name: 'old everyday', formality: 'everyday', category: 'top', manual_overrides: ['formality'] },
    { id: 2, name: 'new everyday', formality: 'everyday', category: 'top', manual_overrides: ['formality'] },
    { id: 3, name: 'newer everyday', formality: 'everyday', category: 'top', manual_overrides: ['formality'] },
    { id: 4, name: 'newest everyday', formality: 'everyday', category: 'top', manual_overrides: ['formality'] },
    { id: 5, name: 'not manual', formality: 'dressy', category: 'dress', manual_overrides: [] },
    { id: 6, name: 'manual dress', formality: 'dressy', category: 'dress', fabric_category: 'silk', reads_as: 'formal floral', manual_overrides: ['formality'] }
  ], fields: ['formality'], perValue: 3 })
  assert.deepEqual(block.anchors.filter(anchor => anchor.value === 'everyday').map(anchor => anchor.id), [4, 3, 2])
  assert.equal(block.anchors.some(anchor => anchor.id === 5), false)
  assert.match(block.text, /ground truth for THIS wardrobe/)
  assert.match(block.text, /manual dress/)
  assert.match(block.text, /fabric: silk/)
})

test('anchor block is defined once and consumed by intake and backfill', () => {
  const sources = [taggerMerge, routeAi, backfillScript].join('\n')
  assert.equal((sources.match(/function buildAnchorBlock/g) || []).length, 1)
  assert.match(routeAi, /buildAnchorBlock\(\{[\s\S]*fields: \['formality',\s*'fabric_weight'\]/)
  assert.match(backfillScript, /buildAnchorBlock\(\{ pieces: allActivePieces\(\), fields: \['formality'\] \}\)/)
})

test('missingGateFields respects shoe-only fields and intake occasion curation', () => {
  assert.deepEqual(missingGateFields({
    category: 'shoes',
    formality: 'everyday',
    fabric_weight: 'medium',
    fiber_content: ['leather'],
    occasions: ['city'],
    heel_height: 'flat',
    shoe_type: 'boot'
  }), ['walk_support'])
  assert.deepEqual(missingGateFields({
    category: 'shoes',
    formality: 'everyday',
    fabric_weight: 'medium',
    fiber_content: ['leather'],
    occasions: ['city'],
    heel_height: 'flat',
    walk_support: 'high'
  }), ['shoe_type'])
  assert.deepEqual(missingGateFields({
    category: 'top',
    formality: 'everyday',
    fabric_weight: 'light',
    fiber_content: ['cotton'],
    occasions: []
  }), ['occasions'])
  assert.deepEqual(missingGateFields({
    category: 'top',
    formality: 'everyday',
    fabric_weight: 'light',
    fiber_content: ['cotton'],
    occasions: ['casual']
  }), [])
})

test('intake review summary counts low-confidence and missing gate fields', () => {
  const summary = intakeReviewSummary({
    category: 'top',
    formality: 'everyday',
    fabric_weight: '',
    fiber_content: ['cotton'],
    occasions: ['city'],
    style_profile_json: { _confidence: { formality: 'low', fabric_weight: 'low', colors: 'medium' } }
  })
  assert.equal(summary.lowConfidenceCount, 2)
  assert.deepEqual(summary.missingGateFields, ['fabric_weight'])
})

test('formality retagging sends both hanger and worn photos only for formality fields', () => {
  const piece = { photo: 'hanger.jpg', worn_photo: 'worn.jpg' }
  assert.deepEqual(imageCandidatesForPiece(piece, ['formality']).map(item => item.label), ['HANGER PHOTO', 'WORN PHOTO'])
  assert.deepEqual(imageCandidatesForPiece(piece, ['fabric_weight']).map(item => item.label), ['GARMENT PHOTO'])
  assert.deepEqual(imageCandidatesForPiece({ photo: 'hanger.jpg' }, ['formality']).map(item => item.label), ['HANGER PHOTO'])
})

test('comparative formality proposals skip manual pieces and require correction shape', () => {
  const manualIds = new Set([10])
  assert.equal(validateComparativeFormalityProposal({ id: 10, current: 'everyday', proposed: 'elevated', reason: 'manual' }, { manualIds }), false)
  assert.equal(validateComparativeFormalityProposal({ id: 11, current: 'everyday', proposed: 'elevated', reason: 'more structured than peer tops' }, { manualIds }), true)
  assert.equal(validateComparativeFormalityProposal({ id: 12, current: 'dressy', proposed: 'dressy', reason: 'same' }, { manualIds }), false)
  assert.equal(validateComparativeFormalityProposal({ id: 13, current: 'dressy', proposed: 'formal', reason: 'bad enum' }, { manualIds }), false)
})

test('recall replay segments accessory misses outside headline recall', () => {
  const flow = newFlowReport()
  const outfit = { id: 1, name: 'Saved look', occasion: 'casual', season: 'current season' }
  recordReplayPiece(flow, {
    outfit,
    piece: { id: 20, name: 'black top', category: 'top' },
    hit: 0,
    weatherProfile: {},
    miss: { layer: 'cap', reason: 'roster cap' }
  })
  recordReplayPiece(flow, {
    outfit,
    piece: { id: 21, name: 'silver pendant', category: 'accessory' },
    hit: 0,
    weatherProfile: {},
    miss: { layer: 'gate', reason: 'accessories excluded from visual composer' }
  })
  const report = { flows: { whole_wardrobe_visual: flow }, conclusion: '' }
  finalizeReport(report)
  assert.equal(flow.overall.total, 1)
  assert.equal(flow.accessories.overall.total, 1)
  assert.equal(flow.misses.length, 1)
  assert.equal(flow.accessories.misses.length, 1)
  assert.deepEqual(report.layerCounts, { cap: 1 })
  assert.deepEqual(report.accessoryLayerCounts, { gate: 1 })
})

test('footwear comfort is explicitly tracked by the text matching ratchet', () => {
  assert.equal(ratchet.fileCounts['styling-engine/footwear-comfort.js'], 0)
})

test('backfill_retagger.js includes Write-Path Guard and field/confidence constraints', () => {
  const retaggerSource = fs.readFileSync(new URL('../scratch/backfill_retagger.js', import.meta.url), 'utf8')
  assert.match(retaggerSource, /Attempted to overwrite manual override field/)
  assert.match(retaggerSource, /normalizeManualOverrides/)
  assert.match(retaggerSource, /getPath\(newComparison,\s*override\)/)
  assert.match(retaggerSource, /--field/)
  assert.match(retaggerSource, /--confidence/)
})
