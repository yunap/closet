import test from 'node:test'
import assert from 'node:assert/strict'
import {
  autoStylingTrustDecision,
  buildWardrobePieceTruthText,
} from '../src/utils/wardrobeAiContext.js'

test('piece truth text preserves bottom construction facts for AI prompts', () => {
  const text = buildWardrobePieceTruthText({
    name: 'black washed bootcut denim jeans',
    category: 'bottom',
    colors: ['Black'],
    reads_as: 'quiet dark neutral',
    bottom_shape: 'bootcut',
    leg_opening: 'straight/open',
    length_hits_at: 'full-length',
    hem_finish: 'straight_open',
    fabric_category: 'denim',
    fabric_weight: 'medium',
    fit_confidence: 'high',
    recommendation_status: 'trusted',
  })

  assert.match(text, /black washed bootcut denim jeans/)
  assert.match(text, /bottom shape: bootcut/)
  assert.match(text, /leg opening: straight\/open/)
  assert.match(text, /hits at: full-length/)
  assert.match(text, /fabric: denim\/medium/)
})

test('piece truth text includes engine notes and AI garment intelligence', () => {
  const text = buildWardrobePieceTruthText({
    name: 'black pink floral skirt',
    category: 'bottom',
    recommendation_status: 'needs_fit_review',
    fit_confidence: 'low',
    engine_notes: 'Too small now; do not auto-style as a hero piece.',
    style_profile_json: {
      style_lanes: { folk_artisan: 4, modern_bohemian: 3 },
      visual_roles: ['movement_piece'],
      style_notes: {
        best_use: 'testing only',
        risk: 'can ride up at the waist',
      },
      garment_intelligence: {
        auto_use_trust: 'needs_fit_review',
        best_outfit_role: 'movement',
        pairing_requirements: ['needs compact support'],
        failure_risks: ['can turn costume-like with another folk piece'],
        formula_compatibility: ['compact top + movement skirt'],
        do_not_pair_rules: ['avoid another folk piece'],
        real_wear_notes: { fit: 'rides up when too tight' },
        occasion_confidence: { city: 'low' },
      },
    },
  })

  assert.match(text, /recommendation trust: needs_fit_review/)
  assert.match(text, /fit confidence: low/)
  assert.match(text, /engine note: Too small now; do not auto-style as a hero piece\./)
  assert.match(text, /style lanes: folk_artisan:4, modern_bohemian:3/)
  assert.match(text, /AI auto-use trust: needs_fit_review/)
  assert.match(text, /real wear: fit: rides up when too tight/)
})

test('auto styling trust blocks low-confidence fit and explicit do-not-auto notes', () => {
  const decision = autoStylingTrustDecision({
    name: 'black pink floral skirt',
    recommendation_status: 'needs_fit_review',
    fit_confidence: 'low',
    engine_notes: 'Too small now; testing whether alteration is worth it. Do not auto-style as a hero piece. OK to explore only when specifically requested.',
  }, { occasion: 'city' })

  assert.equal(decision.allowed, false)
  assert.ok(decision.reasons.includes('needs fit review'))
  assert.ok(decision.reasons.includes('low fit confidence'))
  assert.ok(decision.reasons.includes('engine notes suppress auto-use'))
})

test('manual fit confidence and city tag override stale AI profile fit and profile confidence', () => {
  const decision = autoStylingTrustDecision({
    name: 'bold multicolor dot peplum top',
    recommendation_status: 'trusted',
    fit_confidence: 'high',
    manual_overrides: ['fit_confidence', 'occasions'],
    occasions: ['casual', 'city'],
    style_profile_json: {
      garment_intelligence: {
        auto_use_trust: 'needs_fit_review',
        occasion_confidence: {
          'smart-casual': 'low'
        }
      }
    }
  }, { occasion: 'city_smart_casual' })

  assert.equal(decision.allowed, true)
  assert.equal(decision.reasons.includes('AI profile needs fit review'), false)
  assert.equal(decision.reasons.includes('AI profile low confidence for city_smart_casual'), false)
})

test('auto styling trust does not treat bohemian or folk/artisan as inherently bad', () => {
  const decision = autoStylingTrustDecision({
    name: 'gray folk artisan skirt',
    recommendation_status: 'trusted',
    fit_confidence: 'high',
    reads_as: 'folk artisan utilitarian bohemian movement piece',
    style_profile_json: {
      style_lanes: { folk_artisan: 4, modern_bohemian: 3 },
      style_notes: {
        risk: 'strong point of view; needs quiet support',
      },
    },
  }, { occasion: 'city' })

  assert.equal(decision.allowed, true)
  assert.deepEqual(decision.reasons, [])
})
