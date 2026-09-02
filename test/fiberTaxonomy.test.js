// Spec: docs/fiber-evidence-completeness-spec.md §10 — one normalizer, both write paths as
// adapters. The cases below are the ones that behaved differently depending on which path wrote
// the row, or that collapsed two distinct states into one.
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert'
import { fiberContentNormalization, normalizeFiberContent, normalizeFiberCompleteness, FIBER_COMPLETENESS_SCHEMA_DESCRIPTION } from '../styling-engine/fiberTaxonomy.js'
import { applyTaggerResult } from '../styling-engine/taggerMerge.js'
import { thermalMaterialVerdict, compositionEvidenceState, pieceHasInsulatingMaterial } from '../styling-engine/attributes.js'
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

test('every photo-derived producer of fiber_content obeys the completeness writer contract', () => {
  // Architectural acceptance test. `/extract-pieces` was a loophole for exactly one reason: it
  // produces fiber_content and nobody had asked whether it was a writer. This enumerates the
  // producers and pins each one's disposition, so the next path of that shape has to declare
  // itself rather than being found later.
  //
  // The rule: a producer either emits completeness under the canonical writer contract, or is
  // documented as incapable of asserting it with the downstream state defaulting to 'unknown'.
  const read = f => fs.readFileSync(path.join(process.cwd(), f), 'utf8')
  const ai = read('routes/ai.js')
  const crud = read('routes/crud.js')
  const prompts = read('styling-engine/prompts.js')

  // 1. The tagger (tagPieceWithProvider). Asks for the field, and normalizes at source 'tagger'.
  assert.match(prompts, /"fiber_content_completeness": "\$\{FIBER_COMPLETENESS_SCHEMA_DESCRIPTION\}"/)
  assert.match(ai, /tags\.fiber_content_completeness\s*=\s*\n?\s*normalizeFiberCompleteness\(tags\.fiber_content_completeness, \{ source: 'tagger' \}\)/)

  // 2. /extract-pieces. Same schema projection, same source, applied to every returned piece.
  assert.equal((ai.match(/"fiber_content_completeness": "\$\{FIBER_COMPLETENESS_SCHEMA_DESCRIPTION\}"/g) || []).length, 1)
  assert.match(ai, /function applyFiberWriterContract/)
  assert.match(ai, /res\.json\(applyFiberWriterContract\(parseModelJson\(raw\)\)\)/)

  // 3. Manual edit (both crud write paths), the only writer permitted to assert 'complete'.
  assert.equal((crud.match(/normalizeFiberCompleteness\(fiber_content_completeness, \{ source: 'manual' \}\)/g) || []).length, 2)

  // Neither photo-derived schema may offer 'complete' as a value the model can pick.
  assert.ok(!FIBER_COMPLETENESS_SCHEMA_DESCRIPTION.includes('complete|'))
  assert.ok(!FIBER_COMPLETENESS_SCHEMA_DESCRIPTION.includes('|complete'))

  // The description has ONE source. A second inline copy is the §7.1 failure repeating itself.
  for (const [name, text] of Object.entries({ 'routes/ai.js': ai, 'styling-engine/prompts.js': prompts })) {
    assert.ok(!text.includes('whether the fiber_content list above describes the WHOLE garment'),
      `${name} restates the completeness contract instead of projecting FIBER_COMPLETENESS_SCHEMA_DESCRIPTION`)
  }

  // Documented as NOT producers, so their absence above is a decision rather than an oversight:
  //   styling-engine/mockAiHandler.js — a provider-level mock. Its canned fiber_content is
  //     returned THROUGH tagPieceWithProvider, so it lands on the tagger's boundary normalization
  //     like any real provider response and cannot bypass the contract.
  //   src/components/{PieceForm,BatchAdd}.jsx — clients. They post to crud, which is writer 3.
  //   routes/importer.js — calls tagPieceWithProvider, inheriting writer 1.
  assert.match(read('routes/importer.js'), /tagPieceWithProvider/)
})

test('thermalMaterialVerdict: positive evidence is decisive, negative evidence is not', () => {
  // The asymmetry, pinned. Positive insulating evidence settles the question even from a partial
  // record. A negative reading only settles it when the composition is known complete — the black
  // puffer's ["polyester","nylon"] was TRUE about its shell and lining, and concluding "not
  // insulated" from it is the error this chain exists to prevent.
  const v = (fiber_content, fiber_content_completeness) =>
    thermalMaterialVerdict({ fiber_content, fiber_content_completeness })

  assert.equal(v(['down'], 'partial'), 'insulating')
  assert.equal(v(['wool'], 'unknown'), 'insulating')
  assert.equal(v(['cotton'], 'complete'), 'non_insulating')
  assert.equal(v(['polyester', 'nylon'], 'complete'), 'non_insulating')
  assert.equal(v(['polyester', 'nylon'], 'unknown'), 'unknown')
  assert.equal(v(['polyester', 'nylon'], 'partial'), 'unknown')
  assert.equal(v([], 'unknown'), 'unknown')
  assert.equal(v(['unknown'], 'unknown'), 'unknown')

  // The puffer, before and after its care label was read. Same garment, same fibres once the fill
  // is recorded — the difference is entirely in what was established.
  assert.equal(v(['polyester', 'nylon'], 'unknown'), 'unknown')
  assert.equal(v(['polyester', 'nylon', 'down'], 'unknown'), 'insulating')
})

test('positive evidence includes fabric_category, which completeness never overrides', () => {
  // completeness describes the FIBRE record only. A cardigan tagged fiber_content ["unknown"] with
  // fabric_category 'fleece' is insulating and always was; gating that on a fibre-record fact
  // would be a silent regression at every existing caller.
  assert.equal(thermalMaterialVerdict({ fiber_content: ['unknown'], fabric_category: 'fleece' }), 'insulating')
  assert.equal(thermalMaterialVerdict({ fiber_content: ['cotton'], fabric_category: 'shearling', fiber_content_completeness: 'complete' }), 'insulating')
})

test('the two verdicts answer different questions and neither leaks into the other', () => {
  // "complete cotton" and "partial list containing down" are the pair that makes one combined
  // verdict impossible: they disagree on composition and on warmth, in opposite directions.
  const completeCotton = { fiber_content: ['cotton'], fiber_content_completeness: 'complete' }
  const partialDown = { fiber_content: ['polyester', 'down'], fiber_content_completeness: 'partial' }

  assert.equal(compositionEvidenceState(completeCotton), 'complete')
  assert.equal(thermalMaterialVerdict(completeCotton), 'non_insulating')
  assert.equal(compositionEvidenceState(partialDown), 'partial')
  assert.equal(thermalMaterialVerdict(partialDown), 'insulating')

  // compositionEvidenceState reads the stored fact and never re-derives it from the list.
  assert.equal(compositionEvidenceState({ fiber_content: ['cotton', 'unknown'] }), 'unknown',
    'an unanswered row is unknown, whatever its fibre list looks like')
  assert.equal(compositionEvidenceState({ fiber_content_completeness: 'nonsense' }), 'unknown')
})

test('pieceHasInsulatingMaterial stays exactly verdict === insulating while callers migrate', () => {
  // It has always meant "is there positive insulating evidence?". If it started returning false
  // for 'unknown' in some new sense, six production callers would change behaviour silently.
  for (const piece of [
    { fiber_content: ['down'], fiber_content_completeness: 'partial' },
    { fiber_content: ['cotton'], fiber_content_completeness: 'complete' },
    { fiber_content: ['polyester'], fiber_content_completeness: 'unknown' },
    { fiber_content: ['unknown'], fabric_category: 'fleece' },
    { fiber_content: [] },
  ]) {
    assert.equal(pieceHasInsulatingMaterial(piece), thermalMaterialVerdict(piece) === 'insulating')
  }
})

test('no caller infers thermal-material truth directly from fiber_content', () => {
  // One semantic question, one owner. INSULATING_FIBERS may only be consulted where the verdict
  // is defined; anywhere else is a second thermal authority forming.
  const OWNERS = ['styling-engine/attributes.js', 'styling-engine/fiberTaxonomy.js']
  const roots = ['styling-engine', 'routes', 'lib', 'src']
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'dist' ? [] : walk(full)
    return /\.(js|jsx)$/.test(e.name) ? [full] : []
  })
  for (const root of roots) {
    for (const file of walk(path.join(process.cwd(), root))) {
      const rel = path.relative(process.cwd(), file)
      if (OWNERS.includes(rel)) continue
      const text = fs.readFileSync(file, 'utf8')
      assert.ok(!/INSULATING_FIBERS\s*\.\s*has/.test(text),
        `${rel} tests INSULATING_FIBERS directly — use thermalMaterialVerdict() instead`)
    }
  }
})
