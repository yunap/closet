// thread_1792915678690: both visual composers validated cards against garments trimmed to identity
// and photos, so every check that reads a garment fact passed on nothing. A sheer crochet top tagged
// needs_base shipped as the only top under a knit layer. The shared evaluator now sees full records.
process.env.NODE_ENV = 'test'
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-full-garment-validation-'))
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')

const { db, userUploadsDir } = await import('../server.js')
const { generateWholeWardrobeOutfitsVisualInternal, generateOutfitsForPieceInternal } = await import('../routes/ai.js')

test.after(() => {
  delete globalThis.__WARDROBE_AI_TEST_HANDLER__
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

async function insert(name, category, extra = {}) {
  if (!fs.existsSync(userUploadsDir())) fs.mkdirSync(userUploadsDir(), { recursive: true })
  const photo = `${name.replace(/\W+/g, '_')}.png`
  await sharp({ create: { width: 120, height: 160, channels: 3, background: '#776655' } }).png().toFile(path.join(userUploadsDir(), photo))
  const row = { name, category, status: 'active', colors: '["cream"]', photo, formality: 'everyday', occasions: '["casual","city"]', season: 'year-round', ...extra }
  const keys = Object.keys(row)
  return Number(db.prepare(`INSERT INTO pieces (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map(key => row[key])).lastInsertRowid)
}

const knit = await insert('patchwork knit buttoned top', 'outerwear', { outerwear_role: 'indoor_layer', fabric_weight: 'medium', fit_on_body: 'hangs_straight', sleeve_length: '3/4', sleeve_shape: 'voluminous' })
const crochet = await insert('cream crochet top', 'top', { needs_base: 'yes', opacity: 'open_weave', fit_on_body: 'clings_drapey', sleeve_length: 'sleeveless', fabric_weight: 'light' })
const shell = await insert('cream wool shell', 'top', { opacity: 'opaque', fit_on_body: 'clings_drapey', sleeve_length: 'sleeveless', fabric_weight: 'medium' })
const pants = await insert('emerald green corduroy straight pants', 'bottom', { fabric_weight: 'medium' })
const clogs = await insert('brown stitched leather clogs', 'shoes', { heel_height: 'low', walk_support: 'medium' })

const card = (label, baseTopId) => ({
  layering_check: 'top inside the knit', label, strength: 'strong', dominantDirection: 'x', silhouette: 'x', bestFor: 'casual',
  base_top_name: baseTopId === crochet ? 'cream crochet top' : 'cream wool shell', base_top_id: baseTopId,
  bottom_name: 'emerald green corduroy straight pants', bottom_id: pants,
  dress_name: null, dress_id: null, middle_layer_name: null, middle_layer_id: null,
  outer_layer_name: 'patchwork knit buttoned top', outer_layer_id: knit,
  shoes_name: 'brown stitched leather clogs', shoes_id: clogs,
  reason: 'fixture', styling_instructions: '', watchFor: 'none',
})
function answerWith(outfits) {
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = ({ system }) => {
    if (String(system).includes('choosing which garments from a client')) {
      return { selection_note: 'all', roster_piece_ids: [crochet, shell, pants, clogs] }
    }
    return { outfits, skip: '', saveableLearning: '' }
  }
}

test('selected-piece composer: a needs_base top as the only top under the layer is Needs review; an opaque shell passes', async () => {
  answerWith([card('Crochet Under Knit', crochet), card('Shell Under Knit', shell), card('Shell Again', shell)])
  const result = await generateOutfitsForPieceInternal({ pieceId: knit, occasion: 'casual', season: 'current season' })
  const crochetCard = result.structuredOutfits.find(outfit => outfit.label === 'Crochet Under Knit')
  assert.equal(crochetCard.strength, 'needs review')
  assert.match(crochetCard.rejectionReason, /cream crochet top cannot be worn alone/)
  assert.ok(!result.structuredOutfits.find(outfit => outfit.label === 'Shell Under Knit').broken)
})

// Whole Wardrobe already caught this card in a later pass that restores full records; this guards
// that it stays caught now that its first validation reads full records too.
test('Whole Wardrobe composer: the same card is rejected, not delivered', async () => {
  answerWith([card('Crochet Under Knit', crochet), card('Shell Under Knit', shell)])
  const result = await generateWholeWardrobeOutfitsVisualInternal({ occasion: 'casual', season: 'current season', limit: 2 })
  const delivered = (result.structuredOutfits || []).filter(outfit => !outfit.broken && !outfit.diagnosticOnly).map(outfit => outfit.label)
  assert.ok(delivered.includes('Shell Under Knit'), JSON.stringify(delivered))
  assert.ok(!delivered.includes('Crochet Under Knit'), 'the needs_base top under the layer is not delivered')
})
