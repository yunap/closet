import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-at-cap-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')

const { db } = await import('../db.js')

function insertPiece({
  name,
  category,
  photo = 'img.jpg',
  fabric_weight = 'light',
  style_profile_json = {},
  fiber_content = ['cotton']
}) {
  return db.prepare(`
    INSERT INTO pieces (name, category, colors, occasions, status, photo, fabric_weight, style_profile_json, fiber_content)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    category,
    '[]',
    '["casual"]',
    'active',
    photo,
    fabric_weight,
    JSON.stringify(style_profile_json),
    JSON.stringify(fiber_content)
  ).lastInsertRowid
}

function insertOutfit(name, pieceIds) {
  const outfitId = db.prepare(`
    INSERT INTO outfits (name, occasion, season, status)
    VALUES (?, ?, ?, ?)
  `).run(name, 'casual', 'year-round', 'confirmed').lastInsertRowid
  for (const pieceId of pieceIds) {
    db.prepare('INSERT INTO outfit_pieces (outfit_id, piece_id) VALUES (?, ?)').run(outfitId, pieceId)
  }
  return outfitId
}

test('recall_at_cap replay classifies full recall, gate miss, and cap miss', async () => {
  const fullTop = insertPiece({ name: 'Full Recall Top', category: 'top' })
  const fullBottom = insertPiece({ name: 'Full Recall Bottom', category: 'bottom' })
  insertOutfit('Full Recall Outfit', [fullTop, fullBottom])

  const gateTop = insertPiece({ name: 'Gate Outfit Top', category: 'top' })
  const gateAccessory = insertPiece({ name: 'Gate Outfit Necklace', category: 'accessory' })
  insertOutfit('Gate Miss Outfit', [gateTop, gateAccessory])

  const capBottom = insertPiece({ name: 'Cap Outfit Bottom', category: 'bottom' })
  let capTop = null
  const confirmedCompetingTops = []
  for (let i = 1; i <= 98; i++) {
    const id = insertPiece({ name: `Cap Pool Top ${i}`, category: 'top' })
    if (i <= 30) confirmedCompetingTops.push(id)
    if (i === 98) capTop = id
  }
  for (const id of confirmedCompetingTops) {
    insertOutfit(`Competing Top History ${id}`, [id, capBottom])
  }
  db.prepare(`
    INSERT INTO stylist_feedback (feedback_type, context_type, context_id, context_name, payload)
    VALUES (?, ?, ?, ?, ?)
  `).run('not_me', 'piece', capTop, 'Cap Pool Top 98', '{}')
  insertOutfit('Cap Miss Outfit', [capTop, capBottom])

  await import(`../scratch/recall_at_cap.js?smoke=${Date.now()}`)
  const report = JSON.parse(fs.readFileSync('scratch/recall_at_cap_report.json', 'utf8'))
  const misses = Object.values(report.flows).flatMap(flow => flow.misses)

  assert.ok(!misses.some(miss => miss.outfitName === 'Full Recall Outfit'))
  assert.ok(misses.some(miss => miss.outfitName === 'Gate Miss Outfit' && miss.layer === 'gate'))
  assert.ok(misses.some(miss => miss.outfitName === 'Cap Miss Outfit' && miss.layer === 'cap'))
})

test.after(() => {
  db.close()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})
