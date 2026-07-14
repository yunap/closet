// Step 8 — keyword pre-route retirement. The broad-planning (non-travel)
// pre-route is retired by default: work-week / capsule / event-weekend turns
// fall through to the model + plan_outfit_set instead of being precomposed by
// the keyword path. Travel/packing still precomposes until trip turns show the
// same self-routing.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-ask-gate-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const { shouldEngageAskPrecompose } = await import('../routes/ai.js')

test('broad-planning (non-travel) turns are retired from the pre-route by default', () => {
  // Capsule and work-week are broad-planning but not travel → the model owns them now.
  assert.equal(shouldEngageAskPrecompose('Help me build a 10-piece summer capsule from my wardrobe.'), false)
  assert.equal(shouldEngageAskPrecompose('Put together outfits for my work week, Thursday is client-facing.'), false)
})

test('travel/packing turns are now retired too — the model owns trips', () => {
  // Step 8 complete: a real trip self-routes to plan_outfit_set (model_only),
  // resolving weather from location, so the travel pre-route is retired as well.
  assert.equal(shouldEngageAskPrecompose('Help me pack for a 5-day trip to Lisbon.'), false)
  assert.equal(shouldEngageAskPrecompose('5 days in Paso Robles — wineries, a dinner, a hike, the coast.'), false)
})

test('non-planning turns never engage the pre-route', () => {
  assert.equal(shouldEngageAskPrecompose('What should I wear to dinner tonight?'), false)
  assert.equal(shouldEngageAskPrecompose(''), false)
})

test('the legacy pre-route (broad + travel) can be restored via the flag', () => {
  assert.equal(
    shouldEngageAskPrecompose('Help me build a 10-piece summer capsule.', '', { prerouteEnabled: true }),
    true,
    'with the flag on, broad-planning precomposes again'
  )
  assert.equal(
    shouldEngageAskPrecompose('Help me pack for a 5-day trip to Lisbon.', '', { prerouteEnabled: true }),
    true,
    'with the flag on, travel precomposes again'
  )
})
