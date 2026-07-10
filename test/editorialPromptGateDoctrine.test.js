import test from 'node:test'
import assert from 'node:assert/strict'
import { EDITORIAL_NEW_PIECES_SYSTEM, OUTFIT_EVALUATOR_GATE_SYSTEM } from '../styling-engine/prompts.js'

// Spec 6: occasion-register/weather/activity-comfort doctrine for the two editorial ideation prompts.
// Neither operates on real tagged pieces (pure conceptual ideation), so this is prompt doctrine, not a
// mechanical gate — these assertions only prove the strings exist, not that the model follows them.

test('EDITORIAL_NEW_PIECES_SYSTEM includes occasion-register, weather, and activity-comfort doctrine', () => {
  assert.match(EDITORIAL_NEW_PIECES_SYSTEM, /Respect the stated occasion's register/)
  assert.match(EDITORIAL_NEW_PIECES_SYSTEM, /no cocktail-weight pieces for a gallery\/museum\/daytime-casual occasion/)
  assert.match(EDITORIAL_NEW_PIECES_SYSTEM, /Adapt to the stated season\/weather/)
  assert.match(EDITORIAL_NEW_PIECES_SYSTEM, /do not suggest heavy insulating fabrics/)
  assert.match(EDITORIAL_NEW_PIECES_SYSTEM, /If the request implies physical activity/)
  assert.match(EDITORIAL_NEW_PIECES_SYSTEM, /do not suggest stilettos, delicate sandals, or high heels/)
})

test('OUTFIT_EVALUATOR_GATE_SYSTEM extends its occasion-adaptation check with register-ceiling and activity-comfort rejects', () => {
  // Regression guard: the original weather-adaptation line must survive the extension unchanged.
  assert.match(OUTFIT_EVALUATOR_GATE_SYSTEM, /adapt checks to the requested occasion, season, and mood \(e\.g\. if the user describes hot weather or summer, do not reject lightweight shorts\/sandals\/skirts outfits as "too casual" or "lacking structure" if they make styling sense for the heat\)\./)
  assert.match(OUTFIT_EVALUATOR_GATE_SYSTEM, /reject \(or flag in the rejected list\) any outfit whose formality clearly exceeds the stated occasion's register/)
  assert.match(OUTFIT_EVALUATOR_GATE_SYSTEM, /reject \(or flag\) any outfit with stilettos, delicate sandals, or high heels when the request implies a walking-heavy or hiking activity/)
})
