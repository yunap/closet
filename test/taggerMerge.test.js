import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CONFIDENCE_FIELDS,
  applyTaggerResult,
  normalizeConfidenceMap,
  normalizeFormality,
  normalizeHeelHeight,
  normalizeOuterwearRole,
  normalizeWalkSupport,
  normalizeWeatherProtection,
  tagStateForTaggerResult
} from '../styling-engine/taggerMerge.js'
import {
  formalityRank,
  pieceFormality,
  pieceHeelHeight,
  pieceWalkSupport
} from '../styling-engine/attributes.js'

test('normalizeConfidenceMap defaults missing and malformed confidence to low', () => {
  const confidence = normalizeConfidenceMap({
    silhouette: 'high',
    sleeve_length: 'banana',
    fit_on_body: 'manual'
  })

  assert.equal(confidence.silhouette, 'high')
  assert.equal(confidence.sleeve_length, 'low')
  assert.equal(confidence.fit_on_body, 'manual')
  assert.equal(confidence.length_hits_at, 'low')
  assert.deepEqual(Object.keys(confidence).sort(), [...CONFIDENCE_FIELDS].sort())
})

test('applyTaggerResult persists normalized confidence and photo properties', () => {
  const merged = applyTaggerResult(
    { id: 1, name: 'test top', manual_overrides: [] },
    {
      silhouette: 'relaxed',
      _confidence: { silhouette: 'high', fit_on_body: 'wat' },
      photo_properties: {
        'WORN PHOTO': { fit_visible: true, real_context: false, notes: 'home try-on' }
      },
      style_profile_json: {
        style_lanes: { polished_classic: 2 }
      }
    }
  )

  assert.equal(merged.silhouette, 'relaxed')
  assert.equal(merged.style_profile_json._confidence.silhouette, 'high')
  assert.equal(merged.style_profile_json._confidence.fit_on_body, 'low')
  assert.equal(merged.style_profile_json.photo_properties['WORN PHOTO'].fit_visible, true)
  assert.equal(merged.style_profile_json.photo_properties['WORN PHOTO'].real_context, false)
})

test('applyTaggerResult normalizes fiber content to canonical values', () => {
  const merged = applyTaggerResult(
    { id: 1, name: 'test sweater', manual_overrides: [] },
    {
      fiber_content: ['Wool', 'mystery fiber', 'linen'],
      _confidence: { fiber_content: 'medium' }
    }
  )

  // 'mystery fiber' is DROPPED, not rewritten to 'unknown'. This assertion used to expect
  // ['wool', 'unknown', 'linen'] — it encoded the collapse of invalid evidence into valid
  // uncertainty that fiber-evidence-completeness-spec.md §9 removes. Output is in canonical
  // taxonomy order, so the same set of fibres stores identically whatever order it arrived in.
  assert.deepEqual(merged.fiber_content, ['wool', 'linen'])
  assert.equal(merged.style_profile_json._confidence.fiber_content, 'medium')
})

test('formality and shoe support enums normalize without text guessing', () => {
  assert.equal(normalizeFormality('Elevated'), 'elevated')
  assert.equal(normalizeHeelHeight('MID'), 'mid')
  assert.equal(normalizeWalkSupport('low'), 'low')
  assert.equal(normalizeFormality('fancy'), null)
  assert.equal(normalizeHeelHeight('wedge'), null)
  assert.equal(normalizeWalkSupport('walkable'), null)

  assert.equal(formalityRank('lounge'), 0)
  assert.equal(formalityRank('dressy'), 3)
  assert.equal(formalityRank('unknown'), null)
  assert.equal(pieceFormality({ name: 'lace top', formality: 'dressy' }), 'dressy')
  assert.equal(pieceFormality({ name: 'dressy lace top' }), null)
  assert.equal(pieceHeelHeight({ name: 'wedge heel', heel_height: 'high' }), 'high')
  assert.equal(pieceHeelHeight({ name: 'wedge heel' }), null)
  assert.equal(pieceWalkSupport({ name: 'ballet flat', walk_support: 'low' }), 'low')
  assert.equal(pieceWalkSupport({ name: 'ballet flat' }), null)
})

test('normalizeOuterwearRole and normalizeWeatherProtection: strict enum vs multi-select with no fallback', () => {
  assert.equal(normalizeOuterwearRole('protective_shell'), 'protective_shell')
  assert.equal(normalizeOuterwearRole('Cold_Weather_Outerwear'), 'cold_weather_outerwear')
  assert.equal(normalizeOuterwearRole('weatherproof'), null)
  assert.equal(normalizeOuterwearRole(undefined), null)

  // Unlike normalizeFiberContent, an unrecognized/empty result is [] — "no reliable protection
  // identified" is a legitimate answer, never defaulted to a placeholder like ['unknown'].
  assert.deepEqual(normalizeWeatherProtection(['rain', 'wind']), ['rain', 'wind'])
  assert.deepEqual(normalizeWeatherProtection(['WIND']), ['wind'])
  assert.deepEqual(normalizeWeatherProtection(['rain', 'rain']), ['rain'], 'dedupes')
  assert.deepEqual(normalizeWeatherProtection(['rain', 'waterproof']), ['rain'], 'drops unrecognized values instead of nulling the whole field')
  assert.deepEqual(normalizeWeatherProtection([]), [])
  assert.deepEqual(normalizeWeatherProtection(undefined), [])
  assert.deepEqual(normalizeWeatherProtection('rain'), [], 'a non-array input is not coerced — treated as no data')
})

test('applyTaggerResult normalizes outerwear_role and weather_protection', () => {
  const merged = applyTaggerResult(
    { id: 1, name: 'test jacket', category: 'outerwear', manual_overrides: [] },
    {
      outerwear_role: 'Protective_Shell',
      weather_protection: ['WIND', 'not_a_hazard'],
      _confidence: { outerwear_role: 'medium', weather_protection: 'high' }
    }
  )
  assert.equal(merged.outerwear_role, 'protective_shell')
  assert.deepEqual(merged.weather_protection, ['wind'])
})

test('applyTaggerResult normalizes formality and shoe support fields', () => {
  const merged = applyTaggerResult(
    { id: 1, name: 'test shoe', manual_overrides: [] },
    {
      formality: 'Dressy',
      heel_height: 'MID',
      walk_support: 'low',
      _confidence: { formality: 'medium', heel_height: 'high', walk_support: 'high' }
    }
  )

  assert.equal(merged.formality, 'dressy')
  assert.equal(merged.heel_height, 'mid')
  assert.equal(merged.walk_support, 'low')
  assert.equal(merged.style_profile_json._confidence.formality, 'medium')
  assert.equal(merged.style_profile_json._confidence.heel_height, 'high')
  assert.equal(merged.style_profile_json._confidence.walk_support, 'high')
})

test('manual overrides pin confidence and block retag overwrite', () => {
  const merged = applyTaggerResult(
    {
      id: 1,
      silhouette: 'slim',
      manual_overrides: ['silhouette'],
      style_profile_json: { _confidence: { silhouette: 'manual' } }
    },
    {
      silhouette: 'relaxed',
      _confidence: { silhouette: 'high' }
    }
  )

  assert.equal(merged.silhouette, 'slim')
  assert.equal(merged.style_profile_json._confidence.silhouette, 'manual')
})

test('tagStateForTaggerResult uses explicit fit-visible judgment over worn-photo fallback', () => {
  assert.equal(
    tagStateForTaggerResult({
      style_profile_json: {
        photo_properties: {
          'WORN PHOTO': { fit_visible: false, real_context: false }
        }
      }
    }, { photo: true, worn_photo: true }),
    'provisional'
  )

  assert.equal(
    tagStateForTaggerResult({
      style_profile_json: {
        photo_properties: {
          'WORN PHOTO': { fit_visible: true, real_context: false }
        }
      }
    }, { photo: true, worn_photo: true }),
    'fully_tagged'
  )
})
