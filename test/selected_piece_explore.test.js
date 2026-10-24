// docs/selected-piece-explore-mode-spec.md: Explore is an opt-in mode on the first card turn for a piece.
// One intent-only instruction replaces the composer's variety rule and is given to the roster step
// with the outfit count; five cards; each occasion's look words drop from its vibe. With Explore off,
// every request is exactly the default one.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'selected-piece-explore-'))
const uploads = path.join(tmpRoot, 'uploads')
fs.mkdirSync(uploads, { recursive: true })
process.env.NODE_ENV = 'test'
process.env.WARDROBE_DB_PATH = path.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = uploads
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''

const { generateOutfitsForPieceInternal, selectedItemVisualComposerSystemPrompt, styleDirectionLine, selectedPieceOutfitCount } = await import('../routes/ai.js')
const { OCCASION_PROFILES, occasionVibe, stripSoftRankingRules } = await import('../styling-engine/occasions.js')
const { EXPLORE_INSTRUCTION, OUTFIT_VARIETY_RULE } = await import('../styling-engine/prompts.js')
const { selectedPieceRosterSystemPrompt } = await import('../styling-engine/selectedPieceRoster.js')
const { ensureFixturePieces } = await import('./helpers/dbFixtures.js')

const common = { status: 'active', occasions: '["city","casual"]', formality: 'everyday' }
const ANCHOR = 830106
const rows = [
  { id: ANCHOR, name: 'black flare leg denim pants', category: 'bottom', fabric_weight: 'medium', ...common },
  ...Array.from({ length: 6 }, (_, i) => ({ id: 830201 + i, name: `fixture top ${i + 1}`, category: 'top', fabric_weight: 'medium', ...common })),
  { id: 830301, name: 'black slip-on loafers', category: 'shoes', heel_height: 'flat', walk_support: 'high', ...common },
  { id: 830302, name: 'white canvas sneakers', category: 'shoes', heel_height: 'flat', walk_support: 'high', ...common },
]
for (const row of rows) {
  row.photo = `fixture-${row.id}.jpg`
  await sharp({ create: { width: 24, height: 32, channels: 3, background: '#665544' } }).jpeg().toFile(path.join(uploads, row.photo))
}
const cleanupFixtures = ensureFixturePieces(rows)
test.after(() => {
  cleanupFixtures()
  delete globalThis.__WARDROBE_AI_TEST_HANDLER__
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

const EXPLORE_VIBES = {
  city_smart_casual: 'polished, comfortable, walk-friendly',
  evening_social: 'sharp, artistic, low-key drama',
  outdoor_daytime_social: 'relaxed, creative, intentional',
  home_loungewear: 'comfort-first, soft',
}

test('vibes: Explore drops each occasion\'s look words; the default projection is unchanged and never carries explore_vibe', () => {
  const byId = Object.fromEntries(OCCASION_PROFILES.map(profile => [profile.id, profile]))
  for (const [id, vibe] of Object.entries(EXPLORE_VIBES)) {
    assert.equal(occasionVibe(byId[id], { explore: true }), vibe, id)
    assert.equal(occasionVibe(byId[id]), byId[id].vibe, `${id} default`)
  }
  for (const id of ['casual', 'gallery_art_event', 'concert']) assert.equal(occasionVibe(byId[id], { explore: true }), byId[id].vibe, `${id} has no Explore version`)

  const projected = stripSoftRankingRules(OCCASION_PROFILES)
  assert.ok(projected.every(profile => !('explore_vibe' in profile)))
  assert.deepEqual(projected.map(profile => profile.vibe), OCCASION_PROFILES.map(profile => profile.vibe))
  // Same key order as before, so the serialized default prompt is byte-identical.
  assert.deepEqual(Object.keys(projected[1]), Object.keys(OCCASION_PROFILES[1]).filter(key => key !== 'explore_vibe'))
  const explored = stripSoftRankingRules(OCCASION_PROFILES, { explore: true })
  assert.ok(explored.every(profile => !('explore_vibe' in profile)))
  assert.equal(explored.find(profile => profile.id === 'city_smart_casual').vibe, EXPLORE_VIBES.city_smart_casual)
})

test('composer prompt: Explore replaces the variety rule whole; the default keeps it', () => {
  const standard = selectedItemVisualComposerSystemPrompt()
  assert.equal(standard, selectedItemVisualComposerSystemPrompt({ explore: false }))
  assert.equal(standard.split(OUTFIT_VARIETY_RULE).length, 2, 'default has the variety rule once')
  assert.ok(!standard.includes(EXPLORE_INSTRUCTION))
  assert.match(standard, /walk-friendly, clean columns/)

  const explore = selectedItemVisualComposerSystemPrompt({ explore: true })
  assert.ok(!explore.includes(OUTFIT_VARIETY_RULE), 'the variety rule is gone, not competing')
  assert.equal(explore.split(EXPLORE_INSTRUCTION).length, 2, 'the Explore instruction appears once')
  assert.ok(!/clean columns|deep color palettes|explore_vibe/.test(explore))
})

test('the Explore instruction is intent only: it names no styling dimension, garment category or technique', () => {
  assert.doesNotMatch(EXPLORE_INSTRUCTION, /\b(tops?|bottoms?|dress(es)?|shoes?|layers?|layering|colou?rs?|prints?|patterns?|textures?|silhouettes?|proportions?|black|columns?|tuck(ed|ing)?|monochrome|accessor(y|ies))\b/i)
  assert.match(EXPLORE_INSTRUCTION, /wearable/)
})

test('roster prompt: Explore states the outfit count and the instruction; the default is unchanged', () => {
  assert.equal(selectedPieceRosterSystemPrompt(), selectedPieceRosterSystemPrompt(40, { explore: false, outfitCount: 5 }))
  const explore = selectedPieceRosterSystemPrompt(40, { explore: true, outfitCount: 5 })
  assert.match(explore, /You are choosing for 5 outfits, each taking its own direction\./)
  assert.ok(explore.includes(EXPLORE_INSTRUCTION))
  assert.deepEqual(selectedPieceOutfitCount({ explore: true }), { minOutfits: 5, maxOutfits: 5 })
  assert.deepEqual(selectedPieceOutfitCount(), { minOutfits: 3, maxOutfits: 4 })
})

test('Style direction reaches the stylist as its label and description, not the bare ID', () => {
  assert.equal(styleDirectionLine('mix'), '')
  assert.equal(styleDirectionLine(''), '')
  assert.match(styleDirectionLine('unexpected_pairing'), /^Style direction: Unexpected Pairing — Experiment with a less obvious combination/)
  assert.equal(styleDirectionLine('not_a_direction'), 'Style direction: not_a_direction')
})

const card = (topId, label) => ({
  layering_check: 'no layered pair on this card', label, strength: 'strong', dominantDirection: 'x', silhouette: 'x', bestFor: 'city',
  base_top_name: `fixture top ${topId - 830200}`, base_top_id: topId,
  bottom_name: 'black flare leg denim pants', bottom_id: ANCHOR,
  dress_name: null, dress_id: null, middle_layer_name: null, middle_layer_id: null, outer_layer_name: null, outer_layer_id: null,
  shoes_name: 'black slip-on loafers', shoes_id: 830301,
  reason: 'fixture', styling_instructions: '', watchFor: 'none',
})
function installHandler(cardCount) {
  const calls = { roster: null, composer: null }
  globalThis.__WARDROBE_AI_TEST_HANDLER__ = ({ system, messages }) => {
    const text = messages[0].content.map(part => part?.text || '').join('\n')
    if (String(system).includes('choosing which garments from a client')) {
      calls.roster = { system, text }
      return { selection_note: 'all', roster_piece_ids: rows.filter(row => row.id !== ANCHOR).map(row => row.id) }
    }
    calls.composer = { system, text }
    return { outfits: Array.from({ length: cardCount }, (_, i) => card(830201 + i, `Direction ${i + 1}`)), skip: '', saveableLearning: '' }
  }
  return calls
}

test('end to end: Explore sends the instruction to both steps, asks for and delivers five cards, unranked', async () => {
  const calls = installHandler(5)
  const result = await generateOutfitsForPieceInternal({ pieceId: ANCHOR, occasion: 'city', season: 'current season', mission: 'unexpected_pairing', explore: true })
  assert.ok(calls.roster.system.includes(EXPLORE_INSTRUCTION) && /choosing for 5 outfits/.test(calls.roster.system))
  assert.ok(calls.composer.system.includes(EXPLORE_INSTRUCTION) && !calls.composer.system.includes(OUTFIT_VARIETY_RULE))
  assert.match(calls.composer.text, /Compose 5 complete outfits/)
  assert.match(calls.composer.text, /Occasion vibe: polished, comfortable, walk-friendly\n/)
  assert.match(calls.composer.text, /Style direction: Unexpected Pairing — /)
  assert.match(calls.roster.text, /Style direction: Unexpected Pairing — /)
  assert.equal(result.structuredOutfits.length, 5, 'the fifth card is not cut')
  assert.ok(result.structuredOutfits.every(outfit => outfit.strength === 'explore' && outfit.modelStrength === 'strong'))
  assert.equal(result.explore, true)
  assert.match(result.feedback, /· Explore/)
  assert.doesNotMatch(result.feedback, /Signature \/ strongest direction/)
})

test('end to end: with Explore off the requests are the default ones', async () => {
  const calls = installHandler(3)
  const result = await generateOutfitsForPieceInternal({ pieceId: ANCHOR, occasion: 'city', season: 'current season' })
  assert.ok(!calls.roster.system.includes(EXPLORE_INSTRUCTION))
  assert.equal(calls.roster.system, selectedPieceRosterSystemPrompt())
  assert.equal(calls.composer.system, selectedItemVisualComposerSystemPrompt())
  assert.match(calls.composer.text, /Compose 3-4 complete outfits/)
  assert.match(calls.composer.text, /Occasion vibe: polished, comfortable, walk-friendly, clean columns/)
  assert.ok(!/Style direction:|Mission:/.test(calls.composer.text), 'mix sends no direction line')
  assert.equal(result.explore, false)
  assert.ok(result.structuredOutfits.every(outfit => outfit.strength !== 'explore'))
  assert.match(result.feedback, /Signature \/ strongest direction/)
})

test('interface: the piece form sends explore only when the toggle is on, and carries it in the thread context', () => {
  const source = fs.readFileSync(new URL('../src/components/StylistChat.jsx', import.meta.url), 'utf8')
  assert.match(source, /const \[generateExplore, setGenerateExplore\] = useState\(false\)/)
  assert.match(source, /\.\.\.\(effectiveGenerateExplore \? \{ explore: true \} : \{\}\) \}\) \}\)/)
  assert.match(source, /Outfits beyond the obvious pairings for this piece\./)
  assert.match(source, /options\.explore && \{ id: 'explore', label: 'Explore' \}/, 'an Explore set is labelled in its request chips')
})
