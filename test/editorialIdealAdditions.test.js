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
  anchorRegisterFootwearComputedChecks,
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

// Prompt-responsibility census verification (2026-08-26): OUTFIT_EVALUATOR_GATE_SYSTEM's register/
// footwear prose could diverge from registerCeilingVerdict/footwearComfortVerdict because the
// selected anchor bypasses automatic-use eligibility and so never runs those checks upstream. This
// proves the replacement — computing the anchor's own verdicts server-side — actually produces the
// finding, using the SAME resolvers (resolveOccasionProfile/resolveActivityProfile) the rest of the
// app resolves real occasion/activity context from, not a hand-rolled fixture shape.
test('anchorRegisterFootwearComputedChecks flags a selected garment the canonical verdicts would exclude', async () => {
  const { resolveOccasionProfile } = await import('../styling-engine/occasions.js')
  const { resolveActivityProfile } = await import('../styling-engine/footwear-comfort.js')

  const casualOccasionProfile = resolveOccasionProfile('casual', '')
  assert.equal(casualOccasionProfile.register_ceiling, 'everyday', 'fixture depends on this ceiling')
  const hikingActivityProfile = resolveActivityProfile({ activity: 'hiking' })
  assert.ok(hikingActivityProfile.rules?.excluded_heel_heights?.length, 'fixture depends on hiking excluding some heel heights')

  // A dressy selected piece for a casual occasion — the canonical register ceiling would exclude it.
  const dressyAnchor = { id: 401, name: 'silk cocktail blouse', category: 'top', formality: 'dressy' }
  const registerFinding = anchorRegisterFootwearComputedChecks({
    selectedPiece: dressyAnchor,
    occasion: 'casual',
    occasionProfile: casualOccasionProfile,
  })
  assert.match(registerFinding, /Selected garment register check \(computed\)/)
  assert.match(registerFinding, /dressy/)

  // A high-heel selected shoe for a hiking activity — the canonical footwear verdict would exclude it.
  const heelAnchor = { id: 402, name: 'stiletto pump', category: 'shoes', heel_height: 'high', walk_support: 'low' }
  const footwearFinding = anchorRegisterFootwearComputedChecks({
    selectedPiece: heelAnchor,
    occasion: 'casual',
    activity: 'hiking',
    activityProfile: hikingActivityProfile,
  })
  assert.match(footwearFinding, /Selected garment footwear check \(computed\)/)

  // A compliant anchor produces no finding at all — most requests hit this path, and the evaluator
  // must not be told to reject/flag on register or footwear grounds absent a computed line.
  const compliantAnchor = { id: 403, name: 'cotton tee', category: 'top', formality: 'everyday' }
  assert.equal(
    anchorRegisterFootwearComputedChecks({
      selectedPiece: compliantAnchor,
      occasion: 'casual',
      occasionProfile: casualOccasionProfile,
    }),
    ''
  )
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

// thread_1787813410728: a "style this piece using my existing wardrobe" direction (real owned
// pants + shoes, not an invented ideal-addition concept) rendered with wrong pants/shoes details —
// editorialImagePrompt had nothing describing those non-anchor garments at all, no photo and no
// text, so the model invented them. supportingPieces closes that gap.
test('editorialImagePrompt describes real non-anchor pieces with the same fidelity/construction checklists wholeWardrobeImagePrompt uses', () => {
  const selectedPiece = { id: 996795, name: 'grey striped button-up shirt', category: 'top', colors: ['grey', 'cream'] }
  const supportingPieces = [
    { id: 128, name: 'light beige linen wide-leg pants', category: 'bottom', silhouette: 'wide_leg', length_hits_at: 'full_length' },
    { id: 204, name: 'sleek black cutout flats', category: 'shoes' },
  ]
  const prompt = editorialImagePrompt({
    selectedPiece,
    direction: { pieceIds: [996795, 128, 204], reason: 'tone-on-tone column', missingPieces: [] },
    occasion: 'city',
    season: 'summer',
    supportingPieces,
  })

  assert.match(prompt, /SUPPORTING WARDROBE GARMENTS/)
  assert.match(prompt, /light beige linen wide-leg pants: must remain the listed pant\/jean silhouette/)
  assert.match(prompt, /sleek black cutout flats: preserve shoe type, color, heel\/sole shape, and openness\/coverage/)
  assert.match(prompt, /Supporting garment construction/)
  assert.match(prompt, /light beige linen wide-leg pants: preserve its wide leg silhouette; keep its full length length/)
})

test('editorialImagePrompt omits the supporting-garment sections entirely when there are none (genuine ideal-addition mode)', () => {
  const selectedPiece = { id: 263, name: 'black textured long sleeve top', category: 'top' }
  const prompt = editorialImagePrompt({
    selectedPiece,
    direction: { missingPieces: ['grounded olive utility trouser'], reason: '', visualPrompt: '' },
    occasion: 'dinner',
    season: 'summer',
  })

  assert.doesNotMatch(prompt, /SUPPORTING WARDROBE GARMENTS/)
  assert.doesNotMatch(prompt, /Supporting garment construction/)
  // The genuine ideal-addition path is untouched: missingPieces still reaches the prompt as prose.
  assert.match(prompt, /grounded olive utility trouser/)
})

// Both selected-piece composer prompts (outfitComposerTemplate, wholeWardrobeVisualComposerTemplate)
// already generate `styling_instructions` and document it as "the ONLY field the image renderer
// treats as authoritative for how pieces relate to each other" — it survives
// normalizeGeneratedOutfitObject onto the outfit card, but editorialImagePrompt never read it. Real
// example from thread_1787813410728's own turn: "open shirt over a dark tank is what elevates this
// piece" is exactly the kind of layering mechanic styling_instructions exists to carry.
test('editorialImagePrompt treats direction.stylingInstructions as authoritative, the same way wholeWardrobeImagePrompt does', () => {
  const selectedPiece = { id: 996795, name: 'grey striped button-up shirt', category: 'top' }
  const prompt = editorialImagePrompt({
    selectedPiece,
    direction: {
      pieceIds: [996795],
      reason: 'a clean tone-on-tone column',
      stylingInstructions: 'wear the shirt open, unbuttoned, over a black tank so the collar reads intentional',
    },
    occasion: 'city',
    season: 'summer',
  })

  assert.match(prompt, /Authoritative styling instructions \(how these garments relate to each other — follow exactly\): wear the shirt open, unbuttoned, over a black tank/)
  // Ordered ahead of the non-authoritative reason prose, matching wholeWardrobeImagePrompt's own
  // authoritative-facts-before-prose ordering.
  const authoritativeIndex = prompt.indexOf('Authoritative styling instructions')
  const stylistLogicIndex = prompt.indexOf('Stylist logic:')
  assert.ok(authoritativeIndex >= 0 && stylistLogicIndex > authoritativeIndex)
})

test('editorialImagePrompt omits the styling-instructions line when the outfit has none to state', () => {
  const selectedPiece = { id: 263, name: 'black textured long sleeve top', category: 'top' }
  const prompt = editorialImagePrompt({
    selectedPiece,
    direction: { pieceIds: [263], reason: 'simple everyday pairing', stylingInstructions: '' },
    occasion: 'casual',
    season: 'summer',
  })

  assert.doesNotMatch(prompt, /Authoritative styling instructions/)
})
