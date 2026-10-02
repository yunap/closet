// thread_1789546295700 (2026-09-16, owner review): a composer timeout produced zero model-composed
// cards, yet the route still ran the missing-layer repair pass (which itself then timed out, a
// second wasted paid call) and `generate_outfits` still reported `status: "success"` for a set that
// was 100% local-fill. This regression proves the two structural corrections directly against
// `generateWholeWardrobeOutfitsVisualInternal`:
//   1. When the composer call rejects with a timeout-classified error and zero outfits, the repair
//      pass must never even attempt a provider call — `layerRepair.attempted` stays false and its
//      `reason` names the skip explicitly.
//   2. The mock AI handler must be invoked exactly once (the composer's own failed attempt) — no
//      second call for repair, no third call for the clash critic reached through a local-fill card.
process.env.NODE_ENV = 'test'
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-composer-timeout-'))
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')

const { db, userUploadsDir } = await import('../server.js')
const { generateWholeWardrobeOutfitsVisualInternal } = await import('../routes/ai.js')

async function makeImage(filename, color = '#333333') {
  if (!fs.existsSync(userUploadsDir())) fs.mkdirSync(userUploadsDir(), { recursive: true })
  const filePath = path.join(userUploadsDir(), filename)
  await sharp({ create: { width: 120, height: 160, channels: 3, background: color } }).png().toFile(filePath)
  return filename
}

test('a zero-model-card composer timeout skips repair entirely and never claims success', async () => {
  const topPhoto = await makeImage('to_top.png', '#222222')
  const bottomPhoto = await makeImage('to_bottom.png', '#444444')
  const shoesPhoto = await makeImage('to_shoes.png', '#111111')
  const cardiganPhoto = await makeImage('to_cardigan.png', '#666666')

  db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as, fabric_weight, fiber_content, style_profile_json, formality)
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, 'everyday')
  `).run('Cotton Crewneck Top', 'top', JSON.stringify(['black']), topPhoto, 'quiet dark neutral top', 'light', '["cotton"]', '{"coverage":"normal","bareness":"normal"}')

  db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as, fabric_weight, fiber_content, style_profile_json, formality)
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, 'everyday')
  `).run('Straight Chino Pants', 'bottom', JSON.stringify(['navy']), bottomPhoto, 'classic navy chinos', 'medium', '["cotton"]', '{"coverage":"normal","bareness":"normal"}')

  db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as, walk_support, heel_height, formality)
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, 'everyday')
  `).run('Leather Derby Shoes', 'shoes', JSON.stringify(['brown']), shoesPhoto, 'supportive leather derbies', 'medium', 'flat')

  // A legitimate, weather-qualifying candidate layer — present so that, had the OLD code reached the
  // repair pass, it would have had something real to call the model about. Proving it is never
  // called (not merely that it had nothing to work with) is the point of this test.
  db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as, fabric_weight, fiber_content, style_profile_json, formality)
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, 'everyday')
  `).run('Light Cardigan', 'outerwear', JSON.stringify(['grey']), cardiganPhoto, 'lightweight grey cardigan', 'light', '["cotton"]', '{"coverage":"normal","bareness":"normal"}')

  let handlerCalls = 0
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = () => {
    handlerCalls++
    // Simulates askStylistStructuredWithUsage's provider branch rejecting the way withTimeout's own
    // timeout path does — the downstream code only inspects err.isTimeout, so this exercises the
    // exact same classification/skip logic without waiting out a real 120s timer.
    const err = new Error('Visual wardrobe composer timed out after 120000ms')
    err.isTimeout = true
    throw err
  }

  try {
    const result = await generateWholeWardrobeOutfitsVisualInternal({
      occasion: 'casual',
      season: 'current season',
      limit: 3,
      userWeather: { high_f: 52, low_f: 45 },
    })

    assert.equal(handlerCalls, 1,
      `exactly one provider call must happen (the composer's own failed attempt) — got ${handlerCalls}, meaning repair or the clash critic also ran`)

    assert.equal(result.debug.composerErrorIsTimeout, true, 'the composer failure must be classified as a timeout')
    assert.equal(result.debug.aiReturnedCount, 0, 'the composer produced zero model-composed outfits')

    const layerRepair = result.debug.finalSelection?.layerRepair
    assert.equal(layerRepair?.attempted, false,
      'repair must never be attempted against a set with zero model-composed cards')
    assert.match(layerRepair?.reason || '', /skipped: composer returned zero model-composed outfits/)

    // Whatever cards local-fill assembled (if any) must be marked as engine-assembled, never as
    // model styling, so a caller cannot present them as a completed stylist result.
    for (const outfit of result.structuredOutfits) {
      assert.equal(outfit.composedBy, 'engine', `every delivered card must be composedBy 'engine' when the composer produced nothing: ${outfit.label}`)
    }
  } finally {
    delete globalThis.__WARDROBE_AI_TEST_HANDLER__
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch {}
  }
})
