// docs/composer-slot-name-check-spec.md: each composer slot carries the garment's stated name, so a
// wrong ID is caught. Live thread_1792867254713: card 2's label, reason, styling instructions and
// layering_check all described the gradient floral cashmere sweater (996870) while middle_layer_id
// held 996890, the striped sweater next to it — and the owner judged the delivered card unwearable.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-slot-name-check-'))
const uploads = path.join(tmpRoot, 'uploads')
fs.mkdirSync(uploads, { recursive: true })
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = uploads
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const { resolveComposerSlotOutfit, statedNameFitsGarment, composerNameMismatches } = await import('../styling-engine/composerSlots.js')
const { generateOutfitsForPieceInternal } = await import('../routes/ai.js')
const { ensureFixturePieces } = await import('./helpers/dbFixtures.js')

const common = { status: 'active', occasions: '["casual"]', formality: 'everyday' }
const rows = [
  { id: 820106, name: 'black flare leg denim pants', category: 'bottom', fabric_weight: 'medium', ...common },
  { id: 820144, name: 'black turtleneck', category: 'top', fabric_weight: 'medium', ...common },
  { id: 820870, name: 'gradient floral print drop-shoulder cashmere sweater', category: 'top', fabric_weight: 'medium', ...common },
  { id: 820890, name: 'navy and cream striped knit sweater', category: 'top', fabric_weight: 'medium', ...common },
  { id: 820196, name: 'black slip-on loafers', category: 'shoes', heel_height: 'flat', walk_support: 'high', ...common },
]
for (const row of rows) {
  row.photo = `fixture-${row.id}.jpg`
  await sharp({ create: { width: 24, height: 32, channels: 3, background: '#556677' } }).jpeg().toFile(path.join(uploads, row.photo))
}
const cleanupFixtures = ensureFixturePieces(rows)
test.after(() => {
  cleanupFixtures()
  delete globalThis.__WARDROBE_AI_TEST_HANDLER__
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

const byId = Object.fromEntries(rows.map(row => [row.id, row]))
const card = (middleName, middleId, label = 'Artisan Gradient Layer') => ({
  layering_check: `the black turtleneck sits under the relaxed gradient cashmere sweater (id ${middleId})`,
  label, strength: 'strong', dominantDirection: 'artisan', silhouette: 'layered knit', bestFor: 'city',
  base_top_name: 'black turtleneck', base_top_id: 820144,
  bottom_name: 'black flare leg denim pants', bottom_id: 820106,
  dress_name: null, dress_id: null,
  middle_layer_name: middleName, middle_layer_id: middleId,
  outer_layer_name: null, outer_layer_id: null,
  shoes_name: 'black slip-on loafers', shoes_id: 820196,
  reason: 'The gradient print sweater breaks up the black column.', styling_instructions: 'Layer the gradient cashmere sweater over the turtleneck.', watchFor: 'none',
})

test('name check: an exact, a shortened or an empty name passes; another garment\'s name is a hard finding naming the garment it fits', () => {
  assert.equal(statedNameFitsGarment('gradient floral print drop-shoulder cashmere sweater', byId[820870]), true)
  assert.equal(statedNameFitsGarment('Gradient cashmere sweater', byId[820870]), true)
  assert.equal(statedNameFitsGarment('', byId[820890]), true)
  assert.equal(statedNameFitsGarment('gradient cashmere sweater', byId[820890]), false)

  assert.deepEqual(resolveComposerSlotOutfit(card('gradient cashmere sweater', 820870), rows).slotFindings, [])
  assert.deepEqual(resolveComposerSlotOutfit(card(null, 820890), rows).slotFindings, [], 'no stated name, nothing to check')

  const { slotFindings, pieceIds } = resolveComposerSlotOutfit(card('gradient floral print drop-shoulder cashmere sweater', 820890), rows)
  assert.deepEqual(pieceIds.sort(), [820106, 820144, 820196, 820890].sort(), 'the ID is never swapped for the one the name fits')
  assert.equal(slotFindings.length, 1)
  assert.equal(slotFindings[0].code, 'slot_name_mismatch')
  assert.equal(slotFindings[0].severity, 'hard')
  assert.deepEqual(slotFindings[0].evidence, {
    slot: 'middle_layer_id', pieceId: 820890,
    statedName: 'gradient floral print drop-shoulder cashmere sweater', recordedName: 'navy and cream striped knit sweater',
    statedNameFitsPieceId: 820870,
  })
})

// Answers: the roster call takes every catalog garment; the composer's first answer is the
// incident's card plus a clean one; `correction` decides the correction call's answer.
function installHandler(correction) {
  const calls = { composer: 0, correction: [] }
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = ({ system, messages }) => {
    const parts = messages?.[0]?.content || []
    const text = Array.isArray(parts) ? parts.map(part => part?.text || '').join('\n') : String(parts)
    if (String(system).includes('choosing which garments from a client')) {
      return { selection_note: 'all', roster_piece_ids: [820144, 820870, 820890, 820196] }
    }
    if (text.includes('CORRECTION NEEDED')) {
      calls.correction.push(text)
      if (correction instanceof Error) throw correction
      return correction
    }
    calls.composer++
    return { outfits: [card('gradient floral print drop-shoulder cashmere sweater', 820890), card('black turtleneck', 820144, 'Clean Column')].map((outfit, i) => i === 1 ? { ...outfit, middle_layer_name: null, middle_layer_id: null } : outfit), skip: '', saveableLearning: '' }
  }
  return calls
}
const middleOf = outfit => outfit.pieces.find(piece => piece.role === 'layer_top')?.id

test('composer: the incident triggers one correction call naming the mismatch, and the corrected card ships', async () => {
  const corrected = { outfits: [card('gradient floral print drop-shoulder cashmere sweater', 820870), { ...card('black turtleneck', 820144, 'Clean Column'), middle_layer_name: null, middle_layer_id: null }], skip: '', saveableLearning: '' }
  const calls = installHandler(corrected)
  const result = await generateOutfitsForPieceInternal({ pieceId: 820106, occasion: 'casual', season: 'current season' })
  assert.equal(calls.composer, 1)
  assert.equal(calls.correction.length, 1)
  assert.match(calls.correction[0], /"Artisan Gradient Layer": you wrote "gradient floral print drop-shoulder cashmere sweater" for middle_layer_id, but ID 820890 is "navy and cream striped knit sweater"/)
  const gradient = result.structuredOutfits.find(outfit => outfit.label === 'Artisan Gradient Layer')
  assert.ok(gradient && !gradient.broken, 'the corrected card is delivered')
  assert.equal(middleOf(gradient), 820870)
  const nameCheck = result.debug.visualCritic.nameCheck
  assert.equal(nameCheck.correctionRan, true)
  assert.equal(nameCheck.mismatches.length, 1)
  assert.equal(nameCheck.remaining, 0)
})

test('composer: a correction that still disagrees, comes back short, fails or does not parse leaves the card as Needs review — never a swapped ID', async () => {
  const clean = { ...card('black turtleneck', 820144, 'Clean Column'), middle_layer_name: null, middle_layer_id: null }
  for (const correction of [
    { outfits: [card('gradient floral print drop-shoulder cashmere sweater', 820890), clean], skip: '', saveableLearning: '' },
    { outfits: [card('gradient floral print drop-shoulder cashmere sweater', 820870)], skip: '', saveableLearning: '' },
    new Error('provider down'),
    { notOutfits: true },
  ]) {
    const calls = installHandler(correction)
    const result = await generateOutfitsForPieceInternal({ pieceId: 820106, occasion: 'casual', season: 'current season' })
    assert.equal(calls.correction.length, 1, 'exactly one correction call')
    assert.ok(!result.structuredOutfits.some(outfit => !outfit.broken && middleOf(outfit) === 820890), 'the striped sweater card is never delivered as valid')
    const flagged = result.structuredOutfits.find(outfit => outfit.broken && outfit.label === 'Artisan Gradient Layer')
    assert.ok(flagged, 'kept as a Needs review card')
    assert.equal(middleOf(flagged), 820890, 'with the ID the model wrote')
    assert.ok(result.debug.visualCritic.nameCheck.remaining >= 1)
    assert.ok(result.structuredOutfits.some(outfit => outfit.label === 'Clean Column' && !outfit.broken), 'the clean card is never lost to a short correction')
  }
})

test('composer: a clean answer makes no correction call', async () => {
  const calls = { correction: 0 }
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = ({ system, messages }) => {
    if (String(system).includes('choosing which garments from a client')) return { selection_note: 'all', roster_piece_ids: [820144, 820870, 820890, 820196] }
    if (messages[0].content.some(part => String(part?.text || '').includes('CORRECTION NEEDED'))) calls.correction++
    return { outfits: [card('gradient floral print drop-shoulder cashmere sweater', 820870)], skip: '', saveableLearning: '' }
  }
  const result = await generateOutfitsForPieceInternal({ pieceId: 820106, occasion: 'casual', season: 'current season' })
  assert.equal(calls.correction, 0)
  assert.equal(result.debug.visualCritic.nameCheck.correctionRan, false)
  assert.equal(composerNameMismatches({ outfits: [card('gradient cashmere sweater', 820870)] }, rows).size, 0)
})
