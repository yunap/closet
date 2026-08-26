import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPrompts } from '../styling-engine/prompts.js'
import { LEGACY_PROFILE, LEGACY_CONSTITUTION } from '../styling-engine/constitutionSeed.js'
const { EDITORIAL_NEW_PIECES_SYSTEM, OUTFIT_EVALUATOR_GATE_SYSTEM } = buildPrompts({ profile: LEGACY_PROFILE, constitution: LEGACY_CONSTITUTION })

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

// Prompt-responsibility census verification (2026-08-26): unlike EDITORIAL_NEW_PIECES_SYSTEM above,
// this gate DOES operate on real tagged pieces — the selected garment plus candidates that already
// passed registerCeilingVerdict/footwearComfortVerdict via selectAutomaticUseCandidatesForOutfitGeneration
// upstream. Free prose re-deriving "formality clearly exceeds register" or "stilettos... implies
// walking-heavy" could reach a different verdict than those canonical functions on the same piece —
// confirmed by tracing composeStructuredOutfitsForPiece's call chain (styling-engine/core.js). Fixed
// by computing the one piece those checks could not already cover (the selected anchor, which
// bypasses automatic-use eligibility by ratified design) and citing the computed result instead.
test('OUTFIT_EVALUATOR_GATE_SYSTEM defers to computed register/footwear checks instead of re-deriving them', () => {
  // Regression guard: the original weather-adaptation line must survive the extension unchanged.
  assert.match(OUTFIT_EVALUATOR_GATE_SYSTEM, /adapt checks to the requested occasion, season, and mood \(e\.g\. if the user describes hot weather or summer, do not reject lightweight shorts\/sandals\/skirts outfits as "too casual" or "lacking structure" if they make styling sense for the heat\)\./)
  assert.match(OUTFIT_EVALUATOR_GATE_SYSTEM, /already passed the wardrobe's register and footwear eligibility checks before reaching you/)
  assert.match(OUTFIT_EVALUATOR_GATE_SYSTEM, /do not re-derive formality-vs-occasion or footwear-vs-activity suitability yourself/)
  assert.match(OUTFIT_EVALUATOR_GATE_SYSTEM, /"Selected garment register check \(computed\)" or "Selected garment footwear check \(computed\)"/)
  assert.doesNotMatch(OUTFIT_EVALUATOR_GATE_SYSTEM, /formality clearly exceeds the stated occasion's register/)
  assert.doesNotMatch(OUTFIT_EVALUATOR_GATE_SYSTEM, /stilettos, delicate sandals, or high heels when the request implies/)
})
