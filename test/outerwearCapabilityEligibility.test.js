import test from 'node:test'
import assert from 'node:assert'
import { evaluateAutomaticUsePiecePool } from '../styling-engine/eligibility.js'

// Slice C of docs/outerwear-weather-consolidation-spec.md, and specifically its [A2] boundary:
// capability is EVIDENCE carried by the canonical per-piece eligibility owner, and can never be
// the reason a piece leaves the candidate pool. These tests exist to fail loudly if a later change
// promotes capability into a gate.

const outer = (id, name, extra) => ({
  id, name, category: 'outerwear', photo: `${id}.jpg`, colors: ['black'],
  occasions: ['casual'], season: 'all', ...extra,
})

const INDOOR_CARDIGAN = outer(1, 'cashmere cardigan', { outerwear_role: 'indoor_layer', fabric_weight: 'heavy', weather_protection: [] })
const RAIN_SHELL = outer(2, 'rain shell', { outerwear_role: 'protective_shell', fabric_weight: 'light', weather_protection: ['rain'] })
const WINTER_COAT = outer(3, 'wool coat', { outerwear_role: 'cold_weather_outerwear', fabric_weight: 'heavy', weather_protection: [] })
const UNTAGGED = outer(4, 'unlined jacket', { fabric_weight: 'heavy' })
const A_TOP = { id: 5, name: 'silk tee', category: 'top', photo: '5.jpg', colors: ['white'], occasions: ['casual'], season: 'all' }

const PIECES = [INDOOR_CARDIGAN, RAIN_SHELL, WINTER_COAT, UNTAGGED, A_TOP]

const poolFor = (context = {}) => evaluateAutomaticUsePiecePool({
  pieces: PIECES,
  context: { occasion: 'casual', ...context },
})

test('every decision carries canonical outerwear capability facts', () => {
  const byId = poolFor().decisionsById
  assert.deepEqual(byId.get(1).capability, { outerwearRole: 'indoor_layer', weatherProtection: [], capabilityTagged: true })
  assert.deepEqual(byId.get(2).capability, { outerwearRole: 'protective_shell', weatherProtection: ['rain'], capabilityTagged: true })
  assert.deepEqual(byId.get(3).capability, { outerwearRole: 'cold_weather_outerwear', weatherProtection: [], capabilityTagged: true })
})

test('an untagged outerwear piece reports unknown capability, not an absent one', () => {
  const capability = poolFor().decisionsById.get(4).capability
  assert.equal(capability.outerwearRole, null)
  assert.equal(capability.capabilityTagged, false)
})

test('a non-outerwear piece reports empty capability through the same category gate', () => {
  const capability = poolFor().decisionsById.get(5).capability
  assert.deepEqual(capability, { outerwearRole: null, weatherProtection: [], capabilityTagged: false })
})

// --- the [A2] boundary --------------------------------------------------------------------

test('capability never excludes a piece from the pool, in any weather', () => {
  // The indoor cardigan cannot serve as outdoor outerwear and the shell cannot warm anyone on its
  // own. Both must still be offered to the composer: layered systems are built from pieces that
  // are individually insufficient.
  for (const weatherProfile of [{}, { isCold: true }, { isCold: true, isColdSevere: true }]) {
    const pool = poolFor({ weatherProfile })
    const eligibleIds = pool.eligibleIds
    for (const id of [1, 2, 3, 4]) {
      assert.ok(eligibleIds.has(id), `piece ${id} must stay eligible under ${JSON.stringify(weatherProfile)}`)
    }
  }
})

test('capability contributes no findings at all — the findings stream is unchanged', () => {
  const pool = poolFor({ weatherProfile: { isCold: true, isColdSevere: true } })
  const capabilityish = pool.findings.filter(f => /outerwear_role|weather_protection|capability|indoor_layer|protective_shell/.test(f.code))
  assert.deepEqual(capabilityish, [], 'Slice C attaches facts, not findings; Contract C owns verdicts')
})

test('capability facts do not appear in the excluded projections', () => {
  const pool = poolFor({ weatherProfile: { isCold: true, isColdSevere: true } })
  for (const excluded of pool.excludedPieces) {
    for (const reason of excluded.reasons) {
      assert.ok(!/outerwear_role|capability|indoor_layer/.test(reason), `unexpected capability rejection: ${reason}`)
    }
  }
})
