process.env.NODE_ENV = 'test'
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-visual-batch-'))
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')

const { db, userUploadsDir } = await import('../server.js')
const { generateWholeWardrobeOutfitsVisualInternal } = await import('../routes/ai.js')

async function makeImage(filename, color = '#333333') {
  if (!fs.existsSync(userUploadsDir())) fs.mkdirSync(userUploadsDir(), { recursive: true })
  const filePath = path.join(userUploadsDir(), filename)
  await sharp({
    create: { width: 120, height: 160, channels: 3, background: color }
  }).png().toFile(filePath)
  return filename
}

test('visual composer batch delivery: delivers all requested structurally valid outfits without batch thermal dropping', async () => {
  const topPhoto = await makeImage('batch_top.png', '#222222')
  const bottomPhoto = await makeImage('batch_bottom.png', '#444444')
  const shoesPhoto = await makeImage('batch_shoes.png', '#111111')
  const lightPhoto = await makeImage('batch_light_layer.png', '#666666')
  const midPhoto = await makeImage('batch_mid_jacket.png', '#555555')
  const heavyPhoto = await makeImage('batch_heavy_coat.png', '#333333')

  const topId = db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as, fabric_weight, fiber_content, style_profile_json, formality)
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, 'everyday')
  `).run('Cotton Crewneck Top', 'top', JSON.stringify(['black']), topPhoto, 'quiet dark neutral top', 'light', '["cotton"]', '{"coverage":"normal","bareness":"normal"}').lastInsertRowid

  const bottomId = db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as, fabric_weight, fiber_content, style_profile_json, formality)
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, 'everyday')
  `).run('Straight Chino Pants', 'bottom', JSON.stringify(['navy']), bottomPhoto, 'classic navy chinos', 'medium', '["cotton"]', '{"coverage":"normal","bareness":"normal"}').lastInsertRowid

  const shoesId = db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as, walk_support, heel_height, formality)
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, 'everyday')
  `).run('Leather Derby Shoes', 'shoes', JSON.stringify(['brown']), shoesPhoto, 'supportive leather derbies', 'medium', 'flat').lastInsertRowid

  const lightLayerId = db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as, fabric_weight, fiber_content, style_profile_json, formality)
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, 'everyday')
  `).run('Linen Overshirt', 'outerwear', JSON.stringify(['olive']), lightPhoto, 'lightweight linen overshirt', 'light', '["linen"]', '{"coverage":"normal","bareness":"normal"}').lastInsertRowid

  const midJacketId = db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as, fabric_weight, fiber_content, style_profile_json, formality)
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, 'everyday')
  `).run('Denim Work Jacket', 'outerwear', JSON.stringify(['blue']), midPhoto, 'midweight denim work jacket', 'medium', '["cotton"]', '{"coverage":"normal","bareness":"normal"}').lastInsertRowid

  const heavyCoatId = db.prepare(`
    INSERT INTO pieces (name, category, status, colors, photo, reads_as, fabric_weight, fiber_content, style_profile_json, formality)
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, 'everyday')
  `).run('Wool Overcoat', 'outerwear', JSON.stringify(['charcoal']), heavyPhoto, 'heavy tailored wool overcoat', 'heavy', '["wool"]', '{"coverage":"high","bareness":"low"}').lastInsertRowid

  // Mock AI handler returning 3 structurally valid outfits across varying thermal weights:
  // Look 1: light layer (lightweight overshirt)
  // Look 2: midweight jacket
  // Look 3: heavy wool overcoat
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = () => {
    return {
      outfits: [
        {
          id: 'look_1',
          label: 'Light Layer Look',
          strength: 'strong',
          dominantDirection: 'clean casual',
          silhouette: 'relaxed',
          bestFor: 'casual',
          pieceIds: [topId, bottomId, shoesId, lightLayerId],
          pieces: [
            { id: topId, name: 'Cotton Crewneck Top', category: 'top' },
            { id: bottomId, name: 'Straight Chino Pants', category: 'bottom' },
            { id: shoesId, name: 'Leather Derby Shoes', category: 'shoes' },
            { id: lightLayerId, name: 'Linen Overshirt', category: 'outerwear' },
          ]
        },
        {
          id: 'look_2',
          label: 'Midweight Jacket Look',
          strength: 'strong',
          dominantDirection: 'workwear structure',
          silhouette: 'straight',
          bestFor: 'casual',
          pieceIds: [topId, bottomId, shoesId, midJacketId],
          pieces: [
            { id: topId, name: 'Cotton Crewneck Top', category: 'top' },
            { id: bottomId, name: 'Straight Chino Pants', category: 'bottom' },
            { id: shoesId, name: 'Leather Derby Shoes', category: 'shoes' },
            { id: midJacketId, name: 'Denim Work Jacket', category: 'outerwear' },
          ]
        },
        {
          id: 'look_3',
          label: 'Warm Overcoat Look',
          strength: 'strong',
          dominantDirection: 'grounded tailored warmth',
          silhouette: 'column',
          bestFor: 'casual',
          pieceIds: [topId, bottomId, shoesId, heavyCoatId],
          pieces: [
            { id: topId, name: 'Cotton Crewneck Top', category: 'top' },
            { id: bottomId, name: 'Straight Chino Pants', category: 'bottom' },
            { id: shoesId, name: 'Leather Derby Shoes', category: 'shoes' },
            { id: heavyCoatId, name: 'Wool Overcoat', category: 'outerwear' },
          ]
        },
      ]
    }
  }

  try {
    const result = await generateWholeWardrobeOutfitsVisualInternal({
      occasion: 'casual',
      season: 'current season',
      limit: 3,
      userWeather: { high_f: 52, low_f: 45 },
    })

    assert.ok(result, 'Result should be returned from visual composer')
    const deliveredOutfits = result.structuredOutfits || []
    assert.equal(deliveredOutfits.length, 3, 'All 3 requested outfits must be delivered without batch thermal dropping')
    assert.equal(deliveredOutfits[0].label, 'Light Layer Look')
    assert.equal(deliveredOutfits[1].label, 'Midweight Jacket Look')
    assert.equal(deliveredOutfits[2].label, 'Warm Overcoat Look')

    // Confirm that differing outerwear pieces across all 3 thermal weights are present
    const deliveredOuterwearIds = deliveredOutfits.map(outfit =>
      (outfit.pieces || []).find(p => p.category === 'outerwear')?.id
    )
    assert.deepEqual(deliveredOuterwearIds, [Number(lightLayerId), Number(midJacketId), Number(heavyCoatId)])
  } finally {
    delete globalThis.__WARDROBE_AI_TEST_HANDLER__
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    } catch {}
  }
})

