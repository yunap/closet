import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

test('cross-flow architecture capture matches the reviewed deterministic baseline', () => {
  const script = path.join(process.cwd(), 'scratch', 'capture_cross_flow_architecture.js')
  const output = execFileSync(process.execPath, [script, '--check'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
  })
  assert.match(output, /Cross-flow architecture baseline matches/)
})

test('cross-flow architecture corpus covers every consolidation stage without provider calls', () => {
  const baseline = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), 'test', 'fixtures', 'cross_flow_architecture_baseline.json'),
    'utf8',
  ))
  assert.equal(baseline.schemaVersion, 3)
  assert.deepEqual(Object.keys(baseline.scenarios), ['casual_neutral', 'hot_hiking', 'capacity_pressure'])
  for (const scenario of Object.values(baseline.scenarios)) {
    assert.ok(scenario.context.intent)
    assert.ok(scenario.candidates.automaticUsePool.findingCounts)
    assert.ok(scenario.candidates.visualRoster.findingCounts)
    assert.ok(Array.isArray(scenario.candidates.visualRoster.recoveryEligibleIds))
    assert.deepEqual(Object.keys(scenario.candidates), [
      'trust',
      'automaticUsePool',
      'wholeWardrobeFilter',
      'visualRoster',
      'selectedPieceCandidates',
      'planWorkbench',
      'capsule',
    ])
    assert.deepEqual(
      scenario.candidates.automaticUsePool.eligibleIds,
      scenario.candidates.wholeWardrobeFilter.allowedIds,
      'shared pool must preserve whole-filter eligibility and hot-outerwear capacity',
    )
  }
  assert.deepEqual(baseline.validation.map(entry => entry.id), [
    'valid_separates',
    'missing_shoes',
    'two_shoes',
    'dependent_top_without_base',
    'dress_plus_top_unseen',
  ])
  assert.ok(baseline.recovery.selectedLocalFallback.length)
  assert.equal(baseline.recovery.planCompletion.completions.length, 1)

  const hot = baseline.scenarios.hot_hiking.candidates
  assert.deepEqual(hot.automaticUsePool.eligibleIds, hot.trust.allowedIds, 'shared pool must preserve the hard-gate verdict')
  assert.ok(hot.trust.allowedIds.includes(504), 'fixture must preserve the current trust-path unknown-metadata behavior')
  assert.match(hot.visualRoster.excluded['504'], /metadata missing: footwear comfort/)
  assert.ok(hot.planWorkbench.gateAllowedIds.includes(504), 'fixture must expose the current plan/visual unknown-metadata divergence')

  const capped = baseline.scenarios.capacity_pressure.candidates
  assert.equal(capped.visualRoster.cap.requested, 5)
  assert.ok(capped.visualRoster.cap.cutPieceIds.length)
  assert.equal(capped.visualRoster.slotCoverage.shoes, 0, 'fixture must exercise structural starvation under the small visual cap')
  assert.ok(capped.selectedPieceCandidates.some(entry => [501, 504].includes(entry.id)), 'selected strategy must retain a shoe under its independent cap')
})
