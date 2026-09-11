process.env.WARDROBE_DB_PATH = ':memory:'

import test from 'node:test'
import assert from 'node:assert'
import { evaluateBatchThermalCoherence } from '../styling-engine/outfitThermalCoherence.js'
import { buildPrompts } from '../styling-engine/prompts.js'
import { LEGACY_PROFILE, LEGACY_CONSTITUTION } from '../styling-engine/constitutionSeed.js'
import { STYLIST_TOOLS } from '../styling-engine/tools.js'

test('evaluateBatchThermalCoherence: single outfit passes untouched', () => {
  const outfits = [{ id: 1, pieces: [{ id: 10, category: 'top' }] }]
  const result = evaluateBatchThermalCoherence(outfits)
  assert.strictEqual(result.coherentOutfits.length, 1)
  assert.strictEqual(result.rejected.length, 0)
})

test('evaluateBatchThermalCoherence: coherent outfits within 1 thermal step all pass', () => {
  const pieces = [
    { id: 1, name: 'Cotton blouse', category: 'top', fabric_weight: 'light', fiber_content: ['cotton'] },
    { id: 2, name: 'Tailored trousers', category: 'bottom', fabric_weight: 'medium', fiber_content: ['cotton'] },
    { id: 3, name: 'Loafers', category: 'shoes' },
    { id: 4, name: 'Merino sweater', category: 'top', fabric_weight: 'medium', fiber_content: ['merino wool'] },
    { id: 5, name: 'Pleated skirt', category: 'bottom', fabric_weight: 'medium', fiber_content: ['polyester'] },
  ]
  const outfitA = { id: 'look_a', pieces: [pieces[0], pieces[1], pieces[2]] }
  const outfitB = { id: 'look_b', pieces: [pieces[3], pieces[4], pieces[2]] }

  const result = evaluateBatchThermalCoherence([outfitA, outfitB], {
    candidatePieces: pieces,
    weatherProfile: { isHot: false, isCold: false, resolvedWeatherContext: { temperature: { band: 'mild' } } }
  })
  assert.strictEqual(result.coherentOutfits.length, 2)
  assert.strictEqual(result.rejected.length, 0)
})

test('evaluateBatchThermalCoherence: extreme thermal outlier (very light linen vs warm wool knit) is rejected in mild context', () => {
  const pieces = [
    // Look 0: High summer linen (very light base)
    { id: 101, name: 'Linen camisole', category: 'top', fabric_weight: 'light', fiber_content: ['linen'], sleeve_length: 'sleeveless' },
    { id: 102, name: 'Linen wide-leg pants', category: 'bottom', fabric_weight: 'light', fiber_content: ['linen'] },
    { id: 103, name: 'Open wedge sandals', category: 'shoes' },
    // Look 1: Cool weather wool knit + jacket (warm)
    { id: 201, name: 'Heavy wool knit dress', category: 'dress', fabric_weight: 'heavy', fiber_content: ['wool'], sleeve_length: 'long' },
    { id: 202, name: 'Cropped wool jacket', category: 'outerwear', fabric_weight: 'medium', fiber_content: ['wool'], sleeve_length: 'long' },
    { id: 203, name: 'Pointed leather pumps', category: 'shoes' },
    // Look 2: Mild smart-casual separates (moderate)
    { id: 301, name: 'Silk blouson wrap top', category: 'top', fabric_weight: 'medium', fiber_content: ['silk'] },
    { id: 302, name: 'Charcoal tailored trousers', category: 'bottom', fabric_weight: 'medium', fiber_content: ['wool blend'] },
    { id: 303, name: 'Block heels', category: 'shoes' },
  ]
  const look0 = { id: 'look_0', label: 'Summer linen look', pieces: [pieces[0], pieces[1], pieces[2]] }
  const look1 = { id: 'look_1', label: 'Wool knit dress look', pieces: [pieces[3], pieces[4], pieces[5]] }
  const look2 = { id: 'look_2', label: 'Silk top + trousers look', pieces: [pieces[6], pieces[7], pieces[8]] }

  const result = evaluateBatchThermalCoherence([look0, look1, look2], {
    candidatePieces: pieces,
    weatherProfile: { isHot: false, isCold: false, resolvedWeatherContext: { temperature: { band: 'mild' } } },
    maxSpread: 1
  })

  // Look 0 (very light) is 2 steps below mild target (moderate), so it is rejected
  assert.strictEqual(result.coherentOutfits.length, 2)
  assert.strictEqual(result.rejected.length, 1)
  assert.strictEqual(result.rejected[0].outfit.id, 'look_0')
  assert.ok(result.rejected[0].reason.includes('thermal incoherence'))
  assert.ok(result.rejected[0].reason.includes('diverges from batch register'))
})

test('evaluateBatchThermalCoherence: in hot weather, warm outerwear look is rejected and light look passes', () => {
  const pieces = [
    { id: 101, name: 'Linen camisole', category: 'top', fabric_weight: 'light', fiber_content: ['linen'], sleeve_length: 'sleeveless' },
    { id: 102, name: 'Linen wide-leg pants', category: 'bottom', fabric_weight: 'light', fiber_content: ['linen'] },
    { id: 103, name: 'Open wedge sandals', category: 'shoes' },
    { id: 201, name: 'Heavy wool knit dress', category: 'dress', fabric_weight: 'heavy', fiber_content: ['wool'], sleeve_length: 'long' },
    { id: 202, name: 'Cropped wool jacket', category: 'outerwear', fabric_weight: 'medium', fiber_content: ['wool'], sleeve_length: 'long' },
    { id: 203, name: 'Pointed leather pumps', category: 'shoes' },
  ]
  const look0 = { id: 'look_0', pieces: [pieces[0], pieces[1], pieces[2]] }
  const look1 = { id: 'look_1', pieces: [pieces[3], pieces[4], pieces[5]] }

  const result = evaluateBatchThermalCoherence([look0, look1], {
    candidatePieces: pieces,
    weatherProfile: { isHot: true, isCold: false }
  })
  assert.strictEqual(result.coherentOutfits.length, 1)
  assert.strictEqual(result.coherentOutfits[0].id, 'look_0')
  assert.strictEqual(result.rejected.length, 1)
  assert.strictEqual(result.rejected[0].outfit.id, 'look_1')
})

test('tools and prompts expose relative date resolution and qualitative weather translation', () => {
  const { STYLIST_SYSTEM } = buildPrompts({ profile: LEGACY_PROFILE, constitution: LEGACY_CONSTITUTION })
  assert.ok(STYLIST_SYSTEM.includes('CURRENT DATE / DAY OF WEEK in your context to an explicit YYYY-MM-DD date'))
  assert.ok(STYLIST_SYSTEM.includes("temperature_band: 'mild' | 'cold' | 'hot'"))

  const generateOutfitsTool = STYLIST_TOOLS.find(t => t.name === 'generate_outfits')
  assert.ok(generateOutfitsTool)
  assert.ok(generateOutfitsTool.input_schema.properties.date.description.includes('day of week or relative date'))
})
