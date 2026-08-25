process.env.NODE_ENV = 'test'

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'closet-eligibility-'))
process.env.WARDROBE_DB_PATH = path.join(tempRoot, 'wardrobe.db')
process.env.WARDROBE_UPLOADS_DIR = path.join(tempRoot, 'uploads')

const {
  evaluateAutomaticUsePiecePool,
  evaluateVisualComposerPiecePool,
  selectAutomaticUseCandidatesForOutfitGeneration,
} = await import('../styling-engine/eligibility.js')
const {
  filterWholeWardrobePiecesForGeneration,
  selectCandidatesForOutfitGeneration,
  wholeWardrobeOutfitLooksQuestionable,
  wholeWardrobeOutfitVisualReviewFindings,
} = await import('../styling-engine/rules.js')

function piece(id, overrides = {}) {
  return {
    id,
    name: `Piece ${id}`,
    category: 'shoes',
    photo: `piece-${id}.jpg`,
    formality: 'everyday',
    heel_height: 'flat',
    walk_support: 'high',
    shoe_type: 'sneaker',
    occasions: ['casual', 'city', 'outdoor'],
    style_profile_json: {},
    ...overrides,
  }
}

test('shared automatic-use pool preserves hard-gate findings while anchor policy changes only disposition', () => {
  const blockedShoe = piece(30, {
    name: 'Low-support heel',
    heel_height: 'high',
    walk_support: 'low',
    shoe_type: 'pump',
  })
  const ordinaryShoe = piece(31)
  const result = evaluateAutomaticUsePiecePool({
    pieces: [blockedShoe, ordinaryShoe],
    context: { occasion: 'city', activity: 'walking', weatherProfile: { isHot: false, isCold: false } },
    policy: { anchorPieceIds: [blockedShoe.id] },
  })

  const blockedDecision = result.decisionsById.get(blockedShoe.id)
  assert.equal(blockedDecision.underlyingAllowed, false)
  assert.equal(blockedDecision.allowed, true, 'explicit anchor policy changes disposition')
  assert.equal(blockedDecision.bypassed, true)
  assert.ok(blockedDecision.findings.some(finding => finding.source === 'hard_gate' && finding.kind === 'validity'))
  assert.equal(result.eligibleIds.has(blockedShoe.id), true)
  assert.equal(result.debug.bypassedAnchorCount, 1)
})

test('shared automatic-use findings identify owner authority without consumer-side reason parsing', () => {
  const excluded = piece(32, { occasion_exclusions: ['city'] })
  const result = evaluateAutomaticUsePiecePool({
    pieces: [excluded],
    context: { occasion: 'city', weatherProfile: { isHot: false, isCold: false } },
  })

  const decision = result.decisionsById.get(excluded.id)
  assert.equal(decision.allowed, false)
  assert.ok(decision.findings.some(finding => finding.authority === 'owner' && finding.code === 'user_excluded_for_city'))
})

test('hot-weather outerwear capacity and anchor bypass are explicit pool policy', () => {
  const outerwear = [
    piece(40, { category: 'outerwear', name: 'Light layer A', fabric_weight: 'light' }),
    piece(41, { category: 'outerwear', name: 'Light layer B', fabric_weight: 'light' }),
    piece(42, { category: 'outerwear', name: 'Medium layer', fabric_weight: 'medium' }),
    piece(43, { category: 'outerwear', name: 'Medium layer B', fabric_weight: 'medium' }),
    piece(44, { category: 'outerwear', name: 'Medium saved Main', fabric_weight: 'medium' }),
  ]
  const result = evaluateAutomaticUsePiecePool({
    pieces: outerwear,
    context: { occasion: 'casual', weatherProfile: { isHot: true, isCold: false } },
    policy: { hotOuterwearCap: 3, anchorPieceIds: [44] },
  })

  assert.deepEqual([...result.eligibleIds], [40, 41, 42, 44])
  assert.equal(result.decisionsById.get(43).findings.at(-1).kind, 'capacity')
  assert.equal(result.decisionsById.get(44).underlyingAllowed, true)
  assert.equal(result.decisionsById.get(44).bypassed, true)
  assert.ok(result.underlyingExcludedPieces.some(entry => entry.pieceId === 44), 'bypass keeps the original suppression observable')
  assert.equal(result.debug.bypassedAnchorCount, 1)
})

test('legacy whole-filter projection delegates to the shared pool without changing eligibility', () => {
  const pieces = [
    piece(45, { category: 'outerwear', name: 'Light layer A', fabric_weight: 'light' }),
    piece(46, { category: 'outerwear', name: 'Light layer B', fabric_weight: 'light' }),
    piece(47, { category: 'outerwear', name: 'Medium layer A', fabric_weight: 'medium' }),
    piece(48, { category: 'outerwear', name: 'Medium layer B', fabric_weight: 'medium' }),
    piece(49, { name: 'Blocked heel', heel_height: 'high', walk_support: 'low', shoe_type: 'pump' }),
  ]
  const context = { occasion: 'city', activity: 'walking', weatherProfile: { isHot: true, isCold: false } }
  const shared = evaluateAutomaticUsePiecePool({ pieces, context, policy: { hotOuterwearCap: 3 } })
  const legacy = filterWholeWardrobePiecesForGeneration(pieces, context)

  assert.deepEqual(legacy.allowedPieces.map(item => item.id), shared.eligiblePieces.map(item => item.id))
  assert.deepEqual(
    new Map(legacy.suppressedPieces.map(item => [item.id, item.reasons])),
    new Map(shared.underlyingExcludedPieces.map(item => [item.id, item.reasons])),
  )
})

test('selected candidate adapter preserves the existing ranking while reusing one pool verdict', () => {
  const anchor = piece(50, { category: 'top', name: 'Selected top' })
  const candidates = [
    piece(51, { category: 'bottom', name: 'Bottom A' }),
    piece(52, { category: 'bottom', name: 'Bottom B' }),
    piece(53, { name: 'Walking shoe' }),
    piece(54, { name: 'Blocked heel', heel_height: 'high', walk_support: 'low', shoe_type: 'pump' }),
  ]
  const context = { occasion: 'city', activity: 'walking', weatherProfile: { isHot: false, isCold: false } }
  const legacy = selectCandidatesForOutfitGeneration(anchor, candidates, 4, context)
  const shared = selectAutomaticUseCandidatesForOutfitGeneration({ anchorPiece: anchor, pieces: candidates, limit: 4, context })

  assert.deepEqual(
    shared.rankedCandidates.map(entry => [entry.piece.id, entry.autoUseBlocked, entry.autoUseBlockReasons]),
    legacy.map(entry => [entry.piece.id, entry.autoUseBlocked, entry.autoUseBlockReasons]),
  )
  assert.equal(shared.eligibility.decisionsById.size, candidates.length)
})

test('selected candidate cap preserves the anchor completion path instead of spending every slot on bottoms', () => {
  const anchor = piece(60, { category: 'top', name: 'Selected top' })
  const candidates = [
    piece(61, { category: 'bottom', name: 'Bottom A' }),
    piece(62, { category: 'bottom', name: 'Bottom B' }),
    piece(63, { category: 'shoes', name: 'Shoes' }),
  ]
  const result = selectAutomaticUseCandidatesForOutfitGeneration({
    anchorPiece: anchor,
    pieces: candidates,
    limit: 2,
    context: { occasion: 'casual', weatherProfile: {} },
  })

  assert.deepEqual(new Set(result.rankedCandidates.map(row => row.piece.category)), new Set(['bottom', 'shoes']))
  assert.equal(result.coverageReport.complete, true)
  assert.deepEqual(result.coverageReport.addedForCoverageIds, [63])
})

test('shared pool findings bind recovery to validity while preserving presentation-only pieces', () => {
  const anchor = piece(1, { category: 'top', name: 'Anchor top', formality: 'elevated' })
  const loungeShoe = piece(2, { name: 'Lounge athletic shoe', formality: 'lounge' })
  const walkingShoeA = piece(3)
  const walkingShoeB = piece(4)
  const accessory = piece(5, { category: 'accessory', name: 'Pendant', formality: 'everyday' })
  const result = evaluateVisualComposerPiecePool({
    pieces: [anchor, loungeShoe, walkingShoeA, walkingShoeB, accessory],
    context: {
      occasion: 'outdoor_daytime_social',
      activity: 'walking',
      weatherProfile: { isHot: false, isCold: false },
    },
    policy: { selectedPieceId: anchor.id, maxImages: 54 },
  })

  assert.equal(result.eligibleIds.has(loungeShoe.id), false)
  assert.equal(result.recoveryEligibleIds.has(loungeShoe.id), false, 'validity exclusions bind fallback')
  assert.equal(result.eligibleIds.has(accessory.id), false)
  assert.equal(result.recoveryEligibleIds.has(accessory.id), true, 'presentation exclusions do not become validity rules')
  assert.ok(result.findings.some(finding => finding.pieceId === loungeShoe.id && finding.kind === 'validity'))
  assert.ok(result.findings.some(finding => finding.pieceId === accessory.id && finding.kind === 'presentation'))
})

test('legacy tagger pairing prose cannot activate visual review', () => {
  const outfit = {
    pieces: [
      piece(10, {
        category: 'top',
        pattern_complexity: 'solid',
        style_profile_json: { garment_intelligence: { do_not_pair_rules: ['avoid oversized bottoms without defined waist'] } },
      }),
      piece(11, {
        category: 'bottom',
        pattern_complexity: 'solid',
        style_profile_json: { garment_intelligence: { do_not_pair_rules: ['avoid another solid in same tone'] } },
      }),
      piece(12, { pattern_complexity: 'solid' }),
    ],
  }

  assert.deepEqual(wholeWardrobeOutfitVisualReviewFindings(outfit), [])
  assert.equal(wholeWardrobeOutfitLooksQuestionable(outfit), false)
})

test('two concrete pattern signals still activate visual clash review', () => {
  const outfit = {
    pieces: [
      piece(20, { category: 'top', pattern_complexity: 'loud' }),
      piece(21, { category: 'bottom', pattern_complexity: 'medium' }),
      piece(22, { pattern_complexity: 'solid' }),
    ],
  }

  assert.deepEqual(wholeWardrobeOutfitVisualReviewFindings(outfit), [{
    code: 'multiple_patterned_pieces',
    reason: 'two or more pieces carry a concrete pattern signal',
    pieceIds: [20, 21],
    source: 'structured_piece_facts',
  }])
  assert.equal(wholeWardrobeOutfitLooksQuestionable(outfit), true)
})
