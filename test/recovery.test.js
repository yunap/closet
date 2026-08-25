import test from 'node:test'
import assert from 'node:assert/strict'

import {
  discloseRecoveryShortfall,
  validatedComplete,
  validatedFallback,
  validatedSubstitute,
} from '../styling-engine/recovery.js'

const validateThreeSlots = value => ({
  valid: ['top', 'bottom', 'shoes'].every(group => value.includes(group)),
  reason: 'incomplete',
})

test('validated substitute skips invalid mutations and returns the first validator-approved result', () => {
  const result = validatedSubstitute({
    subject: ['top', 'bottom', 'shoes'],
    target: 'shoes',
    candidates: ['dress', 'shoes'],
    mutate: (subject, candidate, target) => subject.map(value => value === target ? candidate : value),
    validate: validateThreeSlots,
  })

  assert.equal(result.status, 'recovered')
  assert.deepEqual(result.value, ['top', 'bottom', 'shoes'])
  assert.deepEqual(result.report.attempts.map(attempt => attempt.accepted), [false, true])
})

test('validated completion never returns an invalid addition', () => {
  const result = validatedComplete({
    subject: ['top', 'bottom'],
    candidates: ['dress', 'shoes'],
    mutate: (subject, candidate) => [...subject, candidate],
    validate: validateThreeSlots,
  })

  assert.equal(result.status, 'recovered')
  assert.deepEqual(result.value, ['top', 'bottom', 'shoes'])
})

test('validated fallback can return a valid partial set with an explicit remaining shortfall', () => {
  const result = validatedFallback({
    candidates: [['top'], ['top', 'bottom', 'shoes']],
    validate: validateThreeSlots,
    limit: 2,
  })

  assert.equal(result.status, 'recovered')
  assert.deepEqual(result.values, [['top', 'bottom', 'shoes']])
  assert.equal(result.report.code, 'recovery_shortfall')
  assert.equal(result.report.remainingCount, 1)
})

test('shortfall disclosure uses one stable machine-readable shape', () => {
  assert.deepEqual(discloseRecoveryShortfall({
    operation: 'complete',
    requestedCount: 2,
    recoveredCount: 1,
    reason: 'wardrobe_supply_exhausted',
    context: { slotId: 'dinner' },
  }), {
    code: 'recovery_shortfall',
    operation: 'complete',
    reason: 'wardrobe_supply_exhausted',
    requestedCount: 2,
    recoveredCount: 1,
    remainingCount: 1,
    attempts: [],
    context: { slotId: 'dinner' },
    message: 'Could not validate 1 result through complete.',
  })
})
