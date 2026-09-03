// Spec: docs/fiber-evidence-completeness-spec.md §10 — one normalizer, both write paths as
// adapters. The cases below are the ones that behaved differently depending on which path wrote
// the row, or that collapsed two distinct states into one.
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert'
import { fiberContentNormalization, normalizeFiberContent, FIBER_FAMILIES, FIBER_FAMILY_APPLICABILITY, fiberFamiliesForPiece, normalizeInsulatingLayerMaterials, normalizeInteriorConstruction, interiorConstruction, INTERIOR_CONSTRUCTION_SCHEMA_DESCRIPTION, INTERIOR_CONSTRUCTION_OPTIONS } from '../styling-engine/fiberTaxonomy.js'
import { applyTaggerResult } from '../styling-engine/taggerMerge.js'
import { thermalMaterialVerdict, pieceHasInsulatingMaterial, FIELD_CONSEQUENCE, pieceFiberBreathability } from '../styling-engine/attributes.js'
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

test('normalization infers nothing about construction or warmth', () => {
  // §10 is a storage contract. Promoting ['polyester','nylon'] to "complete", or reading warmth
  // off the absence of an insulating fibre, belongs to the verdict layer (§5) — putting either
  // here would move semantics back inside the write path.
  // Canonical order is the taxonomy's, not alphabetical: the synthetic family lists
  // polyester before nylon, and the insulating family sorts ahead of it entirely.
  assert.deepEqual(normalizeFiberContent(['polyester', 'nylon']), ['polyester', 'nylon'])
  assert.deepEqual(normalizeFiberContent(['nylon', 'polyester']), ['polyester', 'nylon'])
  assert.deepEqual(normalizeFiberContent(['polyester', 'nylon', 'down']), ['down', 'polyester', 'nylon'])
})

test('interior construction is never inferred from the fibre list', () => {
  // The list normalizer yields fibres and nothing else. Construction is a separate stored fact
  // precisely so one cannot masquerade as the other — the failure that put ['unknown'] in the
  // insulating-layer field of a reversible jacket.
  for (const list of [['polyester', 'nylon'], ['cotton', 'unknown'], []]) {
    const { values } = fiberContentNormalization(list)
    assert.ok(!('interior_construction' in Object(values)), 'the list normalizer yields fibres only')
  }
})

test('interiorConstruction collapses missing, null and invalid to unknown', () => {
  // ONE canonical state model, deliberately unlike insulating_layer_materials' null-vs-[] split:
  // there, [] is a strong human assertion of absence. Here "no lining" and "nobody has said"
  // differ only in provenance, which the writer rules carry.
  assert.equal(interiorConstruction({}), 'unknown')
  assert.equal(interiorConstruction({ interior_construction: null }), 'unknown')
  assert.equal(interiorConstruction({ interior_construction: 'batting' }), 'unknown')
  assert.equal(interiorConstruction({ interior_construction: 'FULL_LINING' }), 'full_lining')
  for (const v of ['unlined', 'partial_lining', 'full_lining', 'full_second_face']) {
    assert.equal(interiorConstruction({ interior_construction: v }), v)
  }
})

test('a photo may establish a lining exists, never that one is absent', () => {
  // The same asymmetry insulating_layer_materials already enforces, for the same physical reason.
  // Absence of a visible lining is evidence of an exterior photograph, not of an unlined garment.
  const fromTagger = v => normalizeInteriorConstruction(v, { source: 'tagger' })
  assert.equal(fromTagger('full_lining'), 'full_lining')
  assert.equal(fromTagger('partial_lining'), 'partial_lining')
  assert.equal(fromTagger('full_second_face'), 'full_second_face')
  assert.equal(fromTagger('unlined'), 'unknown', 'a tagger-asserted unlined is DOWNGRADED, not rejected')
  assert.equal(fromTagger('nonsense'), null)
  assert.equal(normalizeInteriorConstruction('unlined', { source: 'manual' }), 'unlined')
})

test('the tagger schema forbids unlined and separates construction from insulation', () => {
  const schema = TAG_PIECE_PROMPT.split('\n').find(l => l.trim().startsWith('"interior_construction"'))
  assert.ok(schema, 'the tagger schema must ask for the field')
  assert.match(schema, /NEVER emit 'unlined'/)
  assert.match(schema, /positive visual evidence/)
  assert.ok(!/unlined\|/.test(schema), "'unlined' must not appear as a permitted enum value")
  assert.match(schema, /insulating_layer_materials/)
  assert.match(schema, /NON-INSULATING/)
})

test('every photo-derived producer obeys the interior-construction writer contract', () => {
  // Architectural acceptance test, inherited from the completeness census: a producer either emits
  // the field under the canonical writer contract, or is documented as incapable of asserting it.
  const read = f => fs.readFileSync(path.join(process.cwd(), f), 'utf8')
  const ai = read('routes/ai.js')
  const crud = read('routes/crud.js')
  const prompts = read('styling-engine/prompts.js')

  assert.match(prompts, /"interior_construction": "\$\{INTERIOR_CONSTRUCTION_SCHEMA_DESCRIPTION\}"/)
  assert.match(ai, /tags\.interior_construction\s*=\s*\n?\s*normalizeInteriorConstruction\(tags\.interior_construction, \{ source: 'tagger' \}\)/)
  assert.equal((ai.match(/"interior_construction": "\$\{INTERIOR_CONSTRUCTION_SCHEMA_DESCRIPTION\}"/g) || []).length, 1)
  assert.match(ai, /function applyFiberWriterContract/)
  assert.equal((crud.match(/normalizeInteriorConstruction\(interior_construction, \{ source: 'manual' \}\)/g) || []).length, 2)

  for (const [name, text] of Object.entries({ 'routes/ai.js': ai, 'styling-engine/prompts.js': prompts })) {
    assert.ok(!text.includes('ordinary, NON-INSULATING interior construction, which is a different question'),
      `${name} restates the construction contract instead of projecting the canonical description`)
  }
  assert.ok(!INTERIOR_CONSTRUCTION_SCHEMA_DESCRIPTION.includes('unlined|'))
})

test('fiber_content_completeness is gone from every production surface', () => {
  // The retirement, asserted rather than assumed. Measured before removal: 'complete' was set on
  // ZERO of 268 active pieces, so the branch it gated had never executed, and 'partial' had no
  // semantic readers. See docs/interior-construction-spec.md §5.
  const read = f => fs.readFileSync(path.join(process.cwd(), f), 'utf8')
  for (const f of ['routes/ai.js', 'routes/crud.js', 'styling-engine/prompts.js',
                   'styling-engine/attributes.js', 'styling-engine/taggerMerge.js',
                   'src/components/PieceForm.jsx', 'src/components/BatchAdd.jsx']) {
    const live = read(f).split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    assert.ok(!live.some(l => l.includes('fiber_content_completeness')),
      `${f} still reads or writes the retired completeness field`)
  }
  const taxonomyLive = read('styling-engine/fiberTaxonomy.js').split('\n').filter(l => !l.trim().startsWith('//'))
  assert.ok(!taxonomyLive.some(l => l.includes('partialComposition')),
    'partial must not be re-derived as a combined abstraction (the tombstone comment naming it is fine)')
})

test('thermalMaterialVerdict: positive evidence is decisive, and the layer alone rules it out', () => {
  // The asymmetry is the point. POSITIVE evidence settles the verdict from any record — a list
  // containing 'down' establishes insulation whether or not anything else is missing. NEGATIVE
  // evidence needs insulating_layer_materials: [], which is a human-only write.
  //
  // ACTIVATION, 2026-09-02: the negative branch used to ALSO require
  // fiber_content_completeness === 'complete'. That field was retired after measurement showed
  // 'complete' had never been set on a single piece, so this branch had never once executed.
  // These assertions are the first time non_insulating is reachable at all.
  const v = fiber_content => thermalMaterialVerdict({ fiber_content, insulating_layer_materials: [] })

  assert.equal(v(['down']), 'insulating')
  assert.equal(v(['wool']), 'insulating')
  assert.equal(v(['cotton']), 'non_insulating')
  assert.equal(v(['polyester', 'nylon']), 'non_insulating')
  assert.equal(v([]), 'non_insulating', 'the owner ruled the layer out and no warm fibre is recorded')
  assert.equal(v(['unknown']), 'non_insulating')

  // Without the layer answer, nothing is decided either way. Absent is not empty.
  assert.equal(thermalMaterialVerdict({ fiber_content: ['polyester', 'nylon'] }), 'unknown')
  assert.equal(thermalMaterialVerdict({ fiber_content: ['cotton'] }), 'unknown')

  // The puffer, before and after its fill was recorded. Same shell fibres; the difference is
  // entirely in what the layer field says.
  assert.equal(thermalMaterialVerdict({ fiber_content: ['polyester', 'nylon'] }), 'unknown')
  assert.equal(thermalMaterialVerdict({ fiber_content: ['polyester', 'nylon'], insulating_layer_materials: ['down'] }), 'insulating')
})

test('construction never reaches the verdict, in either direction', () => {
  // The spec's central separation (§6). An ordinary lining or a reversible second face is real
  // thermal mass and belongs in the SCORE; it must never make a garment read as insulated, and
  // equally must never gate the negative branch. 996764 is why: a reversible jacket recorded as
  // ['unknown'] insulation read `insulating` and scored like a winter coat.
  for (const c of ['unknown', 'unlined', 'partial_lining', 'full_lining', 'full_second_face']) {
    assert.equal(
      thermalMaterialVerdict({ fiber_content: ['cotton'], insulating_layer_materials: [], interior_construction: c }),
      'non_insulating',
      `construction ${c} must not change a settled negative verdict`)
    assert.equal(
      thermalMaterialVerdict({ fiber_content: ['wool'], insulating_layer_materials: [], interior_construction: c }),
      'insulating',
      `construction ${c} must not change a settled positive verdict`)
    assert.equal(
      thermalMaterialVerdict({ fiber_content: ['cotton'], interior_construction: c }),
      'unknown',
      `construction ${c} must not manufacture a verdict where the layer is unanswered`)
  }
})

test('positive evidence includes fabric_category, which nothing else overrides', () => {
  // completeness describes the FIBRE record only. A cardigan tagged fiber_content ["unknown"] with
  // fabric_category 'fleece' is insulating and always was; gating that on a fibre-record fact
  // would be a silent regression at every existing caller.
  assert.equal(thermalMaterialVerdict({ fiber_content: ['unknown'], fabric_category: 'fleece' }), 'insulating')
  assert.equal(thermalMaterialVerdict({ fiber_content: ['cotton'], fabric_category: 'shearling', insulating_layer_materials: [] }), 'insulating',
    'an explicitly ruled-out FILL never overrides a warm FACE fabric — 250 and 996762 in the real wardrobe')
})

test('the two material facts answer different questions and neither leaks into the other', () => {
  // fiber_content describes the FACE fabric; insulating_layer_materials describes a thermally
  // functional layer. The pair that makes one combined field impossible: a cotton garment with the
  // fill ruled out, and a polyester one whose fill is down. They disagree in opposite directions.
  const cottonNoFill = { fiber_content: ['cotton'], insulating_layer_materials: [] }
  const polyesterDownFill = { fiber_content: ['polyester'], insulating_layer_materials: ['down'] }

  assert.equal(thermalMaterialVerdict(cottonNoFill), 'non_insulating')
  assert.equal(thermalMaterialVerdict(polyesterDownFill), 'insulating')

  // 996765: lined AND filled. Both facts survive; neither is thrown away to record the other.
  const linedAndFilled = {
    fiber_content: ['leather'], fabric_category: 'leather',
    interior_construction: 'full_lining', insulating_layer_materials: ['down'],
  }
  assert.equal(interiorConstruction(linedAndFilled), 'full_lining')
  assert.deepEqual(linedAndFilled.insulating_layer_materials, ['down'])
  assert.equal(thermalMaterialVerdict(linedAndFilled), 'insulating')
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
  const scarf = { fiber_content: ['wool', 'unknown'] }
  assert.equal(thermalMaterialVerdict(scarf), 'insulating',
    'a partial record still yields a decisive POSITIVE — wool is in the list')

  // The inverse, no insulating material and no ruled-out layer: never decisive.
  const hoodie = { fiber_content: ['polyester', 'spandex', 'unknown'] }
  assert.equal(thermalMaterialVerdict(hoodie), 'unknown',
    'no insulating fibre and no ruled-out layer stays unknown, never a confident negative')
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
  // offered pearl, enamel, horn and ceramic in a flat wall of 36 chips with `down` unmarked in the
  // middle. Grouping AND the per-category filter are now one function both forms call.
  const count = piece => fiberFamiliesForPiece(piece).reduce((n, [, v]) => n + v.length, 0)

  const coat = fiberFamiliesForPiece({ category: 'outerwear' })
  const shown = coat.flatMap(([, values]) => values)
  assert.equal(shown.length, 25, 'a coat sees 25 chips, not all 36')
  for (const jewelleryOnly of FIBER_FAMILIES.jewelry_material) {
    assert.ok(!shown.includes(jewelleryOnly), `${jewelleryOnly} must not be offered on a coat`)
  }
  assert.ok(shown.includes('down'), 'and down must still be there — under a labelled warm family')
  assert.deepEqual(coat.find(([f]) => f === 'insulating')[1], FIBER_FAMILIES.insulating)

  // `accessory` is a catch-all, so category alone is too coarse: offering pearl/enamel on a scarf
  // is the same defect as offering them on a coat. Real usage backs this — jewellery-family values
  // appear on the wardrobe's 8 jewelry pieces and on none of its belts, bags, glasses or scarves.
  assert.equal(count({ category: 'accessory', accessory_subtype: 'jewelry' }), 36)
  assert.equal(count({ category: 'accessory', accessory_subtype: 'scarf' }), 30)
  assert.equal(count({ category: 'accessory', accessory_subtype: 'belt' }), 30)
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

test('both intake forms carry the tagger construction answer through to the save', () => {
  // Regression guard inherited from a real miss on the field this replaces. The producer census
  // proves every producer WRITES the fact; it does not prove the client path carries it. A live
  // tag of a visibly quilted puffer once stored 'unknown' because the intake forms discarded the
  // tag response — indistinguishable from the outside from the model declining to answer.
  const pieceForm = fs.readFileSync(path.join(process.cwd(), 'src/components/PieceForm.jsx'), 'utf8')
  const batchAdd = fs.readFileSync(path.join(process.cwd(), 'src/components/BatchAdd.jsx'), 'utf8')

  assert.match(pieceForm, /applyTagValue\(next, 'interior_construction', tags\.interior_construction\)/)
  assert.match(batchAdd, /interior_construction: tags\.interior_construction \|\| 'unknown'/)
  // Both submit by iterating the form object, so presence in the blank form is what makes it send.
  assert.match(batchAdd, /interior_construction: 'unknown'/)
  assert.match(pieceForm, /interior_construction: piece\?\.interior_construction \|\| 'unknown'/)

  for (const field of ['fiber_content', 'interior_construction']) {
    assert.match(pieceForm, new RegExp(`applyTagValue\\(next, '${field}'`))
  }

  // The owner-facing control never exposes the stored vocabulary or manufacturing terminology.
  const control = pieceForm.slice(pieceForm.indexOf('data-piece-field="interior_construction"')).slice(0, 900)
  assert.match(control, /What is the inside construction\?/)
  // The editor PROJECTS the canonical options — it does not keep its own labelled list. See
  // test/interiorConstruction.test.js for the single-ownership ratchet this pairs with.
  assert.match(control, /options=\{INTERIOR_CONSTRUCTION_OPTIONS\}/)
  const labels = INTERIOR_CONSTRUCTION_OPTIONS.map(o => o.label)
  assert.deepEqual(labels, ['Unlined', 'Regular lining — part of the garment',
    'Regular lining — most/all of the garment', 'Reversible / two full fabric layers', 'Not sure'])
  // No manufacturing terminology reaches the owner, in either the control or its labels.
  for (const jargon of ['interlining', 'material assembly', 'facing', 'batting']) {
    assert.ok(!new RegExp(jargon, 'i').test(control + labels.join(' ')),
      `the editor must not say "${jargon}"`)
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
  assert.equal(thermalMaterialVerdict({ ...coat, insulating_layer_materials: [] }), 'non_insulating',
    'the owner ruling the fill out IS the negative answer — nothing else is required')
  assert.equal(thermalMaterialVerdict({ ...coat, insulating_layer_materials: ['polyester'] }), 'insulating')

  // ['unknown'] is a POSITIVE claim: a layer is there, its material unidentified. A quilted coat is
  // insulated whether or not we know what is inside it.
  assert.equal(thermalMaterialVerdict({ fiber_content: ['polyester', 'nylon'], insulating_layer_materials: ['unknown'] }), 'insulating')
})

test('the negative branch needs the layer explicitly ruled out, not merely absent', () => {
  const tee = { fiber_content: ['cotton'] }
  assert.equal(thermalMaterialVerdict(tee), 'unknown', 'absent is not empty')
  assert.equal(thermalMaterialVerdict({ ...tee, insulating_layer_materials: [] }), 'non_insulating')
  // A tagger cannot reach the negative by any route: its [] is downgraded to null upstream.
  assert.equal(normalizeInsulatingLayerMaterials([], { source: 'tagger' }), null)
})

test('a photograph may assert an insulating layer exists, never that one is absent', () => {
  const n = normalizeInsulatingLayerMaterials
  assert.equal(n(undefined, { source: 'tagger' }), null)
  assert.deepEqual(n([], { source: 'tagger' }), null, 'a tagger asserting [] is downgraded to unrecorded')
  assert.deepEqual(n([], { source: 'manual' }), [], 'only a person can rule the layer out')
  assert.deepEqual(n(['unknown'], { source: 'tagger' }), ['unknown'])
  assert.deepEqual(n(['Wool', ' shearling'], { source: 'tagger' }), ['wool', 'shearling'],
    'shearling is a canonical insulating material in its own right, not a synonym for fleece')
  assert.deepEqual(n(['shearling'], { source: 'manual' }), ['shearling'],
    '996868 round-trips as shearling — a verdict-only assertion would pass even if it collapsed to [unknown]')
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

test('the editor control exposes all three insulating-layer states', () => {
  // Until this existed only the tagger could write the field, and a tagger may never assert [] —
  // so non_insulating was unreachable in production. The control is what makes the negative branch
  // reachable at all. See material-role-representation-spec.md §3.0.
  const source = fs.readFileSync(path.join(process.cwd(), 'src/components/PieceForm.jsx'), 'utf8')
  assert.match(source, /data-piece-field="insulating_layer_materials"/)
  assert.match(source, /function insulatingLayerChoice/)
  assert.match(source, /function insulatingLayerForChoice/)

  // The three-way mapping, exercised as the component does it.
  const choice = v => !Array.isArray(v) ? 'unrecorded' : (v.length ? 'yes' : 'none')
  const forChoice = (c, cur) => c === 'unrecorded' ? null : c === 'none' ? [] : (Array.isArray(cur) && cur.length ? cur : ['unknown'])
  assert.equal(choice(null), 'unrecorded')
  assert.equal(choice([]), 'none')
  assert.equal(choice(['unknown']), 'yes')
  assert.deepEqual(forChoice('none', ['down']), [], 'ruling it out discards named materials, as it must')
  assert.deepEqual(forChoice('yes', null), ['unknown'], 'Yes with nothing named is the honest positive')
  assert.deepEqual(forChoice('yes', ['down']), ['down'], 'switching back keeps what was already named')
  assert.equal(forChoice('unrecorded', ['down']), null)

  // Offered materials are projected, not re-listed — polyester must be offerable, since synthetic
  // fill is the case the whole field exists for.
  assert.match(source, /FIBER_FAMILIES\.insulating, \.\.\.FIBER_FAMILIES\.synthetic/)
  assert.ok(FIBER_FAMILIES.synthetic.includes('polyester'))
  assert.ok(!/const INSULATING_LAYER_MATERIAL_OPTIONS = \['/.test(source), 'no hand-listed material array')
})

test('answering the control makes non_insulating reachable', () => {
  // The gap recorded when the field shipped: nothing in the UI could assert []. This is the
  // end-to-end proof that the negative branch now has a route.
  const tee = { fiber_content: ['cotton'], fiber_content_completeness: 'complete' }
  assert.equal(thermalMaterialVerdict(tee), 'unknown')
  assert.equal(thermalMaterialVerdict({ ...tee, insulating_layer_materials: [] }), 'non_insulating')
  assert.equal(thermalMaterialVerdict({ ...tee, insulating_layer_materials: ['polyester'] }), 'insulating')
})
