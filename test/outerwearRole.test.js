import test from 'node:test'
import assert from 'node:assert/strict'

import { pieceOuterwearRole, OUTERWEAR_ROLE_VALUES, pieceWeatherProtection } from '../styling-engine/attributes.js'

// outerwear-weather-capability-spec.md — pieceOuterwearRole is the shared read point every
// future consumer must use instead of touching piece.outerwear_role directly: category-gated
// (only outerwear), and defensive against a stray/unrecognized stored value (an honest null,
// never a guess or a value from the wrong category leaking through).

test('pieceOuterwearRole reads the normalized value for an outerwear piece', () => {
  for (const role of OUTERWEAR_ROLE_VALUES) {
    assert.equal(pieceOuterwearRole({ category: 'outerwear', outerwear_role: role }), role)
  }
})

test('pieceOuterwearRole returns null for a non-outerwear category even if the field is set', () => {
  assert.equal(pieceOuterwearRole({ category: 'top', outerwear_role: 'cold_weather_outerwear' }), null)
})

test('pieceOuterwearRole returns null for unset outerwear', () => {
  assert.equal(pieceOuterwearRole({ category: 'outerwear' }), null)
  assert.equal(pieceOuterwearRole({ category: 'outerwear', outerwear_role: null }), null)
})

test('pieceOuterwearRole treats an unrecognized stored value as unknown, not a guess', () => {
  assert.equal(pieceOuterwearRole({ category: 'outerwear', outerwear_role: 'weatherproof' }), null)
})

// pieceWeatherProtection — a second, independent outerwear axis (docs/outerwear-weather-capability-spec.md
// §3): which specific hazard (rain/wind) a layer protects against, separate from outerwear_role.
// Same category-gating and defensive-normalization contract as pieceOuterwearRole, but returns an
// array (0-2 values) instead of a single enum, and an empty array is a legitimate answer, not "unknown."

test('pieceWeatherProtection reads the normalized array for an outerwear piece', () => {
  assert.deepEqual(pieceWeatherProtection({ category: 'outerwear', weather_protection: ['wind'] }), ['wind'])
  assert.deepEqual(pieceWeatherProtection({ category: 'outerwear', weather_protection: ['rain'] }), ['rain'])
  assert.deepEqual(pieceWeatherProtection({ category: 'outerwear', weather_protection: ['rain', 'wind'] }), ['rain', 'wind'])
})

test('pieceWeatherProtection returns an empty array for a non-outerwear category even if the field is set', () => {
  assert.deepEqual(pieceWeatherProtection({ category: 'top', weather_protection: ['rain', 'wind'] }), [])
})

test('pieceWeatherProtection returns an empty array for unset or empty outerwear — a legitimate answer, not a guess', () => {
  assert.deepEqual(pieceWeatherProtection({ category: 'outerwear' }), [])
  assert.deepEqual(pieceWeatherProtection({ category: 'outerwear', weather_protection: [] }), [])
})

test('pieceWeatherProtection drops unrecognized values instead of trusting stray stored data', () => {
  assert.deepEqual(pieceWeatherProtection({ category: 'outerwear', weather_protection: ['rain', 'waterproof'] }), ['rain'])
})

test('pieceWeatherProtection is defensive against non-array stored data', () => {
  assert.deepEqual(pieceWeatherProtection({ category: 'outerwear', weather_protection: 'rain' }), [])
  assert.deepEqual(pieceWeatherProtection({ category: 'outerwear', weather_protection: null }), [])
})
