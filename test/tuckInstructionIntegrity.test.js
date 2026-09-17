// GARMENT-FACT INTEGRITY: TUCK (live thread_1789508440573, 2026-09-15). A card may not tell the wearer to tuck a base top that
// is recorded wear_over_only. Structural (base-top slot/role), never garment-name matching.
import test from 'node:test'
import assert from 'node:assert/strict'
import { tuckInstructionConflict, correctTuckInstruction } from '../styling-engine/outfitValidation.js'

const shirt = { id: 133, name: 'navy cream striped button-up shirt', category: 'top', role: 'primary_top', tuck_behavior: 'wear_over_only' }
const turtleneck = { id: 144, name: 'black turtleneck', category: 'top', role: 'primary_top', tuck_behavior: 'tucks_anywhere' }
const trousers = { id: 153, name: 'Gray trousers', category: 'bottom', role: 'primary_bottom' }
const cardigan = { id: 135, name: 'cropped cardigan', category: 'outerwear', role: 'layer_top', tuck_behavior: 'wear_over_only' }

test('a tuck instruction on a wear_over_only base top is a conflict (the live cards)', () => {
  const conflict = tuckInstructionConflict({ pieces: [shirt, trousers], stylingInstructions: 'Striped shirt tucked into grey trousers; puffer jacket worn open or zipped as needed.' })
  assert.equal(conflict?.code, 'tuck_instruction_contradicts_wear_over_only')
  assert.equal(conflict.pieceId, 133)
  assert.ok(tuckInstructionConflict({ pieces: [{ ...shirt, id: 140 }, trousers], stylingInstructions: 'Olive top tucked into black flare jeans; trench coat belted at the natural waist.' }))
  assert.ok(tuckInstructionConflict({ pieces: [shirt, trousers], stylingInstructions: 'Half-tuck the shirt at the front.' }))
})

test('no conflict when the instruction keeps it untucked, the base top may tuck, or only a layer is wear_over_only', () => {
  assert.equal(tuckInstructionConflict({ pieces: [shirt, trousers], stylingInstructions: 'Shirt worn untucked over the trousers.' }), null)
  assert.equal(tuckInstructionConflict({ pieces: [shirt, trousers], stylingInstructions: 'Leave the shirt out; do not tuck it.' }), null)
  assert.equal(tuckInstructionConflict({ pieces: [shirt, trousers], stylingInstructions: '' }), null)
  assert.equal(tuckInstructionConflict({ pieces: [turtleneck, trousers], stylingInstructions: 'Turtleneck tucked into charcoal trousers.' }), null)
  assert.equal(tuckInstructionConflict({ pieces: [turtleneck, cardigan, trousers], stylingInstructions: 'Shell tucked into the pants; cardigan worn open.' }), null, 'the wear_over_only cardigan is a layer, not the tucked base')
})

test('without roles, a single top is the base; several unroled tops are not guessed', () => {
  const unroled = { ...shirt, role: undefined }
  assert.ok(tuckInstructionConflict({ pieces: [unroled, { ...trousers, role: undefined }], stylingInstructions: 'Tuck the shirt in.' }))
  assert.equal(tuckInstructionConflict({ pieces: [unroled, { ...turtleneck, role: undefined }], stylingInstructions: 'Tuck the shirt in.' }), null)
})

test('every composition path runs the same check on its own pieces and instructions', async () => {
  const fs = await import('node:fs')
  const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  assert.match(read('styling-engine/tools.js'), /tuckInstructionConflict\(\{ pieces: resolved, stylingInstructions: styling_instructions \}\)[\s\S]{0,200}contractIssues\.push/, '/ask propose_outfit returns it as a contract issue')
  assert.match(read('styling-engine/outfitSetPlanner.js'), /tuckInstructionConflict\(\{ pieces, stylingInstructions: outfit\.stylingInstructions \}\)\s*\n\s*if \(tuckConflict\) reasons\.push/, 'trip/capsule plan validation rejects the submission for resubmission')
  assert.match(read('routes/ai.js'), /correctTuckInstruction\(\{[\s\S]{0,1200}type: 'Fit note', code: tuckConflict\.code/, 'Whole Wardrobe annotates the delivered card (advisor mode: no repair)')
  assert.match(read('routes/ai.js'), /stylingInstructions: tuck\.corrected, stylingInstructionsOriginal: tuck\.original/, 'and the contradicted clause does not ship as authoritative guidance')
})

test('the correction drops only the contradicted clause, states the recorded mechanic, and keeps what the model wrote', () => {
  const pieces = [shirt, trousers]
  const result = correctTuckInstruction({ pieces, stylingInstructions: 'Striped shirt tucked into grey trousers; puffer jacket worn open or zipped as needed.' })
  assert.equal(result.conflict?.code, 'tuck_instruction_contradicts_wear_over_only')
  assert.doesNotMatch(result.corrected, /tucked into/)
  assert.match(result.corrected, /puffer jacket worn open or zipped as needed/, 'the rest of the guidance survives')
  assert.match(result.corrected, /is worn untucked \(recorded wear over only\)/)
  assert.equal(result.original, 'Striped shirt tucked into grey trousers; puffer jacket worn open or zipped as needed.')
  assert.deepEqual(result.removed, ['Striped shirt tucked into grey trousers'])
  const clean = correctTuckInstruction({ pieces, stylingInstructions: 'Shirt worn untucked over the trousers.' })
  assert.equal(clean.conflict, null)
  assert.equal(clean.corrected, 'Shirt worn untucked over the trousers.')
})

// The limits are recorded deliberately: this catches the incident's shape, not prose contradiction in general.
test('known limits: only the base top and only the instruction field', () => {
  const pieces = [shirt, trousers]
  assert.equal(tuckInstructionConflict({ pieces, stylingInstructions: 'Hem sits inside the waistband.' }), null, 'a paraphrase with no tuck word is not caught')
  assert.equal(tuckInstructionConflict({ pieces, stylingInstructions: 'Belt it over the trousers.' }), null, 'other contradicted mechanics are not covered')
  const layerOnly = [{ id: 5, name: 'lace overlay', category: 'top', role: 'layer_top', tuck_behavior: 'wear_over_only' }, turtleneck, trousers]
  assert.equal(tuckInstructionConflict({ pieces: layerOnly, stylingInstructions: 'Tuck the lace overlay into the trousers.' }), null, 'a contradicted instruction about a layer is not caught')
})
