import test from 'node:test'
import assert from 'node:assert/strict'

import { pieceOccasionScore } from '../styling-engine/attributes.js'
import { applySoftScoreFloors } from '../styling-engine/softScoreFloors.js'

function basePiece(overrides = {}) {
  return {
    id: 1,
    name: 'emerald green v-neck top',
    category: 'top',
    colors: ['green'],
    background_color: 'green',
    pattern_type: 'solid',
    pattern_scale: 'none',
    pattern_complexity: 'solid',
    fabric_category: 'synthetic',
    fabric_weight: 'light',
    fit_on_body: 'drapes',
    stretch: 'minimal',
    silhouette: 'relaxed',
    style_profile_json: {
      style_lanes: { polished_classic: 1, graphic_casual: 1 },
      garment_intelligence: {
        occasion_confidence: { casual: 'high', evening: 'low', 'smart-casual': 'low', home: 'high' }
      }
    },
    manual_overrides: [],
    ...overrides
  }
}

test('emerald-like clean refined solid gets narrow floors and home cap', () => {
  const adjusted = applySoftScoreFloors(basePiece())
  const profile = adjusted.style_profile_json

  assert.equal(profile.style_lanes.polished_classic, 3)
  assert.equal(profile.style_lanes.graphic_casual, 1)
  assert.equal(profile.garment_intelligence.occasion_confidence.evening, 'medium')
  assert.equal(profile.garment_intelligence.occasion_confidence['smart-casual'], 'medium')
  assert.equal(profile.garment_intelligence.occasion_confidence.home, 'low')
  assert.deepEqual(
    profile._soft_score_adjustments.rules.map(r => r.rule),
    [
      'home_cap_non_loungewear',
      'polished_classic_clean_refined_floor',
      'evening_clean_refined_dressy_floor',
      'smart_casual_refined_floor'
    ]
  )
})

test('floors bound without replacing stronger model scores', () => {
  const adjusted = applySoftScoreFloors(basePiece({
    style_profile_json: {
      style_lanes: { polished_classic: 4 },
      garment_intelligence: {
        occasion_confidence: { evening: 'high', 'smart-casual': 'high', home: 'low' }
      }
    }
  }))
  const profile = adjusted.style_profile_json

  assert.equal(profile.style_lanes.polished_classic, 4)
  assert.equal(profile.garment_intelligence.occasion_confidence.evening, 'high')
  assert.equal(profile.garment_intelligence.occasion_confidence['smart-casual'], 'high')
  assert.equal(profile.garment_intelligence.occasion_confidence.home, 'low')
})

test('loud expressive pieces are not given polished or occasion floors', () => {
  const adjusted = applySoftScoreFloors(basePiece({
    name: 'boho patchwork top',
    background_color: 'multi',
    colors: ['multi'],
    pattern_type: 'botanical',
    pattern_scale: 'bold',
    pattern_complexity: 'loud',
    fabric_category: 'viscose',
    style_profile_json: {
      style_lanes: { modern_bohemian: 3, polished_classic: 0 },
      garment_intelligence: {
        occasion_confidence: { evening: 'low', 'smart-casual': 'low', home: 'medium' }
      }
    }
  }))
  const profile = adjusted.style_profile_json

  assert.equal(profile.style_lanes.polished_classic, 0)
  assert.equal(profile.garment_intelligence.occasion_confidence.evening, 'low')
  assert.equal(profile.garment_intelligence.occasion_confidence['smart-casual'], 'low')
  assert.equal(profile.garment_intelligence.occasion_confidence.home, 'low')
})

test('loungewear skips home cap', () => {
  const adjusted = applySoftScoreFloors(basePiece({
    name: 'relaxed fleece lounge hoodie',
    fabric_category: 'fleece',
    fabric_weight: 'medium',
    fit_on_body: 'drapes',
    silhouette: 'oversized',
    style_profile_json: {
      style_lanes: {},
      garment_intelligence: { occasion_confidence: { home: 'high' } }
    }
  }))

  assert.equal(adjusted.style_profile_json.garment_intelligence.occasion_confidence.home, 'high')
})

test('manual nested overrides are immune', () => {
  const adjusted = applySoftScoreFloors(basePiece({
    manual_overrides: [
      'style_profile_json.style_lanes.polished_classic',
      'style_profile_json.garment_intelligence.occasion_confidence.evening'
    ]
  }))
  const profile = adjusted.style_profile_json

  assert.equal(profile.style_lanes.polished_classic, 1)
  assert.equal(profile.garment_intelligence.occasion_confidence.evening, 'low')
  assert.equal(profile.garment_intelligence.occasion_confidence['smart-casual'], 'medium')
})

test('soft-score floors are idempotent', () => {
  const once = applySoftScoreFloors(basePiece())
  const twice = applySoftScoreFloors(once)

  assert.deepEqual(twice.style_profile_json, once.style_profile_json)
})

test('occasion floor reaches existing occasion scoring path', () => {
  const before = basePiece()
  const after = applySoftScoreFloors(before)

  assert.equal(pieceOccasionScore(before, 'evening'), -15)
  assert.equal(pieceOccasionScore(after, 'evening'), 10)
})
