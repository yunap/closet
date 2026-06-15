import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CONFIDENCE_FIELDS,
  applyTaggerResult,
  normalizeConfidenceMap,
  tagStateForTaggerResult
} from '../styling-engine/taggerMerge.js'

test('normalizeConfidenceMap defaults missing and malformed confidence to low', () => {
  const confidence = normalizeConfidenceMap({
    silhouette: 'high',
    sleeve_type: 'banana',
    fit_on_body: 'manual'
  })

  assert.equal(confidence.silhouette, 'high')
  assert.equal(confidence.sleeve_type, 'low')
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
