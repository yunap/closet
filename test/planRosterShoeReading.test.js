// The plan shortlist chooses shoes from what each shoe is (2026-10-30, guests-at-home rerun): "olive suede slip-on
// shoes", type slip_on, was chosen as "effortless indoor wear"; its own reads_as is "olive suede sneakers". With the
// wording and reads_as alone it chose worn boat shoes next; with a photo of each shoe, light step-in shoes.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-shoe-reading-'))
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tmpRoot, 'uploads')
process.env.WARDROBE_SYSTEM_DB_PATH = path.join(tmpRoot, 'system.db')
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const { tripRosterSelectionUserText, tripRosterSelectionSystemPrompt } = await import('../routes/ai.js')

const bench = [
  { id: 195, name: 'olive suede slip-on shoes', category: 'shoes', shoe_type: 'slip_on', reads_as: 'olive suede sneakers', occasions: ['casual'] },
  { id: 1, name: 'Whale stripe tee', category: 'top', reads_as: 'nautical stripe tee with whale graphic', occasions: ['casual'] },
]

test("a shoe's candidate line says what it reads as; other garments' lines are unchanged", () => {
  const text = tripRosterSelectionUserText({ bench, slots: [], dateRange: {}, planKind: 'coordinated_plan' })
  assert.match(text.split('\n').find(line => line.startsWith('#195 ')), / \| reads as: olive suede sneakers/)
  assert.doesNotMatch(text.split('\n').find(line => line.startsWith('#1 ')), /reads as/)
})

test('the shortlist is asked to choose shoes from the shoe itself and to say why', () => {
  for (const planKind of ['coordinated_plan', 'trip']) {
    const prompt = tripRosterSelectionSystemPrompt({ planKind })
    assert.match(prompt, /Picture the shoes on the feet through the use case's moments/)
    assert.match(prompt, /not its name or category alone/)
    assert.match(prompt, /For shoes, say why that pair suits those moments, from the shoe itself\./)
  }
})

test('a plan shortlist attaches a photo of each shoe candidate and of nothing else', async () => {
  const sharp = (await import('sharp')).default
  const { userUploadsDir } = await import('../db.js')
  const { choosePlanRosterWithProvider } = await import('../routes/ai.js')
  for (const file of ['shoe.png', 'top.png']) {
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#888' } }).png().toFile(path.join(userUploadsDir(), file))
  }
  let sent = null
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = request => {
    sent = request
    return JSON.stringify({ roster_piece_ids: [195], packing_reasoning: '', piece_jobs: [{ piece_id: 195, job: 'x' }], repair_changes: [] })
  }
  try {
    await choosePlanRosterWithProvider({
      bench: [{ ...bench[0], photo: 'shoe.png' }, { ...bench[1], photo: 'top.png' }],
      slots: [], dateRange: {}, attempt: 1, failures: [], previousRosterIds: [],
    }, {})
  } finally {
    delete globalThis.__WARDROBE_AI_TEST_HANDLER__
  }
  const parts = sent.messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
  assert.equal(parts.filter(part => part.type === 'image').length, 1)
  assert.ok(parts.some(part => part.type === 'text' && part.text === 'ID 195: olive suede slip-on shoes'))
  assert.ok(!parts.some(part => part.type === 'text' && part.text === 'ID 1: Whale stripe tee'))
})
