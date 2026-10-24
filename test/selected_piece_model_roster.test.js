// docs/selected-piece-model-roster-spec.md: on the first card turn the stylist chooses the roster the
// selected-piece composer sees, from the complete eligible catalog. The code ranking (word-matched
// compatibility score cut to 12 tops for a bottom anchor) is kept only as the fallback. Live case:
// thread_1792822990468, where the sweaters behind the owner's better cards ranked 60th and 61st of
// 103 tops and never reached the composer.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'selected-piece-model-roster-'))
const uploads = path.join(tmpRoot, 'uploads')
fs.mkdirSync(uploads, { recursive: true })
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = uploads
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const { generateOutfitsForPieceInternal } = await import('../routes/ai.js')
const { db, parsePiece } = await import('../db.js')
const { ensureFixturePieces } = await import('./helpers/dbFixtures.js')
const {
  buildSelectedPieceRosterCatalog,
  validateSelectedPieceRosterPick,
  selectedPieceRosterSchema,
  selectedPieceRosterSystemPrompt,
  SELECTED_PIECE_ROSTER_MAX,
} = await import('../styling-engine/selectedPieceRoster.js')
const { installMockAiHandler } = await import('../styling-engine/mockAiHandler.js')

const ANCHOR = 810000
const PENALIZED_SWEATER = 810099
const common = { status: 'active', occasions: '["casual"]', formality: 'everyday' }
// Thirteen sleeveless tops the code ranking rewards (+12 "compact/structured top") and one relaxed
// sweater it penalizes against a wide anchor (−8 "wide/soft top risk"): the quota of 12 tops cuts it.
const rows = [
  { id: ANCHOR, name: 'black wide-leg knit trousers', category: 'bottom', colors: '["black"]', silhouette: 'wide_leg', fabric_weight: 'heavy', ...common },
  ...Array.from({ length: 13 }, (_, i) => ({ id: 810001 + i, name: `sleeveless shell tank ${i + 1}`, category: 'top', colors: '["black"]', fabric_weight: 'light', ...common })),
  { id: PENALIZED_SWEATER, name: 'relaxed oversized intarsia sweater', category: 'top', colors: '["cream"]', fabric_weight: 'heavy', silhouette: 'relaxed', ...common },
  { id: 810101, name: 'black leather loafers', category: 'shoes', heel_height: 'flat', walk_support: 'high', ...common },
  { id: 810102, name: 'white canvas sneakers', category: 'shoes', heel_height: 'flat', walk_support: 'high', ...common },
  { id: 810201, name: 'tweed vest', category: 'outerwear', outerwear_subtype: 'vest', fabric_weight: 'medium', ...common },
  { id: 810301, name: 'navy straight jeans', category: 'bottom', fabric_weight: 'medium', ...common },
  { id: 810401, name: 'black slip dress', category: 'dress', fabric_weight: 'light', ...common },
  { id: 810501, name: 'silver hoop earrings', category: 'accessory', ...common },
]
for (const row of rows) {
  row.photo = `fixture-${row.id}.jpg`
  await sharp({ create: { width: 24, height: 32, channels: 3, background: '#887766' } }).jpeg().toFile(path.join(uploads, row.photo))
}
const cleanupFixtures = ensureFixturePieces(rows)
test.after(() => {
  cleanupFixtures()
  delete globalThis.__WARDROBE_AI_TEST_HANDLER__
  delete process.env.WARDROBE_SELECTED_PIECE_MODEL_ROSTER
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

const piece = id => parsePiece(db.prepare('SELECT * FROM pieces WHERE id = ?').get(id))
const isRosterCall = system => String(system).includes('choosing which garments from a client')
const composerShownIds = messages => (messages?.[0]?.content || [])
  .map(part => String(part?.text || '').match(/^(?:SELECTED ANCHOR|SUPPORT) ID (\d+):/))
  .filter(Boolean).map(match => Number(match[1]))
const composerCard = { outfits: [{ layering_check: 'no layered pair on this card', label: 'Fixture', strength: 'strong', dominantDirection: 'casual', silhouette: 'column', bestFor: 'casual', base_top_id: PENALIZED_SWEATER, bottom_id: ANCHOR, dress_id: null, middle_layer_id: null, outer_layer_id: null, shoes_id: 810101, reason: 'fixture', styling_instructions: '', watchFor: 'none' }], skip: '', saveableLearning: '' }

// Records every call; answers the roster call with `pick` (a function of the catalog text, or a
// value), and the composer with one card.
function installHandler(pick) {
  const calls = { roster: [], composer: [] }
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = ({ system, messages }) => {
    if (isRosterCall(system)) {
      const text = messages[0].content.map(part => part.text || '').join('\n')
      calls.roster.push({ system, text, content: messages[0].content })
      const answer = typeof pick === 'function' ? pick(text) : pick
      if (answer instanceof Error) throw answer
      return answer
    }
    calls.composer.push({ system, shown: composerShownIds(messages) })
    return composerCard
  }
  return calls
}

test('catalog: a bottom anchor sees every eligible top, shoe and layer, and no bottom, dress or accessory', () => {
  const all = rows.map(row => piece(row.id))
  const catalog = buildSelectedPieceRosterCatalog({ anchorPiece: piece(ANCHOR), eligiblePieces: all })
  const ids = catalog.pieces.map(p => p.id)
  assert.equal(catalog.counts.top, 14)
  assert.equal(catalog.counts.shoes, 2)
  assert.equal(catalog.counts.outerwear, 1)
  for (const excluded of [ANCHOR, 810301, 810401, 810501]) assert.ok(!ids.includes(excluded), `catalog must not hold ${excluded}`)
  assert.ok(ids.includes(PENALIZED_SWEATER))
  // Identity order within each group, and fact lines only: no score or ranking reason.
  const tops = catalog.pieces.filter(p => p.category === 'top').map(p => p.id)
  assert.deepEqual(tops, [...tops].sort((a, b) => a - b))
  assert.doesNotMatch(catalog.text, /score|compact\/structured|risk/i)
  assert.match(catalog.text, /^=== TOP \(14\) ===$/m)
})

test('catalog: a top anchor keeps other tops and outerwear (middle layers) and drops accessories; the automatic-use verdict is honored', () => {
  const all = rows.map(row => piece(row.id))
  const anchor = piece(810001)
  const catalog = buildSelectedPieceRosterCatalog({ anchorPiece: anchor, eligiblePieces: all, isAutoUseAllowed: p => p.id !== 810102 })
  const ids = catalog.pieces.map(p => p.id)
  assert.ok(ids.includes(810002) && ids.includes(810201) && ids.includes(810301) && ids.includes(810401))
  assert.ok(!ids.includes(810001) && !ids.includes(810501) && !ids.includes(810102))
})

test('validation: unknown, duplicate and anchor IDs are dropped and reported; the pick is trimmed in order', () => {
  const all = rows.map(row => piece(row.id))
  const anchor = piece(ANCHOR)
  const catalog = buildSelectedPieceRosterCatalog({ anchorPiece: anchor, eligiblePieces: all })
  const checked = validateSelectedPieceRosterPick({ anchorPiece: anchor, catalog, pickedIds: [PENALIZED_SWEATER, 999999, ANCHOR, PENALIZED_SWEATER, 810101, 810301, 810002, 810003], max: 3 })
  assert.deepEqual(checked.unknownIds, [999999, 810301])
  assert.deepEqual(checked.pieces.map(p => p.id), [PENALIZED_SWEATER, 810101, 810002])
  assert.deepEqual(checked.trimmedIds, [810003])
  assert.equal(checked.usable, true)
  assert.deepEqual(checked.addedForCoverageIds, [])
})

test('validation: a pick with no shoes gets exactly the shoes the supply contract needs, and is not padded', () => {
  const all = rows.map(row => piece(row.id))
  const anchor = piece(ANCHOR)
  const catalog = buildSelectedPieceRosterCatalog({ anchorPiece: anchor, eligiblePieces: all })
  const coverageRanking = catalog.pieces.slice().reverse()
  const checked = validateSelectedPieceRosterPick({ anchorPiece: anchor, catalog, pickedIds: [PENALIZED_SWEATER, 810002], coverageRanking })
  assert.equal(checked.usable, true)
  assert.equal(checked.addedForCoverageIds.length, 1)
  assert.equal(piece(checked.addedForCoverageIds[0]).category, 'shoes')
  assert.equal(checked.pieces.length, 3, 'her two picks plus one required pair of shoes, nothing else')
})

test('schema: the roster answer is bounded to the cap, note first', () => {
  const schema = selectedPieceRosterSchema()
  assert.deepEqual(Object.keys(schema.properties), ['selection_note', 'roster_piece_ids'])
  assert.equal(schema.properties.roster_piece_ids.maxItems, SELECTED_PIECE_ROSTER_MAX)
})

// Live check 2026-10-24: with "choose up to 40 worth seeing" she picked 15–22, fewer than the old
// code roster's 26 (4 of 62 bottoms for the black shirt), reading the cap as a target to stay well
// under. The prompt now frames the pick as a shortlist compared on photographs, asks for several
// real alternatives for every part, and names no per-role count (owner: no counts, no case lists).
test('prompt: the pick is a shortlist of alternatives to compare on photographs, with no per-role count', () => {
  const prompt = selectedPieceRosterSystemPrompt()
  assert.match(prompt, /shortlist to compare, not your final choice/)
  assert.match(prompt, /several real alternatives/)
  assert.match(prompt, /You may choose up to 40\./)
  assert.doesNotMatch(prompt, /\b(at least|exactly|minimum of)\s+\d/i)
  assert.doesNotMatch(prompt, /\b\d+\s+(tops|bottoms|shoes|layers)\b/i)
})

test('end to end: the composer sees exactly the stylist\'s pick plus the anchor, including a garment the code ranking cut', async () => {
  // Control: the code ranking (kill switch) never shows the penalized sweater.
  process.env.WARDROBE_SELECTED_PIECE_MODEL_ROSTER = 'off'
  const control = installHandler(() => assert.fail('no roster call with the kill switch on'))
  const controlResult = await generateOutfitsForPieceInternal({ pieceId: ANCHOR, occasion: 'casual', season: 'current season' })
  assert.equal(control.roster.length, 0)
  assert.ok(!control.composer[0].shown.includes(PENALIZED_SWEATER), 'the quota cuts the 14th top')
  assert.equal(controlResult.debug.visualCritic.rosterSelection, null)
  delete process.env.WARDROBE_SELECTED_PIECE_MODEL_ROSTER

  const pick = [PENALIZED_SWEATER, 810005, 810101, 810201]
  const calls = installHandler({ selection_note: 'Soft knit against the heavy knit; one vest.', roster_piece_ids: pick })
  const result = await generateOutfitsForPieceInternal({ pieceId: ANCHOR, occasion: 'casual', season: 'current season' })
  assert.equal(calls.roster.length, 1)
  assert.match(calls.roster[0].text, /CATALOG — 17 eligible garments/)
  assert.ok(calls.roster[0].content.some(part => part.type === 'image'), 'the roster call sees the anchor photo')
  assert.equal(calls.composer[0].shown[0], ANCHOR, 'the anchor is shown first, as before')
  assert.deepEqual([...calls.composer[0].shown].sort(), [ANCHOR, ...pick].sort())
  const rosterDebug = result.debug.visualCritic.rosterSelection
  assert.equal(rosterDebug.source, 'stylist')
  assert.equal(rosterDebug.pickedCount, 4)
  assert.deepEqual(rosterDebug.pickedCounts, { top: 2, shoes: 1, outerwear: 1 })
  assert.equal(rosterDebug.selectionNote, 'Soft knit against the heavy knit; one vest.')
  assert.ok(result.structuredOutfits.some(card => card.pieces.some(p => Number(p.id) === PENALIZED_SWEATER)))
})

test('fallback: a failed call, an empty pick or unknown IDs only each give the code roster, with the reason', async () => {
  for (const [answer, reason] of [
    [new Error('provider down'), 'call_failed'],
    [{ selection_note: '', roster_piece_ids: [] }, 'no_usable_ids'],
    [{ selection_note: '', roster_piece_ids: [999998, 999999] }, 'no_usable_ids'],
    [composerCard, 'no_usable_ids'],
  ]) {
    const calls = installHandler(answer)
    const result = await generateOutfitsForPieceInternal({ pieceId: ANCHOR, occasion: 'casual', season: 'current season' })
    const rosterDebug = result.debug.visualCritic.rosterSelection
    assert.equal(rosterDebug.source, 'code_ranked_fallback')
    assert.equal(rosterDebug.fallbackReason, reason)
    assert.ok(calls.composer.length === 1 && !calls.composer[0].shown.includes(PENALIZED_SWEATER), `${reason}: composer gets the code roster`)
  }
})

test('mock AI (sandbox): the roster call is answered from the catalog with every role represented, never a billed call', async () => {
  installMockAiHandler(db)
  try {
    const result = await generateOutfitsForPieceInternal({ pieceId: ANCHOR, occasion: 'casual', season: 'current season' })
    const rosterDebug = result.debug.visualCritic.rosterSelection
    assert.equal(rosterDebug.source, 'stylist')
    assert.ok(rosterDebug.pickedCounts.top >= 1 && rosterDebug.pickedCounts.shoes >= 1)
  } finally {
    delete globalThis.__WARDROBE_AI_TEST_HANDLER__
  }
})
