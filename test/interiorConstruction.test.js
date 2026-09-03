// Acceptance fixtures for docs/interior-construction-spec.md §11.
//
// The spec's central requirement: after this change Closet knows 996764 (reversible, two fabric
// faces) is warmer than an unlined light jacket WITHOUT falsely claiming it is insulated, and knows
// 996868 is genuinely insulated because it has shearling inside. Cases A–J below.
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// routes/ai.js reaches db.js transitively, so this file must isolate its database before importing
// it — otherwise the suite runs db.js migrations against the owner's real wardrobe.db. Caught by
// test/hermeticity_guard.test.js, which is exactly what that ratchet is for.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-interior-construction-tests-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')
const { thermalMaterialVerdict, interiorConstruction } = await import('../styling-engine/attributes.js')
const { pieceWeatherScores, INTERIOR_CONSTRUCTION_DEGREE_KEYS } = await import('../styling-engine/thermal.js')
const { applyFiberWriterContract } = await import('../routes/ai.js')
const {
  INTERIOR_CONSTRUCTION_VALUES, INTERIOR_CONSTRUCTION_WRITERS,
  INTERIOR_CONSTRUCTION_LABELS, INTERIOR_CONSTRUCTION_OPTIONS,
} = await import('../styling-engine/fiberTaxonomy.js')

const OUTER = { category: 'outerwear', fabric_weight: 'medium', sleeve_length: 'long' }
const cold = piece => pieceWeatherScores(piece).cold
const heat = piece => pieceWeatherScores(piece).heat

test('A — an ordinary lining adds warmth without becoming insulation', () => {
  const unlined = { ...OUTER, fiber_content: ['cotton'], interior_construction: 'unlined', insulating_layer_materials: [] }
  const lined = { ...unlined, interior_construction: 'full_lining' }

  assert.notEqual(thermalMaterialVerdict(lined), 'insulating',
    'a plain lining must never make a garment read as insulated')
  assert.equal(thermalMaterialVerdict(lined), 'non_insulating')
  assert.ok(cold(lined) > cold(unlined),
    'but it IS warmer than the same coat unlined — that is the whole point of the field')
  assert.ok(heat(lined) < heat(unlined), 'and correspondingly worse in heat')
})

test('B — 996764: a reversible double layer is warmer than an unlined jacket, and not insulated', () => {
  // The defect this spec exists to fix. Before it, the tagger had nowhere to record "two fabric
  // faces" except insulating_layer_materials: ['unknown'], which made an unlined jacket read as a
  // winter coat: verdict `insulating`, cold +12, proposed warmth `warm`.
  const unlinedLight = { ...OUTER, fiber_content: ['cotton'], interior_construction: 'unlined', insulating_layer_materials: [] }
  const reversible = { ...OUTER, fiber_content: ['cotton'], interior_construction: 'full_second_face', insulating_layer_materials: [] }
  const trulyInsulated = { ...OUTER, fiber_content: ['cotton'], interior_construction: 'unlined', insulating_layer_materials: ['down'] }

  assert.notEqual(thermalMaterialVerdict(reversible), 'insulating')
  assert.ok(cold(reversible) > cold(unlinedLight), 'warmer than a comparable single-face garment')
  assert.ok(cold(reversible) < cold(trulyInsulated), 'but not as warm as a filled one')
})

test('C — polyester is warm only by role, never intrinsically', () => {
  const shell = { ...OUTER, fiber_content: ['polyester'], insulating_layer_materials: [] }
  const filled = { ...OUTER, fiber_content: ['polyester'], insulating_layer_materials: ['polyester'] }

  assert.equal(thermalMaterialVerdict(shell), 'non_insulating')
  assert.equal(thermalMaterialVerdict(filled), 'insulating')
  assert.ok(cold(filled) > cold(shell))
})

test('D — shearling is positive insulating evidence and stays shearling', () => {
  const jacket = { ...OUTER, fabric_weight: 'heavy', fiber_content: ['suede'], insulating_layer_materials: ['shearling'] }
  assert.equal(thermalMaterialVerdict(jacket), 'insulating')
})

test('E — an ordinary polyester lining is not polyester fill', () => {
  const linedInPolyester = { ...OUTER, fiber_content: ['cotton'], interior_construction: 'full_lining', insulating_layer_materials: [] }
  const polyesterFilled = { ...OUTER, fiber_content: ['cotton'], insulating_layer_materials: ['polyester'] }

  assert.notEqual(thermalMaterialVerdict(linedInPolyester), thermalMaterialVerdict(polyesterFilled))
  assert.ok(cold(linedInPolyester) < cold(polyesterFilled),
    'the two must not be scored equivalently either')
})

test('F — 996765: a lining and a fill coexist without either fact being discarded', () => {
  const coat = {
    ...OUTER, fabric_weight: 'heavy', fiber_content: ['leather'], fabric_category: 'leather',
    interior_construction: 'full_lining', insulating_layer_materials: ['down'],
  }
  assert.equal(interiorConstruction(coat), 'full_lining')
  assert.deepEqual(coat.insulating_layer_materials, ['down'])
  assert.equal(thermalMaterialVerdict(coat), 'insulating')
  // Both contribute: the lined+filled coat outscores the same coat filled but unlined.
  assert.ok(cold(coat) > cold({ ...coat, interior_construction: 'unlined' }))
})

test('G — no visible interior and no owner answer never becomes unlined', () => {
  assert.equal(interiorConstruction({ ...OUTER }), 'unknown')
  assert.equal(interiorConstruction({ ...OUTER, interior_construction: null }), 'unknown')
  // And unknown contributes nothing, rather than being guessed in either direction.
  const unknown = { ...OUTER, fiber_content: ['cotton'] }
  assert.equal(cold(unknown), cold({ ...unknown, interior_construction: 'unlined' }))
})

test('H — no flow reinterprets interior_construction for itself', () => {
  // The dependency chain is: stored fact → canonical reader → thermal evidence → weather scores →
  // adequacy → flow policy. A flow reading the raw field is a second thermal authority forming.
  const ALLOWED = new Set([
    'styling-engine/fiberTaxonomy.js',   // the canonical reader and normalizer live here
    'styling-engine/attributes.js',      // re-exports the reader; owns the material verdict
    'styling-engine/thermal.js',         // the ONLY consumer that turns it into warmth
    'routes/crud.js',                    // persistence
    'styling-engine/taggerMerge.js',     // writer-authority boundary
    'styling-engine/prompts.js',         // tagger schema projection
    'routes/ai.js',                      // tagger schema projection + writer boundary
    'src/components/PieceForm.jsx',      // the editor control
    'src/components/BatchAdd.jsx',       // the intake form
    'db.js',                             // column definition
  ])
  const roots = ['styling-engine', 'routes', 'src', 'lib']
  const offenders = []
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!/\.(js|jsx)$/.test(entry.name)) continue
      const rel = path.relative(process.cwd(), full)
      if (ALLOWED.has(rel)) continue
      const live = fs.readFileSync(full, 'utf8').split('\n')
        .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      if (live.some(l => l.includes('interior_construction'))) offenders.push(rel)
    }
  }
  for (const r of roots) if (fs.existsSync(r)) walk(r)
  if (fs.existsSync('db.js') && !ALLOWED.has('db.js')) offenders.push('db.js')
  assert.deepEqual(offenders, [],
    `these files read interior_construction directly instead of the derived thermal evidence: ${offenders.join(', ')}`)
})

test('I — unlined AND insulating: the axes are independent in both directions', () => {
  // Real wardrobe. Both are genuinely warm through the FACE fabric with no lining and no fill.
  // §12.2: the repair table's fill column describes assembly, not verdict — a coder who reads
  // "no fill" as a verdict target will try to force non_insulating and break correct physics.
  const fleeceJacket = {
    ...OUTER, fabric_category: 'fleece', fiber_content: ['polyester', 'fleece'],
    interior_construction: 'unlined', insulating_layer_materials: [],
  }
  const tweedJacket = {
    ...OUTER, fabric_category: 'tweed', fiber_content: ['unknown'],
    interior_construction: 'unlined', insulating_layer_materials: [],
  }
  assert.equal(thermalMaterialVerdict(fleeceJacket), 'insulating', '996762 grey fleece')
  assert.equal(thermalMaterialVerdict(tweedJacket), 'insulating', '250 charcoal tweed jacket')
})

test('J — lined, no fill, insulating through the face fabric alone', () => {
  // 996867 black wool coat, owner-verified. Ordinary lining present, fill explicitly absent, and
  // still insulating because the outer material is wool. Together with I this pins the verdict to
  // face material and fill only: construction moves warmth, never the verdict.
  const woolCoat = {
    ...OUTER, fabric_weight: 'heavy', fiber_content: ['wool', 'silk'],
    interior_construction: 'full_lining', insulating_layer_materials: [],
  }
  assert.equal(thermalMaterialVerdict(woolCoat), 'insulating')
  assert.equal(interiorConstruction(woolCoat), 'full_lining')
  assert.ok(cold(woolCoat) > cold({ ...woolCoat, interior_construction: 'unlined' }),
    'the lining still adds warmth on top of an already-insulating face fabric')
})

test('the required monotonic ordering holds, all else equal', () => {
  // §7.1. Stated as an ordering rather than as coefficients, so a future re-tune has to preserve
  // the relationship rather than the numbers.
  const at = interior_construction =>
    cold({ ...OUTER, fiber_content: ['cotton'], insulating_layer_materials: [], interior_construction })
  const insulated = cold({ ...OUTER, fiber_content: ['cotton'], insulating_layer_materials: ['down'] })

  assert.ok(at('unlined') < at('partial_lining'), 'unlined < partial lining')
  assert.equal(at('partial_lining'), at('full_lining'),
    'partial and full lining score identically until a real garment demands a split (§7.1)')
  assert.ok(at('full_lining') < at('full_second_face'), 'ordinary lining < full second face')
  assert.ok(at('full_second_face') < insulated, 'full second face < true insulation')
  assert.equal(at('unknown'), at('unlined'), 'no claim contributes nothing, same as a confirmed absence')
})

test('one canonical vocabulary — no surface keeps its own construction list', () => {
  // The regression pattern this repo has already lived through with fibres: a component or a
  // scoring table quietly maintaining its own copy of an enum, which then drifts. The grep ratchet
  // in case H catches direct semantic READERS; this catches duplicate DEFINITIONS.
  const read = f => fs.readFileSync(path.join(process.cwd(), f), 'utf8')

  // 1. Values, writer rules, labels and options all originate in fiberTaxonomy.js.
  const taxonomy = read('styling-engine/fiberTaxonomy.js')
  for (const owned of ['INTERIOR_CONSTRUCTION_VALUES', 'INTERIOR_CONSTRUCTION_WRITERS',
                       'INTERIOR_CONSTRUCTION_LABELS', 'INTERIOR_CONSTRUCTION_OPTIONS']) {
    assert.ok(taxonomy.includes(`export const ${owned}`), `${owned} must be defined in fiberTaxonomy.js`)
  }

  // 2. No other live file re-lists the enum members. Prompt/schema prose and comments are exempt:
  //    the model is told the vocabulary in words, which is a projection, not a second definition.
  const VALUES = ['unlined', 'partial_lining', 'full_lining', 'full_second_face']
  for (const f of ['src/components/PieceForm.jsx', 'src/components/BatchAdd.jsx',
                   'styling-engine/taggerMerge.js', 'routes/crud.js', 'routes/ai.js']) {
    const live = read(f).split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    const listing = live.filter(l => VALUES.filter(v => l.includes(`'${v}'`) || l.includes(`"${v}"`)).length >= 2)
    assert.deepEqual(listing, [], `${f} re-lists the construction vocabulary instead of importing it`)
  }

  // 3. The editor projects the canonical options rather than building its own array.
  const pieceForm = read('src/components/PieceForm.jsx')
  assert.match(pieceForm, /INTERIOR_CONSTRUCTION_OPTIONS/)
  assert.ok(!/const INTERIOR_CONSTRUCTION_OPTIONS\s*=/.test(pieceForm),
    'PieceForm must consume the canonical options, not define its own')

  // 4. Writer rules are DERIVED from the values, so they cannot drift apart.
  assert.deepEqual(INTERIOR_CONSTRUCTION_WRITERS.tagger,
    INTERIOR_CONSTRUCTION_VALUES.filter(v => v !== 'unlined'))
  assert.deepEqual(INTERIOR_CONSTRUCTION_WRITERS.manual, INTERIOR_CONSTRUCTION_VALUES)

  // 5. Every label and every scoring degree covers the whole vocabulary. A value with no label is
  //    unofferable; a value with no degree is stored, shown, and thermally inert.
  for (const v of INTERIOR_CONSTRUCTION_VALUES) {
    assert.ok(INTERIOR_CONSTRUCTION_LABELS[v], `${v} has no owner-facing label`)
  }
  assert.deepEqual(INTERIOR_CONSTRUCTION_OPTIONS.map(o => o.value).sort(),
    [...INTERIOR_CONSTRUCTION_VALUES].sort(), 'every stored value must be offerable in the editor')
  assert.deepEqual([...INTERIOR_CONSTRUCTION_DEGREE_KEYS].sort(),
    [...INTERIOR_CONSTRUCTION_VALUES].sort(), 'every stored value must have a thermal degree')
})

test('/extract-pieces enforces the insulation writer rule at the boundary, not by prompt compliance', () => {
  // The second photo-derived producer. It normalized fiber_content and interior_construction but
  // NOT insulating_layer_materials, so a model emitting [] there could assert "this garment has no
  // insulating layer" — a claim only a person holding the garment can make, and the exact bypass
  // normalizeInsulatingLayerMaterials exists to prevent. Enforced at the boundary because prompt
  // compliance is not a guarantee.
  const ai = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')
  const fn = ai.slice(ai.indexOf('function applyFiberWriterContract'))
    .slice(0, ai.slice(ai.indexOf('function applyFiberWriterContract')).indexOf('\n}\n') + 3)

  assert.match(fn, /normalizeInsulatingLayerMaterials\(\s*\n?\s*piece\.insulating_layer_materials,\s*\n?\s*\{ source: 'tagger' \}/,
    '/extract-pieces must downgrade a tagger-emitted [] to null, as the main tagging path does')
  assert.match(fn, /normalizeInteriorConstruction\(piece\.interior_construction, \{ source: 'tagger' \}\)/)

  // And the retired field leaves no stale contract prose behind.
  const preamble = ai.slice(ai.indexOf('// ── AI Tagging endpoints'), ai.indexOf('function applyFiberWriterContract'))
  assert.ok(!/completeness/i.test(preamble),
    'the writer-contract comment still describes the retired completeness field')
})

test('/extract-pieces actually downgrades a tagger [] to null, end to end', () => {
  // The behavioural half of the boundary test above. Asserting the call is present proves wiring;
  // this proves the result.
  const out = applyFiberWriterContract({
    pieces: [
      { name: 'quilted coat', fiber_content: ['Polyester'], insulating_layer_materials: [] },
      { name: 'puffer', fiber_content: ['nylon'], insulating_layer_materials: ['down'] },
      { name: 'reversible jacket', fiber_content: ['cotton'], interior_construction: 'unlined' },
      { name: 'plain tee', fiber_content: ['cotton'] },
    ],
  })
  const [coat, puffer, reversible, tee] = out.pieces

  assert.equal(coat.insulating_layer_materials, null,
    'a photo cannot establish that a garment has NO insulating layer — [] must not survive')
  assert.deepEqual(puffer.insulating_layer_materials, ['down'],
    'a positive observation is kept: the asymmetry is the point')
  assert.equal(reversible.interior_construction, 'unknown',
    'and a tagger-asserted unlined is downgraded the same way')
  assert.equal(tee.insulating_layer_materials, null, 'an unanswered field stays unrecorded')
  assert.deepEqual(coat.fiber_content, ['polyester'], 'fibre normalization still applies')
})

test('footwear obeys the same material-role ownership as outerwear', () => {
  // The role-confusion bug, still alive for shoes after the coat fix: both tagger schemas told the
  // model that a warm boot lining goes in fiber_content and called it "the only place a boot's
  // warmth is recorded". That contradicts the canonical contract, where insulating_layer_materials
  // owns "a warm boot's pile/shearling lining" and fiber_content describes the FACE.
  const prompts = fs.readFileSync(path.join(process.cwd(), 'styling-engine/prompts.js'), 'utf8')
  const ai = fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8')

  for (const [name, src] of Object.entries({ 'prompts.js': prompts, 'routes/ai.js': ai })) {
    assert.ok(!/only place a boot's warmth is recorded/.test(src),
      `${name} still claims fiber_content owns footwear warmth`)
    assert.ok(!/include the LINING\/interior material alongside the upper/.test(src),
      `${name} still routes a warm boot lining into the face-material field`)
    assert.match(src, /For FOOTWEAR this (field )?is the UPPER\/face material/,
      `${name} must state the face-material rule for footwear`)
  }

  // The behavioural half: the warmth signal survives the move, so a lined boot is still excluded
  // from hot weather — via the layer field rather than the face list.
  const linedBoot = { category: 'shoes', fabric_category: 'leather', fiber_content: ['leather'], insulating_layer_materials: ['shearling'] }
  const thinFlat = { category: 'shoes', fabric_category: 'leather', fiber_content: ['leather'] }
  assert.equal(thermalMaterialVerdict(linedBoot), 'insulating')
  assert.equal(thermalMaterialVerdict(thinFlat), 'unknown')
})
