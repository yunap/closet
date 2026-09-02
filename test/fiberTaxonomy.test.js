// Spec: docs/fiber-evidence-completeness-spec.md §10 — one normalizer, both write paths as
// adapters. The cases below are the ones that behaved differently depending on which path wrote
// the row, or that collapsed two distinct states into one.
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert'
import { fiberContentNormalization, normalizeFiberContent, normalizeFiberCompleteness, FIBER_COMPLETENESS_SCHEMA_DESCRIPTION, FIBER_FAMILIES, FIBER_FAMILY_APPLICABILITY, fiberFamiliesForPiece, normalizeInsulatingLayerMaterials } from '../styling-engine/fiberTaxonomy.js'
import { applyTaggerResult } from '../styling-engine/taggerMerge.js'
import { thermalMaterialVerdict, compositionEvidenceState, pieceHasInsulatingMaterial, FIELD_CONSEQUENCE, pieceFiberBreathability } from '../styling-engine/attributes.js'
import { warmthCalibrationEvidenceState, proposedWarmthLevel } from '../styling-engine/warmthCalibration.js'
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
  // insulating_layer_materials: [] means "verified: no insulating layer". Since 2026-09-02 the
  // negative branch needs BOTH that and a complete face composition — see
  // material-role-representation-spec.md. These cases assert the layer is ruled out so they keep
  // testing the fibre logic rather than the new gate.
  const v = (fiber_content, fiber_content_completeness) =>
    thermalMaterialVerdict({ fiber_content, fiber_content_completeness, insulating_layer_materials: [] })

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
  const completeCotton = { fiber_content: ['cotton'], fiber_content_completeness: 'complete', insulating_layer_materials: [] }
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

test('994060: the real-wardrobe fixture for the asymmetry, pinned permanently', () => {
  // A wool scarf recorded as ["wool","unknown"] — an actual row in the owner's wardrobe, kept here
  // deliberately rather than as a synthetic case. It is the semantic heart of the verdict layer:
  // a PARTIAL record still yields a decisive positive, while the inverse never yields a decisive
  // negative. If a future change makes this return 'unknown', the asymmetry has been lost.
  const scarf = { fiber_content: ['wool', 'unknown'], fiber_content_completeness: 'partial' }
  assert.equal(compositionEvidenceState(scarf), 'partial')
  assert.equal(thermalMaterialVerdict(scarf), 'insulating')

  // The inverse, same completeness, no insulating material: never decisive.
  const hoodie = { fiber_content: ['polyester', 'spandex', 'unknown'], fiber_content_completeness: 'partial' }
  assert.equal(compositionEvidenceState(hoodie), 'partial')
  assert.equal(thermalMaterialVerdict(hoodie), 'unknown')
})

test('warmth calibration: unverified is not the same as uncharacterized', () => {
  // The first attempt at this promoted the distinction to a general garment fact called
  // fabricAdmitsHiddenMaterial() — "can this fabric hide another material?" That claimed physics
  // the data does not establish: denim can be quilted, leather jackets can be padded, knit
  // outerwear can be lined. What the measurement supports is narrower and lives in
  // warmthCalibration.js as a policy about OUR evidence, not about garments.
  const state = warmthCalibrationEvidenceState

  // Substantial, composition never established, face-fabric-only category → cannot be scored.
  assert.equal(state({ fabric_weight: 'heavy', fabric_category: 'synthetic', fiber_content: ['polyester', 'nylon'] }), 'thermally_ambiguous')
  assert.equal(proposedWarmthLevel({ fabric_weight: 'heavy', fabric_category: 'synthetic', fiber_content: ['polyester', 'nylon'] }), null)

  // The same garment once the care label is recorded. Positive evidence ends the ambiguity.
  assert.equal(state({ fabric_weight: 'heavy', fabric_category: 'synthetic', fiber_content: ['polyester', 'nylon', 'down'] }), 'scoreable')
  assert.equal(proposedWarmthLevel({ fabric_weight: 'heavy', fabric_category: 'synthetic', fiber_content: ['polyester', 'nylon', 'down'] }), 'very warm')

  // Unverified completeness alone must NOT make a garment unscoreable — the 52% explosion.
  assert.equal(state({ fabric_weight: 'medium', fabric_category: 'cotton', fiber_content: ['cotton'] }), 'scoreable')
  assert.equal(state({ fabric_weight: 'medium', fabric_category: 'knit', fiber_content: ['unknown'] }), 'scoreable')

  // Light garments are exempt: what is unstated cannot move them far enough up the scale.
  assert.equal(state({ fabric_weight: 'light', fabric_category: 'synthetic', fiber_content: ['polyester'] }), 'scoreable')

  // Without the starting fact there is nothing to calibrate from.
  assert.equal(state({ fabric_category: 'knit', fiber_content: ['wool'] }), 'insufficient_evidence')
  assert.equal(proposedWarmthLevel({ fabric_category: 'knit', fiber_content: ['wool'] }), null)
})

test('both intake surfaces project fibre chips from one canonical function', () => {
  // §7.5 + the presentation-parity follow-up. The screenshot that started this showed a coat being
  // offered pearl, enamel, horn and ceramic in a flat wall of 35 chips with `down` unmarked in the
  // middle. Grouping AND the per-category filter are now one function both forms call.
  const count = piece => fiberFamiliesForPiece(piece).reduce((n, [, v]) => n + v.length, 0)

  const coat = fiberFamiliesForPiece({ category: 'outerwear' })
  const shown = coat.flatMap(([, values]) => values)
  assert.equal(shown.length, 24, 'a coat sees 24 chips, not all 35')
  for (const jewelleryOnly of FIBER_FAMILIES.jewelry_material) {
    assert.ok(!shown.includes(jewelleryOnly), `${jewelleryOnly} must not be offered on a coat`)
  }
  assert.ok(shown.includes('down'), 'and down must still be there — under a labelled warm family')
  assert.deepEqual(coat.find(([f]) => f === 'insulating')[1], FIBER_FAMILIES.insulating)

  // `accessory` is a catch-all, so category alone is too coarse: offering pearl/enamel on a scarf
  // is the same defect as offering them on a coat. Real usage backs this — jewellery-family values
  // appear on the wardrobe's 8 jewelry pieces and on none of its belts, bags, glasses or scarves.
  assert.equal(count({ category: 'accessory', accessory_subtype: 'jewelry' }), 35)
  assert.equal(count({ category: 'accessory', accessory_subtype: 'scarf' }), 29)
  assert.equal(count({ category: 'accessory', accessory_subtype: 'belt' }), 29)
  const scarfHardware = fiberFamiliesForPiece({ category: 'accessory', accessory_subtype: 'scarf' })
    .find(([f]) => f === 'jewelry_material')[1]
  assert.deepEqual(scarfHardware, ['metal', 'wood', 'horn', 'shell', 'resin'],
    'buckles and hardware stay available; jewellery accents do not')

  for (const file of ['src/components/PieceForm.jsx', 'src/components/BatchAdd.jsx']) {
    const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
    assert.match(source, /fiberFamiliesForPiece\(form\)/, `${file} must use the canonical projection`)
    assert.match(source, /FIBER_FAMILY_LABELS/, `${file} must not invent its own family headings`)
    assert.ok(!/const FIBER_OPTIONS\s*=/.test(source), `${file} must keep no local fibre list`)
  }
})

test('the editor warning claims ambiguity, never that a garment is non-insulating', () => {
  // The app has established no such thing for these pieces — saying it would contradict the
  // verdict layer. The warning is driven by the shared calibration state, not a local heuristic.
  const source = fs.readFileSync(path.join(process.cwd(), 'src/components/PieceForm.jsx'), 'utf8')
  assert.match(source, /warmthCalibrationEvidenceState\(form\) === 'thermally_ambiguous'/)
  assert.ok(!/fabric_weight === 'heavy'\s*&&/.test(source),
    'the editor must not re-derive thermal ambiguity from weight/fabric locally')
  const warning = source.slice(source.indexOf('data-piece-field="fiber_content_ambiguous"'))
    .slice(0, source.slice(source.indexOf('data-piece-field="fiber_content_ambiguous"')).indexOf('</div>'))
  assert.match(warning, /don’t say how warm this is/)
  assert.ok(!/lined/i.test(warning),
    'a lining does not imply a fill — a lined wool coat gets its warmth from the shell')
  assert.ok(!/not insulating|non-insulating/i.test(warning),
    'the rendered copy must not claim a thermal verdict the app has not established')

  // Consequence copy comes from the canonical registry, and `gate` is not user-facing meaning.
  assert.match(source, /FIELD_CONSEQUENCE\[field\]/)
  assert.equal(FIELD_CONSEQUENCE.fiber_content, 'Affects warmth and weather suitability')
})

test('both intake forms carry the tagger completeness answer through to the save', () => {
  // Regression guard for a real miss. The producer census (§14) enumerated who WRITES the fact and
  // proved every producer obeys the contract — but not that the client path carries it. A live tag
  // of a visibly quilted puffer (996866) stored 'unknown', which looked exactly like the model
  // declining to answer; the tag response was in fact being discarded by the intake forms.
  // Indistinguishable from the outside, which is what made it worth a test rather than a fix.
  const pieceForm = fs.readFileSync(path.join(process.cwd(), 'src/components/PieceForm.jsx'), 'utf8')
  const batchAdd = fs.readFileSync(path.join(process.cwd(), 'src/components/BatchAdd.jsx'), 'utf8')

  assert.match(pieceForm, /applyTagValue\(next, 'fiber_content_completeness', tags\.fiber_content_completeness\)/)
  assert.match(batchAdd, /fiber_content_completeness: tags\.fiber_content_completeness \|\| 'unknown'/)
  // Both submit by iterating the form object, so presence in the blank form is what makes it send.
  assert.match(batchAdd, /fiber_content_completeness: 'unknown'/)
  assert.match(pieceForm, /fiber_content_completeness: piece\?\.fiber_content_completeness \|\| 'unknown'/)

  // Every field the tagger is asked for should reach the form. fiber_content already did; this is
  // the one that did not.
  for (const field of ['fiber_content', 'fiber_content_completeness']) {
    assert.match(pieceForm, new RegExp(`applyTagValue\\(next, '${field}'`))
  }
})

test('an insulating LAYER settles the verdict whatever its fibres are', () => {
  // 996765, the brown leather coat: lined and filled with 100% polyester. Its composition was
  // already fully recorded — nothing was missing — but polyester is not in INSULATING_FIBERS, so
  // marking it complete produced a confident non_insulating about an insulated coat. The engine
  // never claims polyester is intrinsically warm; it reads that polyester OCCUPIES the
  // insulating-layer role. See material-role-representation-spec.md.
  const coat = { fiber_content: ['polyester', 'nylon', 'leather'], fabric_category: 'leather' }
  assert.equal(thermalMaterialVerdict(coat), 'unknown', 'layer unrecorded')
  assert.equal(thermalMaterialVerdict({ ...coat, fiber_content_completeness: 'complete' }), 'unknown',
    'complete composition alone must NOT produce a negative — this was the false negative')
  assert.equal(thermalMaterialVerdict({ ...coat, insulating_layer_materials: ['polyester'] }), 'insulating')

  // ['unknown'] is a POSITIVE claim: a layer is there, its material unidentified. A quilted coat is
  // insulated whether or not we know what is inside it.
  assert.equal(thermalMaterialVerdict({ fiber_content: ['polyester', 'nylon'], insulating_layer_materials: ['unknown'] }), 'insulating')
})

test('the negative branch needs the layer explicitly ruled out, not merely absent', () => {
  const tee = { fiber_content: ['cotton'], fiber_content_completeness: 'complete' }
  assert.equal(thermalMaterialVerdict(tee), 'unknown', 'absent is not empty')
  assert.equal(thermalMaterialVerdict({ ...tee, insulating_layer_materials: [] }), 'non_insulating')
  // Incomplete face composition still blocks a negative even with the layer ruled out.
  assert.equal(thermalMaterialVerdict({ fiber_content: ['cotton'], insulating_layer_materials: [] }), 'unknown')
})

test('a photograph may assert an insulating layer exists, never that one is absent', () => {
  const n = normalizeInsulatingLayerMaterials
  assert.equal(n(undefined, { source: 'tagger' }), null)
  assert.deepEqual(n([], { source: 'tagger' }), null, 'a tagger asserting [] is downgraded to unrecorded')
  assert.deepEqual(n([], { source: 'manual' }), [], 'only a person can rule the layer out')
  assert.deepEqual(n(['unknown'], { source: 'tagger' }), ['unknown'])
  assert.deepEqual(n(['Wool', ' shearling'], { source: 'tagger' }), ['wool'], 'unknown vocab dropped, wool kept')
  assert.deepEqual(n(['bogus'], { source: 'tagger' }), ['unknown'],
    'a positive observation must not collapse to nothing because its material was misspelled')
})

test('fiber_content keeps its own job — breathability is untouched by the new field', () => {
  // The reason this is a separate field rather than {fiber, role} entries inside fiber_content:
  // pieceFiberBreathability reads that array as FACE-material evidence, and 14 outerwear pieces
  // have breathable shell fibres a fill entry would have diluted.
  const coat = { fiber_content: ['cotton'], insulating_layer_materials: ['down'] }
  assert.equal(pieceFiberBreathability(coat), pieceFiberBreathability({ fiber_content: ['cotton'] }),
    'recording a down fill must not change what the face fabric does against skin')
})
