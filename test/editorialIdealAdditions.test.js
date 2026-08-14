import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import nodePath from 'node:path'
// Hermetic DB isolation (spec 21/29 doctrine): this file's import chain reaches db.js,
// whose module-load migrations would otherwise run against the real wardrobe.db.
const tmpRoot = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'editorial-ideal-additions-'))
process.env.WARDROBE_DB_PATH = nodePath.join(tmpRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = nodePath.join(tmpRoot, 'uploads')
const {
  dedupeAndDifferentiateEditorialDirections,
  ownedLooksSimilarToArchetype,
  anchorFidelityInstructions,
  editorialImagePrompt,
} = await import('../styling-engine/core.js')
const { buildPieceText } = await import('../styling-engine/rules.js')

test('editorial ideal additions avoid owned color/category matches while preserving selected top role', () => {
  const selectedPiece = {
    id: 77,
    name: 'bold purple floral sleeveless top',
    category: 'top',
    colors: ['purple', 'pink'],
  }
  const ownedPieces = [
    { id: 1, name: 'deep charcoal structured wide-leg trousers', category: 'bottom', colors: ['charcoal'] },
    { id: 2, name: 'sleek black leather loafers', category: 'shoes', colors: ['black'] },
    { id: 3, name: 'camel flowing midi skirt', category: 'bottom', colors: ['camel'] },
    { id: 4, name: 'brown strappy sandals', category: 'shoes', colors: ['brown'] },
  ]
  const directions = [{
    title: 'Tailored Elegance',
    missingPieces: [
      'deep charcoal structured wide-leg trousers',
      'sleek black leather loafers',
      'another sleeveless shell top',
    ],
    reason: 'Generic closet-like additions',
    visualPrompt: '',
  }]

  assert.equal(ownedLooksSimilarToArchetype('black leather loafer', ownedPieces), true)
  assert.equal(ownedLooksSimilarToArchetype('camel midi skirt', ownedPieces), true)

  const [cleaned] = dedupeAndDifferentiateEditorialDirections(directions, selectedPiece, ownedPieces)
  const text = cleaned.missingPieces.join(' | ').toLowerCase()
  assert.doesNotMatch(text, /charcoal|black leather loafer|camel|brown strappy|sleeveless shell top/)
  assert.doesNotMatch(text, /\b(top|shirt|blouse|tee|tank|shell|sweater|knit|dress)\b/)
  assert.ok(cleaned.missingPieces.length >= 2)
})

// The editorial image prompt used to derive every fidelity clause from
// `name + notes`, so `length_hits_at` — populated on 207 of 236 pieces —
// produced no length instruction at all, while the renderer memory appended to
// the same prompt filled up with "rendered too long" corrections.
test('anchor fidelity states the tagged length, sleeve, pattern and fit', () => {
  const rules = anchorFidelityInstructions({
    id: 263,
    name: 'black textured long sleeve top',
    category: 'top',
    length_hits_at: 'waist',
    sleeve_length: 'long',
    sleeve_shape: 'bishop',
    pattern_type: 'geometric',
    pattern_scale: 'bold',
    fabric_category: 'synthetic',
    fabric_weight: 'light',
    silhouette: 'fitted',
    fit_on_body: 'clings_stretchy',
    hem_finish: 'design_hem',
  })

  assert.match(rules, /hits at waist/)
  assert.match(rules, /do not lengthen or shorten the anchor/)
  assert.match(rules, /Anchor sleeve: long bishop/)
  assert.match(rules, /geometric at bold scale/)
  assert.match(rules, /synthetic, light weight/)
  assert.match(rules, /Anchor silhouette: fitted/)
  // Column values are rendered as English, never as raw snake_case.
  assert.match(rules, /clings stretchy/)
  assert.doesNotMatch(rules, /clings_stretchy|design_hem/)
})

// `none` is the tagger's not-applicable sentinel, not a claim about the garment.
test('anchor fidelity ignores not-applicable column sentinels', () => {
  const rules = anchorFidelityInstructions({
    id: 12, name: 'wide-leg linen trousers', category: 'bottom',
    sleeve_length: 'unknown', length_hits_at: 'full-length', hem_finish: 'none',
  })
  assert.doesNotMatch(rules, /sleeve/i)
  assert.doesNotMatch(rules, /hem finish/i)
  assert.match(rules, /hits at full length/)
})

// Pieces the tagger never reached must keep the clauses the old regexes gave them.
test('anchor fidelity falls back to name/notes when no column is tagged', () => {
  const rules = anchorFidelityInstructions({
    id: 13, name: 'cream linen short-sleeve blouse', category: 'top',
    notes: 'boxy through the body',
  })
  assert.match(rules, /short-sleeved/)
  assert.match(rules, /fabric character/)
  assert.match(rules, /relaxed\/boxy/)
})

test('the editorial anchor description is the shared wardrobe truth text', () => {
  const selectedPiece = {
    id: 263, name: 'black textured long sleeve top', category: 'top',
    colors: ['black'], length_hits_at: 'waist', sleeve_length: 'long', sleeve_shape: 'bishop',
  }
  const prompt = editorialImagePrompt({
    selectedPiece,
    direction: { missingPieces: ['a', 'b'], visualPrompt: '', reason: '' },
    occasion: 'dinner',
    season: 'summer',
  })
  const anchorLine = prompt.split('\n').find(line => line.startsWith('ANCHOR GARMENT'))

  assert.equal(anchorLine.includes(buildPieceText(selectedPiece).split('\n')[0]), true)
  assert.match(anchorLine, /hits at.*waist/)
  assert.match(anchorLine, /sleeve.*bishop/)
  // The old builder read `selectedPiece.fabric`, a column that does not exist.
  assert.doesNotMatch(prompt, /fabric: undefined/)
})
