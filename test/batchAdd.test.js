import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { GATE_CRITICAL_FIELDS } from '../styling-engine/attributes.js'
import { FIBER_VALUES, FIBER_OPTIONS_ORDER, INSULATING_FIBERS, FIBER_FAMILIES } from '../styling-engine/fiberTaxonomy.js'

const source = fs.readFileSync(path.join(process.cwd(), 'src/components/BatchAdd.jsx'), 'utf8')

test('BatchAdd preserves structured register and shoe comfort tags from AI tagging', () => {
  assert.match(source, /formality:\s*null,\s*heel_height:\s*null,\s*walk_support:\s*null/)
  assert.match(source, /formality:\s*tags\.formality\s*\|\|\s*null/)
  assert.match(source, /heel_height:\s*tags\.heel_height\s*\|\|\s*null/)
  assert.match(source, /walk_support:\s*tags\.walk_support\s*\|\|\s*null/)
})

test('BatchAdd review UI exposes formality before saving', () => {
  assert.match(source, /const FORMALITY_OPTIONS = \[/)
  assert.match(source, /form\.category !== 'accessory'/)
  assert.match(source, /form\.formality === opt\.value/)
  assert.match(source, /set\('formality', opt\.value\)/)
})

test('BatchAdd review UI exposes fabric_weight, fiber_content, and shoe comfort fields', () => {
  assert.match(source, /const FABRIC_WEIGHT_OPTIONS = \[/)
  assert.match(source, /const FIBER_OPTIONS = FIBER_OPTIONS_ORDER/)
  assert.match(source, /const HEEL_HEIGHT_OPTIONS = \[/)
  assert.match(source, /const WALK_SUPPORT_OPTIONS = \[/)
  assert.match(source, /form\.fabric_weight === opt\.value/)
  assert.match(source, /toggleArr\('fiber_content', fib\)/)
  assert.match(source, /form\.category === 'shoes'/)
})

test('BatchAdd and PieceForm bind all GATE_CRITICAL_FIELDS to UI control labels', () => {
  const pieceFormSource = fs.readFileSync(path.join(process.cwd(), 'src/components/PieceForm.jsx'), 'utf8')
  // GATE_CRITICAL_FIELDS is imported from the real source rather than duplicated here — a stale
  // local copy is exactly how this test missed 'visual_weight' the first time it was added.
  // Matches both a literal field="x" prop and a category-conditional field={cond ? 'x' : 'y'} one
  // (fabric_weight/visual_weight share one label slot, switched by category at render time).
  for (const field of GATE_CRITICAL_FIELDS) {
    assert.match(source, new RegExp(`field=[^>]*['"]${field}['"]`))
    assert.match(pieceFormSource, new RegExp(`field=[^>]*['"]${field}['"]`))
  }
})

test('the fibre vocabulary has exactly one owner', () => {
  // Until 2026-09-01 the same 35 values were maintained as six copies (both intake forms, the
  // tagger prompt in prompts.js, its duplicate in routes/ai.js, VALID_FIBERS in taggerMerge.js,
  // and a dead FIBER_VALUES that had already drifted 13 values behind). This asserts none of them
  // grows a local list again — a re-listed copy is how the dead one drifted unnoticed.
  const files = {
    'src/components/BatchAdd.jsx': source,
    'src/components/PieceForm.jsx': fs.readFileSync(path.join(process.cwd(), 'src/components/PieceForm.jsx'), 'utf8'),
    'styling-engine/prompts.js': fs.readFileSync(path.join(process.cwd(), 'styling-engine/prompts.js'), 'utf8'),
    'routes/ai.js': fs.readFileSync(path.join(process.cwd(), 'routes/ai.js'), 'utf8'),
    'styling-engine/taggerMerge.js': fs.readFileSync(path.join(process.cwd(), 'styling-engine/taggerMerge.js'), 'utf8'),
  }
  for (const [name, text] of Object.entries(files)) {
    assert.ok(!/wool.{0,4},\s*merino.{0,4},\s*cashmere/.test(text),
      `${name} re-lists the fibre vocabulary instead of deriving it from fiberTaxonomy.js`)
  }
})

test('both fibre orderings reproduce the vocabulary each consumer shipped', () => {
  // The two orderings are permutations of the same family blocks. These literals are the exact
  // lists in use before consolidation; a change to either is a real behaviour change (the tagger
  // prompt's enum text, or the chip order the owner sees) and should have to be made deliberately.
  assert.deepEqual(FIBER_VALUES, ['wool', 'merino', 'cashmere', 'alpaca', 'mohair', 'fleece', 'down',
    'cotton', 'linen', 'hemp', 'silk', 'tencel', 'modal', 'rayon', 'viscose', 'polyester', 'nylon',
    'acrylic', 'spandex', 'leather', 'suede', 'denim', 'tweed', 'metal', 'stone', 'wood', 'ceramic',
    'glass', 'horn', 'shell', 'resin', 'pearl', 'crystal', 'enamel', 'unknown'])
  assert.deepEqual(FIBER_OPTIONS_ORDER, ['cotton', 'linen', 'hemp', 'silk', 'wool', 'merino',
    'cashmere', 'alpaca', 'mohair', 'fleece', 'down', 'tencel', 'modal', 'rayon', 'viscose',
    'polyester', 'nylon', 'acrylic', 'spandex', 'leather', 'suede', 'denim', 'tweed', 'metal',
    'stone', 'wood', 'ceramic', 'glass', 'horn', 'shell', 'resin', 'pearl', 'crystal', 'enamel',
    'unknown'])
  assert.deepEqual([...INSULATING_FIBERS], FIBER_FAMILIES.insulating)
  assert.deepEqual([...FIBER_VALUES].sort(), [...FIBER_OPTIONS_ORDER].sort())
})
