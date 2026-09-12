import test from 'node:test'
import assert from 'node:assert/strict'
import { serializeTripRequirementSlot, restoreTripRequirementSlot } from '../styling-engine/outfitSetPlanner.js'

test('coldPresenceRequirement round-trips through serializeTripRequirementSlot and restoreTripRequirementSlot', () => {
  const coldVerdict = {
    state: 'recommended',
    applies: false,
    evidence: { wakingLowF: 48, wakingHighF: 62, exertion: 'low', exposureMode: 'outdoor' },
    rationale: 'ordinary cool/cold exposure with unknown duration',
  }

  const slot = {
    id: 'slot_1',
    label: 'Coastal Exploration',
    occasion: 'casual',
    activity: 'walking',
    weatherProfile: {
      isCold: true,
      highF: 62,
      lowF: 48,
      coldPresenceRequirement: coldVerdict,
    },
  }

  const serialized = serializeTripRequirementSlot(slot)
  assert.deepEqual(serialized.weatherProfile.coldPresenceRequirement, coldVerdict, 'coldPresenceRequirement preserved in serialized payload')

  const restored = restoreTripRequirementSlot(serialized)
  assert.deepEqual(restored.weatherProfile.coldPresenceRequirement, coldVerdict, 'coldPresenceRequirement restored verbatim')
  assert.deepEqual(restored.stylingContext.weatherProfile.coldPresenceRequirement, coldVerdict, 'coldPresenceRequirement populated on restored stylingContext')
})
