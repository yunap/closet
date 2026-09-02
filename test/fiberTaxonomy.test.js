// Spec: docs/fiber-evidence-completeness-spec.md §10 — one normalizer, both write paths as
// adapters. The cases below are the ones that behaved differently depending on which path wrote
// the row, or that collapsed two distinct states into one.
import test from 'node:test'
import assert from 'node:assert'
import { fiberContentNormalization, normalizeFiberContent, normalizeFiberCompleteness } from '../styling-engine/fiberTaxonomy.js'
import { applyTaggerResult } from '../styling-engine/taggerMerge.js'
import { buildPrompts } from '../styling-engine/prompts.js'
import { LEGACY_PROFILE, LEGACY_CONSTITUTION } from '../styling-engine/constitutionSeed.js'

const { TAG_PIECE_PROMPT } = buildPrompts({ profile: LEGACY_PROFILE, constitution: LEGACY_CONSTITUTION })

// Stands in for the manual-edit path in routes/crud.js, which receives fiber_content as a JSON
// string from FormData and stores JSON.stringify(normalizeFiberContent(parsed)).
const viaManualEdit = input => JSON.parse(JSON.stringify(normalizeFiberContent(JSON.parse(JSON.stringify(input)))))
const viaTaggerMerge = input =>
  applyTaggerResult({ id: 1, name: 'test piece', manual_overrides: [] }, { fiber_content: input }).fiber_content

test('both write paths persist the same value for the same logical input', () => {
  // The bug this closes: an empty list stored as [] via manual edit and ['unknown'] via the
  // tagger, so the stored state recorded which code wrote the row rather than anything about
  // the garment.
  for (const input of [[], ['unknown'], ['cotton', 'unknown'], ['down', 'polyester'],
    ['polyester', 'down'], ['bogus'], ['Wool', 'wool', ' LINEN '], ['lyocell']]) {
    assert.deepEqual(viaManualEdit(input), viaTaggerMerge(input),
      `write paths disagree for ${JSON.stringify(input)}`)
  }
})

test('empty input normalizes to [] on both paths, not to an asserted unknown', () => {
  // ['unknown'] is an assertion that someone looked and could not tell. Nothing about an empty
  // input supports that. It also matters operationally: isPopulated(['unknown']) is true, so the
  // old default suppressed fiber_content's own gate-critical review chip.
  assert.deepEqual(viaManualEdit([]), [])
  assert.deepEqual(viaTaggerMerge([]), [])
  assert.deepEqual(normalizeFiberContent(undefined), [])
  assert.deepEqual(normalizeFiberContent(null), [])
  assert.deepEqual(normalizeFiberContent('not an array'), [])
})

test('out-of-vocabulary is dropped and reported, never rewritten to unknown', () => {
  const { values, invalid } = fiberContentNormalization(['bogus'])
  assert.deepEqual(values, [])
  assert.deepEqual(invalid, ['bogus'])
  assert.ok(!values.includes('unknown'), 'invalid evidence must not become valid uncertainty')

  const mixed = fiberContentNormalization(['polyester', 'bogus', 'down'])
  assert.deepEqual(mixed.values, ['down', 'polyester'])
  assert.deepEqual(mixed.invalid, ['bogus'])
})

test('unknown alongside resolved fibres is preserved as partial evidence', () => {
  // Ten real pieces carry this shape. It is the only encoding of "plus something I could not
  // identify" the field has, so normalization must not tidy it away.
  assert.deepEqual(normalizeFiberContent(['cotton', 'unknown']), ['cotton', 'unknown'])
  assert.deepEqual(normalizeFiberContent(['unknown', 'cotton']), ['cotton', 'unknown'])
  assert.deepEqual(normalizeFiberContent(['polyester', 'spandex', 'unknown']),
    ['polyester', 'spandex', 'unknown'])
})

test('output is deterministic: deduped, case-folded, canonical order', () => {
  assert.deepEqual(normalizeFiberContent(['down', 'polyester']), ['down', 'polyester'])
  assert.deepEqual(normalizeFiberContent(['polyester', 'down']), ['down', 'polyester'])
  assert.deepEqual(normalizeFiberContent(['cotton', 'cotton', 'COTTON', ' Wool ']), ['wool', 'cotton'])
  assert.deepEqual(normalizeFiberContent(['lyocell']), ['tencel'], 'synonym remaps before validation')
})

test('normalization infers nothing about completeness or warmth', () => {
  // §10 is a storage contract. Promoting ['polyester','nylon'] to "complete", or reading warmth
  // off the absence of an insulating fibre, belongs to the verdict layer (§5) — putting either
  // here would move semantics back inside the write path.
  // Canonical order is the taxonomy's, not alphabetical: the synthetic family lists
  // polyester before nylon, and the insulating family sorts ahead of it entirely.
  assert.deepEqual(normalizeFiberContent(['polyester', 'nylon']), ['polyester', 'nylon'])
  assert.deepEqual(normalizeFiberContent(['nylon', 'polyester']), ['polyester', 'nylon'])
  assert.deepEqual(normalizeFiberContent(['polyester', 'nylon', 'down']), ['down', 'polyester', 'nylon'])
})

test('completeness writer rules: photo inference may never assert complete', () => {
  // The rule the black puffer motivates. A photo cannot see a lining or a fill, so a tagger
  // claiming 'complete' is claiming something it had no way to establish. Downgraded to
  // 'unknown' — "not established" — rather than to 'partial', since proposing completeness is
  // not evidence of incompleteness either.
  assert.equal(normalizeFiberCompleteness('complete', { source: 'tagger' }), 'unknown')
  assert.equal(normalizeFiberCompleteness('partial', { source: 'tagger' }), 'partial')
  assert.equal(normalizeFiberCompleteness('unknown', { source: 'tagger' }), 'unknown')
  assert.equal(normalizeFiberCompleteness('complete', { source: 'manual' }), 'complete')
  assert.equal(normalizeFiberCompleteness('mostly', { source: 'manual' }), null)
  assert.equal(normalizeFiberCompleteness(null, { source: 'manual' }), null)
})

test('completeness is not inferred from the fibre list', () => {
  // Whatever the list contains, normalization of the list itself never produces a completeness
  // claim. The two facts are stored separately precisely so one cannot masquerade as the other.
  for (const list of [['polyester', 'nylon'], ['polyester', 'nylon', 'down'], ['cotton', 'unknown'], []]) {
    const { values } = fiberContentNormalization(list)
    assert.ok(!('completeness' in Object(values)), 'the list normalizer yields fibres only')
  }
})

test('the four completeness fixtures, at the layer this repo can decide deterministically', () => {
  // These mirror the four cases the review asked for. What is testable here is the DISPOSITION of
  // whatever the tagger emits — the contract between the model and the store. Whether the model
  // actually returns 'partial' for a quilted coat and 'unknown' for a plain tee is model
  // behaviour, and confirming it needs one real (billed) tagging run against those photos; it is
  // not asserted here and must not be assumed from these passing.
  const fromTagger = v => normalizeFiberCompleteness(v, { source: 'tagger' })

  // 1. quilted puffer, shell visible, fill identity unavailable → partial
  assert.equal(fromTagger('partial'), 'partial')
  // 2. plain cotton tee → unknown, NOT complete
  assert.equal(fromTagger('unknown'), 'unknown')
  // 3. two visible materials both identified, hidden construction not established → unknown.
  //    The tagger cannot reach 'complete' by any route, so even if it tried, the store refuses.
  assert.equal(fromTagger('complete'), 'unknown')
  // 4. care-label / manual path → may assert complete
  assert.equal(normalizeFiberCompleteness('complete', { source: 'manual' }), 'complete')
})

test('the tagger prompt states the narrow partial contract and forbids complete', () => {
  // Guards the wording against dilution: "when unsure" or "assume for coats" would collapse
  // partial back into unknown, which is the distinction §11 exists to protect.
  const schema = TAG_PIECE_PROMPT.split('\n').find(l => l.trim().startsWith('"fiber_content_completeness"'))
  assert.ok(schema, 'the tagger schema must ask for the field')
  assert.match(schema, /partial\|unknown/)
  assert.match(schema, /Never emit 'complete'/)
  assert.match(schema, /positive evidence/)
  assert.match(schema, /Do not use 'partial' merely because you are unsure/)
  assert.match(schema, /do not assume it by category/)
  assert.ok(!/\bcomplete\|/.test(schema), "'complete' must not appear as a permitted enum value")
})
