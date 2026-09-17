// COMPOSER-ONLY EXPERIMENT capture integration (docs/stage1-cause-matrix-2026-09-14.md §4, §9). Drives the real
// /api/ai/generate-wardrobe-outfits-visual route under an experiment manifest through the REAL provider path —
// not the test response hook — with only the Gemini SDK request method stubbed, and proves the run produces one
// normalized, wire and output capture record under a single callId, exactly one composer call, and no downstream call.
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-only-capture-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')
// Deliberate opt-in, as in gemini_call_turn.test.js: the Gemini SDK request method is stubbed below and every
// non-loopback fetch is refused, so no network call can be made.
process.env.WARDROBE_ALLOW_TEST_PROVIDER_NETWORK = 'true'
process.env.GEMINI_API_KEY = 'test-key'
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''
process.env.STYLIST_PROVIDER_OVERRIDE = 'gemini'
process.env.STYLIST_MODEL_OVERRIDE = 'gemini-3.5-flash-lite'
process.env.PHOTO_PRESERVING_VISUALS = 'true'

const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = String(input?.url || input)
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error(`test: external fetch refused (${url})`)
  return realFetch(input, init)
}

const { GoogleGenAI } = await import('@google/genai')
const sdkRequests = []
let composerAnswer = null
Object.defineProperty(GoogleGenAI.prototype, 'interactions', {
  configurable: true,
  get() {
    return {
      create: async request => {
        sdkRequests.push(request)
        return { id: `interaction_${sdkRequests.length}`, status: 'completed',
          steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(composerAnswer) }] }],
          usage: { total_input_tokens: 10, total_output_tokens: 10 } }
      },
    }
  },
})

const { app, db, userUploadsDir } = await import('../server.js')
let server, baseUrl
before(async () => {
  delete globalThis.__WARDROBE_AI_TEST_HANDLER__
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  await new Promise(resolve => server.close(resolve))
  db.close()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

async function seedPiece({ name, category, color, occasions = ['casual'], fabric_weight = 'medium', length_hits_at = '' }) {
  fs.mkdirSync(userUploadsDir(), { recursive: true })
  const photo = `${category}-${Math.random().toString(36).slice(2)}.png`
  await sharp({ create: { width: 120, height: 160, channels: 3, background: color } }).png().toFile(path.join(userUploadsDir(), photo))
  return Number(db.prepare(`INSERT INTO pieces (name, category, colors, occasions, season, status, recommendation_status, fit_confidence, role_permission,
    occasion_permissions, photo, pattern_type, pattern_scale, pattern_complexity, reads_as, fabric_weight, fiber_content, formality, length_hits_at, style_profile_json)
    VALUES (?, ?, '[]', ?, 'year-round', 'active', 'trusted', 'high', 'auto', '[]', ?, 'solid', 'none', 'solid', ?, ?, '["cotton"]', 'everyday', ?, ?)`)
    .run(name, category, JSON.stringify(occasions), photo, `plain ${name}`, fabric_weight, length_hits_at, JSON.stringify({ garment_intelligence: { auto_use_trust: 'trusted' } })).lastInsertRowid)
}

test('COMPOSER-ONLY EXPERIMENT through the real provider path: one composer call, one callId across normalized, wire and output capture, nothing downstream', async () => {
  const top = await seedPiece({ name: 'black knit top', category: 'top', color: '#222222', length_hits_at: 'hip' })
  const bottom = await seedPiece({ name: 'dark jeans', category: 'bottom', color: '#1d2f45', length_hits_at: 'full-length' })
  const shoe = await seedPiece({ name: 'cream sneakers', category: 'shoes', color: '#e7dfd2' })
  await seedPiece({ name: 'gray jacket', category: 'outerwear', color: '#777777', length_hits_at: 'hip' })
  composerAnswer = { outfits: [{ label: 'Knit and denim', strength: 'strong', dominantDirection: 'easy', silhouette: 'column', bestFor: 'casual',
    base_top_id: top, bottom_id: bottom, dress_id: null, middle_layer_id: null, outer_layer_id: null, shoes_id: shoe,
    reason: 'test', styling_instructions: '', watchFor: 'none' }], skip: '', saveableLearning: '' }

  const captureDir = path.join(tmpRoot, 'capture')
  const manifestPath = path.join(tmpRoot, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify({ experiment: 'capture-integration', stopAfterComposer: true, garmentLine: 'complete', sleeveGuidance: 'neutral', holdOutComparisonSet: true, maxTokensForCount: 5 }))
  process.env.WARDROBE_CAPTURE_PROVIDER_INPUT_DIR = captureDir
  process.env.WARDROBE_EXPERIMENT_COMPOSER_MANIFEST = manifestPath
  let response, json
  try {
    response = await fetch(`${baseUrl}/api/ai/generate-wardrobe-outfits-visual`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ occasion: 'casual', season: 'fall', userWeather: { high_f: 65, low_f: 50 }, limit: 1, location: 'Test City', date: '2026-09-13' }),
    })
    json = await response.json()
  } finally {
    delete process.env.WARDROBE_CAPTURE_PROVIDER_INPUT_DIR
    delete process.env.WARDROBE_EXPERIMENT_COMPOSER_MANIFEST
  }

  assert.equal(response.status, 200, JSON.stringify(json))
  assert.ok(json.experimentComposerOnly, 'the experiment boundary returned the raw composer result')
  assert.equal(json.experimentComposerOnly.composerError, null)
  assert.deepEqual(json.experimentComposerOnly.raw, composerAnswer, 'the raw provider answer is preserved')
  assert.equal(sdkRequests.length, 1, 'exactly one provider request: the composer; no critic, repair or other call')

  const records = fs.readdirSync(captureDir).map(file => JSON.parse(fs.readFileSync(path.join(captureDir, file), 'utf8')))
  assert.deepEqual(records.map(r => r.stage).sort(), ['normalized', 'output', 'wire'], 'exactly one record per capture stage')
  assert.equal(new Set(records.map(r => r.callId)).size, 1, 'one shared callId')
  assert.match(records[0].callId, /^[0-9a-f]{12}$/)
  assert.ok(records.every(r => r.subflow === 'whole_wardrobe_visual_composer'), 'the only captured subflow is the composer')
  const index = stage => records.find(r => r.stage === stage).captureIndex
  assert.ok(index('normalized') < index('wire') && index('wire') < index('output'))
})
